use serde_json::Value;
use std::{future::Future, path::{Path, PathBuf}};
use tauri::Manager;
use crate::{node_network,node_controller,node_bootstrap,request_journal};
use crate::genesis_stage::{GenesisStageReview, PreparedGenesisStage, INPUTS as GENESIS_INPUTS};
#[tauri::command]
pub fn portal_nodenetwork_requests(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<Value,String>{
 main_only(&window)?;
 request_journal::inspect(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?)
}
#[tauri::command]
pub fn portal_nodenetwork_status(window:tauri::WebviewWindow)->Result<Value,String>{
 main_only(&window)?;
 node_network::status()
}
#[tauri::command]
pub async fn portal_nodenetwork_review_master(window:tauri::WebviewWindow)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::DialogExt;
 main_only(&window)?;
 tauri::async_runtime::spawn_blocking(move || {
  let Some(folder)=window.dialog().file().set_parent(&window).set_title("Select the Synergy node master").blocking_pick_folder() else {return Ok(None)};
  let path=folder.into_path().map_err(|_|"Select a local Synergy master directory.")?;
  node_network::review_master(&path).map(Some)
 }).await.map_err(|_|"Master inspection did not finish.")?
}

fn pick_operator_public_key(window:&tauri::WebviewWindow)->Result<Option<PathBuf>,String>{
 use tauri_plugin_dialog::DialogExt;
 let Some(key)=window.dialog().file().set_parent(window).set_title("Select the operator SSH public key (.pub)")
  .add_filter("SSH public key",&["pub"]).blocking_pick_file() else{return Ok(None)};
 key.into_path().map(Some).map_err(|_|"Select a local public key file.".into())
}

#[tauri::command]
pub async fn portal_nodenetwork_review_operator_key(window:tauri::WebviewWindow)->Result<Option<Value>,String>{
 main_only(&window)?;
 tauri::async_runtime::spawn_blocking(move || {
  let Some(key)=pick_operator_public_key(&window)? else{return Ok(None)};
  node_bootstrap::review_operator_public_key(&key).map(Some)
 }).await.map_err(|_|"Public key inspection did not finish.")?
}

async fn pick_genesis_stage_inputs(window:tauri::WebviewWindow)->Result<Option<PreparedGenesisStage>,String>{
 use tauri_plugin_dialog::DialogExt;
 static PICKER:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
 let picker=PICKER.try_lock().map_err(|_|"A public Genesis file review is already open.")?;
 tauri::async_runtime::spawn_blocking(move || {
  let _picker=picker;
  let mut paths=Vec::with_capacity(GENESIS_INPUTS.len());
  for (name,_) in GENESIS_INPUTS {
   let extension=if name.ends_with(".pub") {"pub"} else {"json"};
   let Some(file)=window.dialog().file().set_parent(&window).set_title(format!("Select public {name}"))
    .add_filter(name,&[extension]).blocking_pick_file() else {return Ok(None)};
   paths.push(file.into_path().map_err(|_|format!("Select a local {name} file."))?);
  }
  PreparedGenesisStage::read(paths.try_into().map_err(|_|"Three public Genesis files are required.")?).map(Some)
 }).await.map_err(|_|"Genesis input review did not finish.")?
}

#[tauri::command]
pub async fn portal_nodenetwork_review_genesis_stage_inputs(window:tauri::WebviewWindow)->Result<Option<Value>,String>{
 main_only(&window)?;
 Ok(pick_genesis_stage_inputs(window).await?.map(|prepared|prepared.summary()))
}

#[tauri::command]
pub async fn portal_nodenetwork_stage_genesis(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,
 review:GenesisStageReview)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 target.validate()?; review.validate()?;
 let Some(prepared)=pick_genesis_stage_inputs(window.clone()).await? else {return Ok(None)};
 review.matches_preparation(&prepared)?;
 let details=review.confirmation_details(&prepared);
 let message=format!("Target: {}\nRoot: /opt/Synergy\nOperation: genesis_stage\n{details}\n\nThis stages three public files on the selected host. The controller requires a matching one-use grant. Binding and validator startup are separate operations.",target.label());
 let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title("Authorize Genesis staging")
  .buttons(MessageDialogButtons::OkCancelCustom("Stage public Genesis files once".into(),"Cancel".into())).blocking_show())
  .await.map_err(|_|"Genesis staging confirmation did not finish.")?;
 if !confirmed {return Ok(None)}
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let journal=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?;
 let serial=node_controller::SERIAL.lock().await;
 dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|request| {
  let (target,directory,serial)=(&target,&directory,&serial);
  async move {node_controller::execute_locked(target,&request,directory,None,serial).await}
 },|wire| {
  let (target,directory,serial)=(&target,&directory,&serial);
  async move {node_controller::execute_genesis_stage_locked(target,&wire,directory,serial).await}
 }).await.map(Some)
}

async fn dispatch_reviewed_genesis_stage<Read,Stage>(target:&node_controller::Target,review:&GenesisStageReview,prepared:PreparedGenesisStage,
 journal:&Path,mut read:impl FnMut(node_controller::Request)->Read,stage:impl FnOnce(String)->Stage)->Result<Value,String>
where Read:Future<Output=Result<Value,String>>,Stage:Future<Output=Result<Value,String>> {
 review.matches_preparation(&prepared)?;
 let query=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let formation=read(query("formation_status")).await
  .map_err(|_|"The controller could not recheck the prepared formation before Genesis staging.")?;
 review.require_current_formation(&formation)?;
 let policy=read(query("genesis_stage_preflight")).await
  .map_err(|_|"The controller could not recheck the reviewed Genesis staging policy.")?;
 review.require_current_policy(&policy)?;
 let dispatch=request_journal::Dispatch::begin_digest(journal,&target.journal_identity(),"genesis_stage",prepared.request_sha256)?;
 let outcome=stage(prepared.wire).await.and_then(|reply|review.stage_reply(&reply));
 dispatch.finish(&outcome).map_err(|_|"Genesis staging outcome could not be saved. Review the target before another change.")?;
 outcome
}
#[tauri::command]
pub async fn portal_nodenetwork_controller(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,request:node_controller::Request,
 binding_review:Option<node_controller::GenesisBindingReview>,preparation_review:Option<node_controller::CustodyPreparationReview>)->Result<Value,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 target.validate()?;
 let mutation=request.validate()?;
 let binding_review=node_controller::GenesisBindingReview::for_request(&request,binding_review)?;
 let preparation_review=node_controller::CustodyPreparationReview::for_request(&request,preparation_review)?;
 if mutation {
  let title=format!("Authorize NodeNetwork {}",request.operation);
  let reviewed=binding_review.as_ref().map(|review|review.confirmation_details(&request))
   .or_else(||preparation_review.as_ref().map(|review|review.confirmation_details(&request)))
   .unwrap_or_else(||format!("\nParameters: {}",request.parameters));
  let effect=match request.operation.as_str() {
   "install"=>"This installs the approved validator software from the host's staged package. Portal rechecks staged target access and package policy after confirmation. A matching one-use host grant is required. Custody, service registration and validator startup are separate operations.",
   "commission"=>"This commissions the installed validator using inputs and custody already staged on the host. The controller can initialize node data and remove the staged inputs and temporary custody after applying them. A matching one-use host grant is required. Service startup and production approval are separate.",
   "identity_generate"|"formation_prepare"=>"This prepares host-local validator custody from the reviewed inputs. Portal rechecks the installed controller and the exact preflight after confirmation. A matching one-use host grant is required. Validator membership is a separate operation.",
   "register"=>"This registers the installed Node and VPN services and the Canary RPC relay if configured. The controller can write installed unit definitions, systemd links and the NetBird wrapper, then reload systemd. A matching one-use host grant is required. VPN enrollment, enabling at boot and service startup are separate.",
   "start"|"restart"=>"This requests a service start or restart on the selected validator. Portal rechecks controller qualification and current VPN readiness after confirmation. A matching one-use host grant is required. Read target health separately after the request.",
   "vpn_enroll"=>"This uses the enrollment input already staged on the selected validator. Portal rechecks controller qualification and current staging eligibility after confirmation. A matching one-use host grant is required. Enrollment, server binding and connectivity are checked separately.",
   "upgrade"=>"This checks and applies the staged software release. The controller can resume its recorded interrupted upgrade with the same exact package. A matching one-use host grant is required. This action does not start consensus or automatically restart services. Confirm maintenance scope and downtime with the operator.",
   "uninstall"=>"This deletes the selected /opt/Synergy installation, including keys, data and signing-safety state. The controller can stop and remove attributed services and remove its dedicated host account. A matching one-use host grant is required. Arrange file retention, VPN retirement and chain exit separately.",
   _=>"This action changes the selected validator. A separate matching host grant is required. No action is retried automatically.",
  };
  let message=format!("Target: {}\nRoot: /opt/Synergy\nOperation: {}{}\nExact request approval ID: {}\n\n{effect}",target.label(),request.operation,reviewed,request.approval_id());
  let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title(title)
   .buttons(MessageDialogButtons::OkCancelCustom("Authorize once".into(),"Cancel".into())).blocking_show())
   .await.map_err(|_|"Operator confirmation did not finish.")?;
  if !confirmed {return Err("Operator canceled; no controller mutation was sent.".into());}
 }
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 if matches!(request.operation.as_str(),"install"|"commission"|"register"|"upgrade"|"uninstall"|"start"|"restart"|"vpn_enroll") {
  let journal=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?;
  let serial=node_controller::SERIAL.lock().await;
  return dispatch_reviewed_software(&target,&request,&journal,|request| {
   let (target,directory,serial)=(&target,&directory,&serial);
   async move {node_controller::execute_locked(target,&request,directory,None,serial).await}
  }).await;
 }
 if let Some(review)=binding_review {
  let journal=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?;
  let serial=node_controller::SERIAL.lock().await;
  return dispatch_reviewed_genesis_binding(&target,&request,&review,&journal, |request| {
   let (target,directory,serial)=(&target,&directory,&serial);
   async move {node_controller::execute_locked(target,&request,directory,None,serial).await}
  }).await;
 }
 if let Some(review)=preparation_review {
  let journal=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?;
  let serial=node_controller::SERIAL.lock().await;
  return dispatch_reviewed_custody_preparation(&target,&request,&review,&journal,|request| {
   let (target,directory,serial)=(&target,&directory,&serial);
   async move {node_controller::execute_locked(target,&request,directory,None,serial).await}
  }).await;
 }
 let dispatch=if mutation {Some(request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?,&target.journal_identity(),&request.operation,&request.canonical())?)} else {None};
 let result=node_controller::execute(target,request,&directory).await;
 if let Some(dispatch)=dispatch {dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;}
 result
}

async fn dispatch_reviewed_software<Fut>(target:&node_controller::Target,request:&node_controller::Request,
 journal:&Path,mut execute:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let fresh_target=execute(node_controller::Request{version:1,operation:"target".into(),parameters:serde_json::json!({})}).await
  .map_err(|_|"The controller could not recheck the selected target.")?;
 match request.operation.as_str() {
  "commission"=>node_controller::require_commission_target(&fresh_target)?,
  "register"=>node_controller::require_service_registration_target(&fresh_target)?,
  "start"|"restart"=>{
   node_controller::require_service_start_target(&request.operation,&fresh_target)?;
   let vpn=execute(node_controller::Request{version:1,operation:"vpn_status".into(),parameters:serde_json::json!({})}).await
    .map_err(|_|"The controller could not recheck current VPN status. Read VPN status again before starting or restarting.")?;
   node_controller::require_service_start_vpn(&vpn)?;
  },
  "vpn_enroll"=>{
   node_controller::require_vpn_enrollment_target(&fresh_target)?;
   let vpn=execute(node_controller::Request{version:1,operation:"vpn_status".into(),parameters:serde_json::json!({})}).await
    .map_err(|_|"The controller could not recheck current VPN status. Read VPN status again before enrolling.")?;
   node_controller::require_staged_vpn_enrollment(&vpn)?;
  },
  // A sealed preflight cannot describe all partially applied upgrades. The owner
  // mutation verifies its exact staged package and any saved upgrade intent.
  "upgrade"=>node_controller::require_upgrade_target(&fresh_target)?,
  "uninstall"=>node_controller::require_removal_target(&fresh_target)?,
  "install"=>{
   node_controller::require_staged_install_target(&fresh_target)?;
   let preflight=node_controller::Request{version:1,operation:"install_preflight".into(),parameters:request.parameters.clone()};
   let fresh_preflight=execute(preflight.clone()).await
    .map_err(|_|"The controller could not recheck the exact staged package and network policy. Run installation preflight again.")?;
   node_controller::install_preflight_reply(&preflight,&fresh_preflight)?;
  },
  _=>return Err("Unsupported reviewed software operation.".into()),
 }
 let dispatch=request_journal::Dispatch::begin(journal,&target.journal_identity(),&request.operation,&request.canonical())?;
 let result=execute(request.clone()).await.map_err(|error|match request.operation.as_str() {
  "commission"=>node_controller::COMMISSION_UNCERTAIN.into(),
  "register"=>node_controller::REGISTER_UNCERTAIN.into(),
  "upgrade"=>node_controller::UPGRADE_UNCERTAIN.into(),
  "uninstall"=>crate::node_removal_scope::REMOVAL_UNCERTAIN.into(),
  "start"|"restart"=>node_controller::NODE_SERVICE_UNCERTAIN.into(),
  "vpn_enroll"=>node_controller::VPN_ENROLLMENT_UNCERTAIN.into(),
  _=>error,
 }).and_then(|reply|match request.operation.as_str() {
  "commission"=>node_controller::commissioning_reply(&reply).map_err(String::from),
  "start"|"restart"=>node_controller::service_start_reply(&request.operation,&reply).map_err(String::from),
  "vpn_enroll"=>node_controller::vpn_enrollment_reply(&reply).map_err(String::from),
  _=>Ok(reply),
 });
 dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes.")?;
 result
}

async fn dispatch_reviewed_genesis_binding<Fut>(target:&node_controller::Target,request:&node_controller::Request,
 review:&node_controller::GenesisBindingReview,journal:&Path,mut execute:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let preflight=node_controller::Request{version:1,operation:"genesis_binding_preflight".into(),parameters:serde_json::json!({})};
 let fresh=execute(preflight).await
  .map_err(|_|"The controller could not recheck the reviewed unbound Genesis scope. Review it again before binding.")?;
 review.require_unbound(request,&fresh)?;
 let dispatch=request_journal::Dispatch::begin(journal,&target.journal_identity(),&request.operation,&request.canonical())?;
 let result=execute(request.clone()).await
  .and_then(|reply|review.verify_acknowledgement(request,reply));
 dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;
 result
}

async fn dispatch_reviewed_custody_preparation<Fut>(target:&node_controller::Target,request:&node_controller::Request,
 review:&node_controller::CustodyPreparationReview,journal:&Path,mut execute:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let read=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let current_target=execute(read("target")).await.map_err(|_|"The controller could not recheck the selected target before custody preparation.")?;
 node_controller::require_custody_preparation_target(request,review,&current_target)?;
 let current_preflight=execute(read(review.preflight_operation())).await
  .map_err(|_|"The controller could not recheck reviewed custody preparation inputs. Run preflight again.")?;
 review.require_current_preflight(request,&current_preflight)?;
 let dispatch=request_journal::Dispatch::begin(journal,&target.journal_identity(),&request.operation,&request.canonical())?;
 let result=execute(request.clone()).await.map_err(|_|review.uncertain_message().into())
  .and_then(|reply|review.verify_acknowledgement(request,&reply).map_err(String::from));
 dispatch.finish(&result).map_err(|_|"Custody preparation outcome could not be saved. Inspect the target before another change.")?;
 result
}
#[tauri::command]
pub async fn portal_nodenetwork_bootstrap(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,operator:String,parameters:Value)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;node_bootstrap::validate_operator(&operator)?;
 if target.kind=="local"&&!cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local bootstrap requires Linux x86_64; select a remote headless target.".into());}
 node_controller::Request{version:1,operation:"install_preflight".into(),parameters:parameters.clone()}.validate()?;
 let view=window.clone();let fields=parameters.clone();
 let prepared=tauri::async_runtime::spawn_blocking(move ||{
  let Some(folder)=view.dialog().file().set_parent(&view).set_title("Select the approved Synergy master to stage").blocking_pick_folder() else{return Ok(None)};
  let root=folder.into_path().map_err(|_|"Select a local Synergy master directory.")?;
  let Some(key)=pick_operator_public_key(&view)? else{return Ok(None)};
  node_bootstrap::prepare(&root,&key,&fields).map(Some)
 }).await.map_err(|_|"Master bootstrap inspection did not finish.")??;
 let Some(prepared)=prepared else{return Ok(None)};
 let message=format!("Target: {}\nAdministrative account: {}\nRoot: /opt/Synergy\nRelease: {}\nManifest SHA-256: {}\nEmbedded bootstrap SHA-256: {}\nNetwork incarnation: {}\nChain: {}\nNode name: {}\nOperator public-key SHA-256: {}\n\nThis stages the verified software and installs a restricted host controller account, rooted SSH/sudo definitions and OS registration links. The target must be clean. No community enrollment, custody creation, consensus membership or activation is authorized. No passwords are requested or stored by Portal.",target.label(),operator,prepared.release,prepared.manifest_sha256,node_bootstrap::script_pin(),parameters["network_id"],parameters["chain_id"],parameters["node_name"],prepared.operator_public_key_sha256());
 let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title("Authorize NodeNetwork target bootstrap")
  .buttons(MessageDialogButtons::OkCancelCustom("Bootstrap selected target once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Bootstrap confirmation did not finish.")?;
 if !confirmed{return Err("Operator canceled; no bootstrap was sent.".into());}
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let dispatch=request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no bootstrap was sent.")?,&target.journal_identity(),"bootstrap",&serde_json::json!({"version":1,"operation":"bootstrap","operator":operator,"parameters":parameters,"bootstrapPin":node_bootstrap::script_pin()}))?;
 let result=node_bootstrap::execute(target,operator,parameters,prepared,&directory).await;
 dispatch.finish(&result).map_err(|_|"Bootstrap outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;
 result.map(Some)
}
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("Use the main Portal window for native services.".into()) } }

#[cfg(all(test,unix))]
mod tests {
 use super::*;
 use crate::node_controller::{GenesisBindingReview,Request,Target,ROOT};
 use serde_json::json;
 use std::sync::atomic::{AtomicU64,Ordering};

 fn genesis_bind_scope_fixture() -> (Target,Request,GenesisBindingReview,PathBuf) {
  static NEXT_FIXTURE:AtomicU64=AtomicU64::new(0);
  let target=Target{kind:"remote".into(),host:Some("fixture.invalid".into()),port:None,root:ROOT.into()};
  let request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
  let review=serde_json::from_value(json!({"networkId":"fixture-formation","chainId":"99999",
   "validatorAddress":"synv1".to_owned()+&"a".repeat(36)})).unwrap();
  let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
  let sequence=NEXT_FIXTURE.fetch_add(1,Ordering::Relaxed);
  let journal=std::env::temp_dir().canonicalize().unwrap()
   .join(format!("nodenetwork-reviewed-binding-{}-{stamp}-{sequence}",std::process::id()));
  (target,request,review,journal)
 }

 fn genesis_binding_projection(bound:bool)->Value {
  json!({"version":1,"ok":true,"result":{
   "schema":"nodenetwork-genesis-binding-v1","network_id":"fixture-formation","chain_id":"99999",
   "genesis_sha256":"a".repeat(64),"genesis_authority_verified":true,"address":"synv1".to_owned()+&"a".repeat(36),
   "membership_verified":true,"bound":bound,"stage_receipt_verified":false}})
 }

 fn reviewed_install_fixture() -> (Target, Request, PathBuf, Value, Value, Value) {
  let (target,_,_,journal)=genesis_bind_scope_fixture();
  let request=Request{version:1,operation:"install".into(),parameters:json!({
   "release_id":"fixture-release","manifest_sha256":"a".repeat(64),"network_id":"fixture-network","chain_id":1266,"node_name":"fixture-node"})};
  let staged=json!({"version":1,"ok":true,"result":{"controllerVersion":1,"root":"/opt/Synergy","installed":false,
   "platform":"linux","architecture":"x86_64","localValidatorSupported":true,"operations":[
    {"operation":"install","kind":"mutation","available":true,"blocker":null},
    {"operation":"install_preflight","kind":"read","available":true,"blocker":null}]}});
  let preflight=json!({"version":1,"ok":true,"result":{"packageVerified":true,"release":"fixture-release","root":"/opt/Synergy",
   "networkSelectionApproved":true,"genesisAuthorityVerified":false,"activationAuthorized":false}});
  let receipt=json!({"version":1,"ok":true,"result":{"format":"synergy-universal-linux-v1","root":"/opt/Synergy","role":"validator",
   "network_id":"fixture-network","chain_id":1266,"node_name":"fixture-node","package_sha256":"a".repeat(64),
   "package_files":{"bin/synergy-node":"b".repeat(64)},"host_integrations":[],"consensus_started":false}});
  (target,request,journal,staged,preflight,receipt)
 }

 fn reviewed_service_start_fixture(operation:&str)->(Target,Request,PathBuf,Value,Value,Value) {
  let (target,_,journal,mut capability,_,_)=reviewed_install_fixture();
  let request=Request{version:1,operation:operation.into(),parameters:json!({})};
  capability["result"]["installed"]=json!(true);
  capability["result"]["operations"]=json!([{"operation":operation,"kind":"mutation","available":true,"blocker":null},
   {"operation":"vpn_status","kind":"read","available":true,"blocker":null}]);
  let vpn=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-status-v1","service_registered":true,
   "enrollment_staged":false,"enrollment_recorded":true,"reconciliation_required":false,"server_bound":true,"connected":true}});
  let receipt=json!({"version":1,"ok":true,"result":{"requested":operation,"healthNotInferred":true}});
  (target,request,journal,capability,vpn,receipt)
 }

 fn reviewed_vpn_enrollment_fixture()->(Target,Request,PathBuf,Value,Value,Value) {
  let (target,request,journal,capability,_,_)=reviewed_service_start_fixture("vpn_enroll");
  let staged=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-status-v1","service_registered":true,
   "enrollment_staged":true,"enrollment_recorded":false,"reconciliation_required":false,"server_bound":false,"connected":false}});
  let recorded=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-status-v1","service_registered":true,
   "enrollment_staged":false,"enrollment_recorded":true,"reconciliation_required":false,"server_bound":false,"connected":false,
   "overlay_address":"100.80.10.4/16"}});
  (target,request,journal,capability,staged,recorded)
 }

 #[test]
 fn reviewed_vpn_enrollment_stops_before_journaling_after_capability_or_staging_drift() {
  let (target,request,journal,capability,staged,_)=reviewed_vpn_enrollment_fixture();
  assert_eq!(request.validate(),Ok(true));
  let mut wrong_arch=capability.clone();
  wrong_arch["result"]["architecture"]=json!("aarch64");
  let mut wrong_root=capability.clone();
  wrong_root["result"]["root"]=json!("/opt/synergy");
  let mut uninstalled=capability.clone();
  uninstalled["result"]["installed"]=json!(false);
  let mut no_read=capability.clone();
  no_read["result"]["operations"][1]["available"]=json!(false);
  let mut duplicate=capability.clone();
  let operations=duplicate["result"]["operations"].as_array_mut().unwrap();
  operations.push(operations[0].clone());
  for invalid in [wrong_arch,wrong_root,uninstalled,no_read,duplicate] {
   let mut calls=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(invalid.clone()))
   }));
   assert!(outcome.unwrap_err().contains("qualified VPN enrollment and status operations"));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
   assert!(!journal.exists());
  }
  let mut status_cases=vec![Err("private transport detail".into())];
  for (field,value) in [("service_registered",json!(false)),("enrollment_staged",json!(false)),
   ("enrollment_recorded",json!(true)),("reconciliation_required",json!(true)),("server_bound",json!(true)),("connected",json!(true)),
   ("enrollment_staged",json!("true"))] {
   let mut changed=staged.clone();
   changed["result"][field]=value;
   status_cases.push(Ok(changed));
  }
  for invalid in status_cases {
   let mut calls=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(if query.operation=="target" {Ok(capability.clone())} else {invalid.clone()})
   }));
   let error=outcome.unwrap_err();
   assert!(error.contains("Read VPN status again before enrolling"));
   assert!(!error.contains("private transport"));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),json!({"version":1,"operation":"vpn_status","parameters":{}})]);
   assert!(!journal.exists());
  }
 }

 #[test]
 fn reviewed_vpn_enrollment_settles_only_pinned_receipt_or_refusal_without_exposing_input() {
  let (target,request,journal,capability,staged,recorded)=reviewed_vpn_enrollment_fixture();
  let mut wrong=recorded.clone();
  wrong["result"]["enrollment_staged"]=json!(true);
  let mut extra=recorded.clone();
  extra["diagnostics"]=json!("private owner detail");
  let refusal=|code,message| json!({"version":1,"ok":false,"error":{"code":code,"message":message}});
  for (raw,observed) in [(Ok(recorded.clone()),Some(true)),
   (Ok(refusal("authorization_required","One-time host grant does not bind this VPN enrollment")),Some(false)),
   (Ok(refusal("authorization_required","private unknown failure")),None),
   (Ok(refusal("vpn_reconciliation_required","Prior VPN enrollment needs control-plane reconciliation")),None),
   (Ok(refusal("vpn_reconciliation_required","VPN enrollment did not return a verified receipt. Inspect the VPN controller before issuing another credential.")),None),
   (Ok(wrong),None),(Ok(extra),None),(Err("private transport detail".into()),None)] {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(capability.clone()),"vpn_status"=>Ok(staged.clone()),_=>raw.clone(),
    })
   }));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),
    json!({"version":1,"operation":"vpn_status","parameters":{}}),request.canonical()]);
   assert_eq!(calls[2].to_string(),r#"{"operation":"vpn_enroll","parameters":{},"version":1}"#);
   let history=request_journal::inspect(&journal).unwrap();
   let row=&history["records"][0];
   assert_eq!(row["request_digest"],request.approval_id());
   assert_eq!(row["response_ok"],json!(observed));
   assert_eq!(row["state"],if observed.is_some() {"response_received"} else {"uncertain"});
   match observed {
    Some(true)=>{
     let result=result.unwrap();
     assert!(result["result"].get("overlay_address").is_none());
     assert_eq!(result["result"]["enrollment_recorded"],true);
     assert_eq!(result["result"]["server_bound"],false);
     assert_eq!(result["result"]["connected"],false);
    },
    Some(false)=>{
     let reply=result.unwrap();
     assert_eq!(reply["error"]["code"],"authorization_required");
     assert!(!reply.to_string().contains("One-time host grant does not bind"));
    },
    None=>{
     assert_eq!(result.unwrap_err(),node_controller::VPN_ENROLLMENT_UNCERTAIN);
     assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"vpn_enroll",&request.canonical()).is_err());
    },
   }
   assert!(!history.to_string().contains("100.80.10.4"));
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 #[test]
 fn reviewed_service_start_blocks_capability_or_vpn_drift_before_creating_journal() {
  for operation in ["start","restart"] {
   let (target,request,journal,capability,vpn,_)=reviewed_service_start_fixture(operation);
   assert_eq!(request.validate(),Ok(true));
   let mut wrong_arch=capability.clone();
   wrong_arch["result"]["architecture"]=json!("aarch64");
   let mut wrong_root=capability.clone();
   wrong_root["result"]["root"]=json!("/opt/synergy");
   let mut uninstalled=capability.clone();
   uninstalled["result"]["installed"]=json!(false);
   let mut unsupported_read=capability.clone();
   unsupported_read["result"]["operations"][1]["kind"]=json!("mutation");
   let mut duplicate=capability.clone();
   let operations=duplicate["result"]["operations"].as_array_mut().unwrap();
   operations.push(operations[0].clone());
   for invalid in [wrong_arch,wrong_root,uninstalled,unsupported_read,duplicate] {
    let mut calls=Vec::new();
    let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
     calls.push(query.canonical());
     std::future::ready(Ok(invalid.clone()))
    }));
    assert!(outcome.unwrap_err().contains("qualified service action and VPN status read"));
    assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
    assert!(!journal.exists());
   }
   let mut vpn_cases=vec![Err("Private provider transport error".into())];
   for (field,value) in [("service_registered",false),("enrollment_recorded",false),("reconciliation_required",true),
    ("server_bound",false),("connected",false)] {
    let mut changed=vpn.clone();
    changed["result"][field]=json!(value);
    vpn_cases.push(Ok(changed));
   }
   let mut malformed=vpn.clone();
   malformed["result"]["connected"]=json!("true");
   vpn_cases.push(Ok(malformed));
   for invalid in vpn_cases {
    let mut calls=Vec::new();
    let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
     calls.push(query.canonical());
     std::future::ready(if query.operation=="target" {Ok(capability.clone())} else {invalid.clone()})
    }));
    let message=outcome.unwrap_err();
    assert!(message.contains("Read VPN status again"));
    assert!(!message.contains("Private provider"));
    assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),json!({"version":1,"operation":"vpn_status","parameters":{}})]);
    assert!(!journal.exists());
   }
  }
 }

 #[test]
 fn reviewed_service_start_requires_the_exact_acknowledgement_before_settling_journal() {
  for operation in ["start","restart"] {
   let (target,request,journal,capability,mut vpn,receipt)=reviewed_service_start_fixture(operation);
   // The owner readiness gate does not require a new enrollment input.
   vpn["result"]["enrollment_staged"]=json!(true);
   let mut wrong=receipt.clone();
   wrong["result"]["requested"]=json!("stop");
   let mut extra=receipt.clone();
   extra["detail"]=json!("fixture raw detail");
   let refused=json!({"version":1,"ok":false,"error":{"code":"vpn_readiness_required",
    "message":"Current native VPN must match the recorded, independently server-bound validator peer"}});
   let failed=json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"Controller validation or lifecycle operation failed"}});
   for (raw,observed) in [(Ok(receipt.clone()),Some(true)),(Ok(refused),Some(false)),(Ok(wrong),None),
    (Ok(extra),None),(Ok(failed),None),(Err("Private transport failure".into()),None)] {
    let mut calls=Vec::new();
    let result=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
     calls.push(query.canonical());
     std::future::ready(match query.operation.as_str() {
      "target"=>Ok(capability.clone()),"vpn_status"=>Ok(vpn.clone()),_=>raw.clone(),
     })
    }));
    assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),
     json!({"version":1,"operation":"vpn_status","parameters":{}}),request.canonical()]);
    assert_eq!(calls[2].to_string(),format!(r#"{{"operation":"{operation}","parameters":{{}},"version":1}}"#));
    let history=request_journal::inspect(&journal).unwrap();
    let row=&history["records"][0];
    assert_eq!(row["request_digest"],request.approval_id());
    assert_eq!(row["response_ok"],json!(observed));
    assert_eq!(row["state"],if observed.is_some() {"response_received"} else {"uncertain"});
    match observed {
     Some(true)=>assert_eq!(result.unwrap(),receipt),
     Some(false)=>assert_eq!(result.unwrap()["error"]["code"],"vpn_readiness_required"),
     None=>{
      assert_eq!(result.unwrap_err(),node_controller::NODE_SERVICE_UNCERTAIN);
      assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),operation,&request.canonical()).is_err());
     },
    }
    assert!(!history.to_string().contains("fixture raw detail"));
    std::fs::remove_dir_all(&journal).unwrap();
   }
  }
 }

 fn reviewed_preparation_fixture(operation:&str)->(Target,Request,node_controller::CustodyPreparationReview,PathBuf,Value,Value,Value) {
  let (target,_,journal,mut capability,_,_)=reviewed_install_fixture();
  let formation=operation=="formation_prepare";
  let pin="a".repeat(64);
  let chain="18446744073709551615";
  let network="fixture-network";
  let formation_id="b".repeat(64);
  let mut reviewed=json!({"networkId":network,"chainId":chain});
  if formation {reviewed["formationId"]=json!(formation_id);}
  let review=serde_json::from_value(reviewed).unwrap();
  let mut preflight=json!({"network_id":network,"chain_id":chain});
  let parameters=if formation {
   preflight["schema"]=json!("nodenetwork-formation-v1");
   preflight["formation_id"]=json!(formation_id);
   preflight["formation_sha256"]=json!(pin);
   json!({"formation_sha256":pin})
  } else {
   preflight["genesis_authority_verified"]=json!(true);
   preflight["genesis_sha256"]=json!(pin);
   json!({"genesis_sha256":pin})
  };
  let request=Request{version:1,operation:operation.into(),parameters};
  let review=node_controller::CustodyPreparationReview::for_request(&request,Some(review)).unwrap().unwrap();
  let mut receipt=preflight.clone();
  receipt["address"]=json!("synv1".to_owned()+&"a".repeat(36));
  receipt["possession_verified"]=json!(true);
  receipt["membership_granted"]=json!(false);
  if formation {
   receipt["pending"]=json!(true);
   receipt["request_sha256"]=json!(request.approval_id());
  }
  let wrap=|result|json!({"version":1,"ok":true,"result":result});
  capability["result"]["installed"]=json!(true);
  capability["result"]["operations"]=json!([{"operation":operation,"kind":"mutation","available":true,"blocker":null},
   {"operation":review.preflight_operation(),"kind":"read","available":true,"blocker":null}]);
  (target,request,review,journal,capability,wrap(preflight),wrap(receipt))
 }

 #[test]
 fn reviewed_preparation_requires_the_operation_specific_scope_for_native_consent() {
  use crate::node_controller::CustodyPreparationReview;
  for operation in ["identity_generate","formation_prepare"] {
   let (_,request,review,_,_,_,_)=reviewed_preparation_fixture(operation);
   assert_eq!(request.validate(),Ok(true));
   assert!(CustodyPreparationReview::for_request(&request,None).is_err());
   let details=review.confirmation_details(&request);
   assert!(details.contains("Network incarnation: fixture-network"));
   assert!(details.contains("Chain ID: 18446744073709551615"));
   let expected_digest_label=if operation=="formation_prepare" {"Formation context SHA-256"} else {"Signed Genesis SHA-256"};
   assert!(details.contains(&format!("{expected_digest_label}: {}","a".repeat(64))));
   assert_eq!(details.contains(&format!("Formation ID: {}","b".repeat(64))),operation=="formation_prepare");
   let incorrect=serde_json::from_value(json!({"networkId":"fixture-network","chainId":"1266",
    "formationId":if operation=="formation_prepare" {"0".repeat(64)} else {"b".repeat(64)}})).unwrap();
   assert!(CustodyPreparationReview::for_request(&request,Some(incorrect)).is_err());
   let other=Request{version:1,operation:"target".into(),parameters:json!({})};
   assert!(CustodyPreparationReview::for_request(&other,Some(review)).is_err());
  }
 }

 #[test]
 fn reviewed_preparation_rechecks_target_and_exact_preflight_before_journaling() {
  for operation in ["identity_generate","formation_prepare"] {
   let (target,request,review,journal,capability,preflight,_)=reviewed_preparation_fixture(operation);
   let preflight_name=review.preflight_operation();
   let mut wrong_architecture=capability.clone();
   wrong_architecture["result"]["architecture"]=json!("aarch64");
   let mut stale_target=capability.clone();
   stale_target["result"]["installed"]=json!(false);
   let mut disabled_read=capability.clone();
   disabled_read["result"]["operations"][1]["available"]=json!(false);
   let mut duplicate=capability.clone();
   let operations=duplicate["result"]["operations"].as_array_mut().unwrap();
   operations.push(operations[0].clone());
   for bad in [wrong_architecture,stale_target,disabled_read,duplicate] {
    let mut calls=Vec::new();
    let outcome=tauri::async_runtime::block_on(dispatch_reviewed_custody_preparation(&target,&request,&review,&journal,|query| {
     calls.push(query.canonical());
     std::future::ready(Ok(bad.clone()))
    }));
    assert!(outcome.unwrap_err().contains("qualified preparation and preflight"));
    assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
    assert!(!journal.exists());
   }
   let mut changes=vec![("network_id",json!("another-network")),("chain_id",json!("1266"))];
   if operation=="formation_prepare" {
    changes.extend([("formation_id",json!("c".repeat(64))),("formation_sha256",json!("d".repeat(64)))]);
   } else {
    changes.push(("genesis_sha256",json!("d".repeat(64))));
   }
   for (key,value) in changes {
    let mut changed=preflight.clone();
    changed["result"][key]=value;
    let mut calls=Vec::new();
    let outcome=tauri::async_runtime::block_on(dispatch_reviewed_custody_preparation(&target,&request,&review,&journal,|query| {
     calls.push(query.canonical());
     std::future::ready(Ok(if query.operation=="target" {capability.clone()} else {changed.clone()}))
    }));
    assert!(outcome.unwrap_err().contains("differs from the reviewed custody scope"));
    assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),json!({"version":1,"operation":preflight_name,"parameters":{}})]);
    assert!(!journal.exists());
   }
  }
 }

 #[test]
 fn reviewed_preparation_requires_matching_public_receipt_and_keeps_uncertain_dispatch_fenced() {
  for operation in ["identity_generate","formation_prepare"] {
   let (target,request,review,journal,capability,preflight,receipt)=reviewed_preparation_fixture(operation);
   let mut conflicting=receipt.clone();
   let field=if operation=="formation_prepare" {"formation_id"} else {"network_id"};
   conflicting["result"][field]=if operation=="formation_prepare" {json!("c".repeat(64))} else {json!("another-network")};
   let mut extra=receipt.clone();
   extra["private"]=json!("unreviewed");
   let owner_refusal=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Exact request needs one-time host operator authorization"}});
   for (raw,observed) in [(Ok(receipt.clone()),Some(true)),(Ok(owner_refusal),Some(false)),(Ok(conflicting),None),
    (Ok(extra),None),(Err("private transport detail".into()),None)] {
    let mut calls=Vec::new();
    let run=tauri::async_runtime::block_on(dispatch_reviewed_custody_preparation(&target,&request,&review,&journal,|query| {
     calls.push(query.canonical());
     std::future::ready(match query.operation.as_str(){
      "target"=>Ok(capability.clone()),
      "identity_preflight"|"formation_preflight"=>Ok(preflight.clone()),
      _=>raw.clone(),
     })
    }));
    assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),
     json!({"version":1,"operation":review.preflight_operation(),"parameters":{}}),request.canonical()]);
    let key=if operation=="formation_prepare" {"formation_sha256"} else {"genesis_sha256"};
    assert_eq!(calls[2].to_string(),format!(r#"{{"operation":"{operation}","parameters":{{"{key}":"{}"}},"version":1}}"#,"a".repeat(64)));
    let history=request_journal::inspect(&journal).unwrap();
    let item=&history["records"][0];
    assert_eq!(item["request_digest"],request.approval_id());
    assert_eq!(item["response_ok"],json!(observed));
    assert_eq!(item["state"],if observed.is_some() {"response_received"} else {"uncertain"});
    assert!(!history.to_string().contains("fixture-network"));
    match observed {
     Some(true)=>assert_eq!(run.unwrap(),receipt),
     Some(false)=>assert_eq!(run.unwrap()["ok"],false),
     None=>{
      assert_eq!(run.unwrap_err(),review.uncertain_message());
      assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),operation,&request.canonical()).is_err());
     },
    }
    std::fs::remove_dir_all(&journal).unwrap();
   }
  }
 }

 #[test]
 fn reviewed_install_rechecks_target_and_exact_preflight_before_journal() {
  let (target,request,journal,staged,preflight,_)=reviewed_install_fixture();
  let mut installed=staged.clone();
  installed["result"]["installed"]=json!(true);
  let mut ambiguous=staged.clone();
  let rows=ambiguous["result"]["operations"].as_array_mut().unwrap();
  rows.push(rows[0].clone());
  for incompatible in [installed,ambiguous] {
   let mut operations=Vec::new();
   let failure=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    operations.push(query.canonical());
    std::future::ready(Ok(incompatible.clone()))
   }));
   assert!(failure.unwrap_err().contains("uninstalled Linux"));
   assert_eq!(operations,vec![json!({"version":1,"operation":"target","parameters":{}})]);
   assert!(!journal.exists());
  }
  let mut mismatched=preflight;
  mismatched["result"]["release"]=json!("unreviewed-release");
  let mut operations=Vec::new();
  let failure=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
   operations.push(query.canonical());
   std::future::ready(Ok(if query.operation=="target" {staged.clone()} else {mismatched.clone()}))
  }));
  assert!(failure.unwrap_err().contains("mismatched installation preflight"));
  assert_eq!(operations,vec![json!({"version":1,"operation":"target","parameters":{}}),
   json!({"version":1,"operation":"install_preflight","parameters":request.parameters})]);
  assert!(!journal.exists());
 }

 #[test]
 fn reviewed_install_projects_receipt_and_fences_unverified_effects() {
  let (target,request,journal,staged,preflight,receipt)=reviewed_install_fixture();
  let mut mismatched=receipt.clone();
  mismatched["result"]["node_name"]=json!("different-node");
  for (reply,state) in [
   (receipt.clone(),"response_received"),
   (json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Exact request needs one-time host operator authorization"}}),"response_received"),
   (mismatched,"uncertain"),
   (json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"Controller validation or lifecycle operation failed"}}),"uncertain"),
  ] {
   let mut operations=Vec::new();
   let install=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    operations.push(query.canonical());
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(staged.clone()),"install_preflight"=>Ok(preflight.clone()),
     "install"=>node_controller::install_reply(&query,&reply).map_err(String::from),_=>unreachable!(),
    })
   }));
   assert_eq!(operations[1],json!({"version":1,"operation":"install_preflight","parameters":request.parameters}));
   assert_eq!(operations[2],request.canonical());
   let history=request_journal::inspect(&journal).unwrap();
   assert_eq!(history["records"][0]["state"],state);
   assert_eq!(history["records"][0]["request_digest"],request.approval_id());
   assert!(!history.to_string().contains("fixture-node"));
   if state=="uncertain" {
    assert!(install.unwrap_err().contains("uncertain"));
    assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"install",&request.canonical()).is_err());
   } else if reply["ok"]==true {
    let result=install.unwrap();
    assert_eq!(result["result"],json!({"schema":"nodenetwork-installed-validator-v1","root":"/opt/Synergy","role":"validator",
     "release_id":"fixture-release","manifest_sha256":"a".repeat(64),"network_id":"fixture-network","chain_id":"1266",
     "node_name":"fixture-node","declared_members":1,"host_integrations_registered":false,"consensus_started":false}));
    assert!(!result.to_string().contains("bin/synergy-node"));
   } else {
    assert_eq!(install.unwrap()["ok"],false);
   }
   std::fs::remove_dir_all(&journal).unwrap();
  }
  for (key,wrong) in [("chain_id",json!(99999)),("network_id",json!("different-network")),("node_name",json!("different-node")),
   ("package_sha256",json!("c".repeat(64))),("package_files",json!({"bin/synergy-node":"bad"})),
   ("host_integrations",json!(["systemd"])),("consensus_started",json!(true))] {
   let mut changed=receipt.clone();
   changed["result"][key]=wrong;
   assert!(node_controller::install_reply(&request,&changed).is_err(),"{key}");
  }
 }

 fn service_registration_fixture() -> (Target, Request, PathBuf, Value, Value) {
  let (target,_,journal,mut report,_,_)=reviewed_install_fixture();
  report["result"]["installed"]=json!(true);
  report["result"]["operations"]=json!([{"operation":"register","kind":"mutation","available":true,"blocker":null}]);
  let request=Request{version:1,operation:"register".into(),parameters:json!({})};
  let reply=json!({"version":1,"ok":true,"result":{"registered":["/etc/systemd/system/synergy-node.service",
   "/etc/systemd/system/synergy-vpn.service"],"services_started":false,"boot_enabled":false}});
  (target,request,journal,report,reply)
 }

 fn reviewed_commission_fixture() -> (Target, Request, PathBuf, Value, Value) {
  let (target,_,journal,mut report,_,_)=reviewed_install_fixture();
  report["result"]["installed"]=json!(true);
  report["result"]["operations"]=json!([{"operation":"commission","kind":"mutation","available":true,"blocker":null}]);
  let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
  let receipt=json!({"version":1,"ok":true,"result":{"commissioned":true,"consensus_started":false,"production_approved":false}});
  (target,request,journal,report,receipt)
 }

 #[test]
 fn reviewed_commission_requires_current_installed_target_before_creating_journal() {
  let (target,request,journal,report,_)=reviewed_commission_fixture();
  assert_eq!(request.validate(),Ok(true));
  let mut unsupported=request.clone();
  unsupported.parameters=json!({"stage":"tmp/commissioning"});
  assert!(unsupported.validate().is_err());
  let mut wrong_read=report.clone();
  wrong_read["result"]["operations"][0]["kind"]=json!("read");
  let mut unavailable=report.clone();
  unavailable["result"]["operations"][0]["available"]=json!(false);
  let mut duplicate=report.clone();
  let operations=duplicate["result"]["operations"].as_array_mut().unwrap();
  operations.push(operations[0].clone());
  let mut invalid_reports=vec![wrong_read,unavailable,duplicate];
  for (field,value) in [("installed",json!(false)),("controllerVersion",json!(2)),("platform",json!("darwin")),
   ("architecture",json!("aarch64")),("root",json!("/opt/synergy")),("localValidatorSupported",json!(false))] {
   let mut invalid=report.clone();
   invalid["result"][field]=value;
   invalid_reports.push(invalid);
  }
  for invalid in invalid_reports {
   let mut wire=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    wire.push(query.canonical());
    std::future::ready(Ok(invalid.clone()))
   }));
   assert!(outcome.unwrap_err().contains("qualified validator commissioning"));
   assert_eq!(wire,[json!({"version":1,"operation":"target","parameters":{}})]);
   assert!(!journal.exists());
  }
 }

 #[test]
 fn reviewed_commission_validates_owner_receipt_before_settling_the_exact_dispatch() {
  let (target,request,journal,report,valid)=reviewed_commission_fixture();
  let accepted=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-commissioning-v1",
   "commissioned":true,"consensus_started":false,"production_approved":false}});
  let refused=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Host authorization expired or differs"}});
  let admission=json!({"version":1,"ok":false,"error":{"code":"qualification_required","message":"Operation has not passed host qualification"}});
  let mut cases=vec![(Ok(valid.clone()),Some(true)),(Ok(refused),Some(false)),(Ok(admission),Some(false)),
   (Ok(json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"Partial work at /private/controller-state"}})),None),
   (Err("Transport included /private/diagnostics".into()),None)];
  for (field,wrong) in [("commissioned",json!(false)),("consensus_started",json!(true)),
   ("production_approved",json!("false")),("debug_path",json!("/private/controller-state"))] {
   let mut malformed=valid.clone();
   malformed["result"][field]=wrong;
   cases.push((Ok(malformed),None));
  }
  let mut incomplete=valid.clone();
  incomplete["result"].as_object_mut().unwrap().remove("production_approved");
  cases.push((Ok(incomplete),None));
  let mut extra=valid;
  extra["raw"]=json!("/private/controller-state");
  cases.push((Ok(extra),None));
  for (raw,observed) in cases {
   let mut wire=Vec::new();
   let result=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    wire.push(query.canonical());
    std::future::ready(if query.operation=="target" {Ok(report.clone())} else {raw.clone()})
   }));
   assert_eq!(wire,[json!({"version":1,"operation":"target","parameters":{}}),request.canonical()]);
   assert_eq!(wire[1].to_string(),r#"{"operation":"commission","parameters":{},"version":1}"#);
   let history=request_journal::inspect(&journal).unwrap();
   let record=&history["records"][0];
   assert_eq!(record["response_ok"],json!(observed));
   assert_eq!(record["request_digest"],request.approval_id());
   assert_eq!(record["operation"],"commission");
   assert!(!history.to_string().contains("/private/"));
   match observed {
    Some(true)=>assert_eq!(result.unwrap(),accepted),
    Some(false)=>assert_eq!(result.unwrap()["ok"],false),
    None=>{
     assert_eq!(result.unwrap_err(),node_controller::COMMISSION_UNCERTAIN);
     let mut attempted=Vec::new();
     let next=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
      attempted.push(query.operation);
      std::future::ready(Ok(report.clone()))
     }));
     assert_eq!(attempted,["target"]);
     assert!(next.unwrap_err().contains("earlier local dispatch"));
    },
   }
   assert_eq!(record["state"],if observed.is_some() {"response_received"} else {"uncertain"});
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 fn reviewed_upgrade_fixture() -> (Target, Request, PathBuf, Value, Value, Value) {
  let (target,_,journal,mut report,_,_)=reviewed_install_fixture();
  report["result"]["installed"]=json!(true);
  report["result"]["operations"]=json!([{"operation":"upgrade","kind":"mutation","available":true,"blocker":null}]);
  let request=Request{version:1,operation:"upgrade".into(),parameters:json!({"release_id":"fixture-release","manifest_sha256":"a".repeat(64)})};
  let completed=json!({"version":1,"ok":true,"result":{"format":"synergy-software-upgrade-completed-v1","root":"/opt/Synergy",
   "old_package_sha256":"b".repeat(64),"new_package_sha256":"a".repeat(64),"resumed":false,"consensus_started":false,
   "automatic_restart":false,"package_sha256":"a".repeat(64),"vpn_stopped":false,"vpn_restart_required":true,"custody_or_state_copied":false}});
  let current=json!({"version":1,"ok":true,"result":{"package_sha256":"a".repeat(64),"already_current":true,
   "consensus_started":false,"automatic_restart":false}});
  (target,request,journal,report,completed,current)
 }

 #[test]
 fn reviewed_removal_uses_exact_confirmation_and_fences_ambiguous_outcomes() {
  let (target,_,journal,mut report,_,_)=reviewed_upgrade_fixture();
  report["result"]["operations"]=json!([{"operation":"uninstall","kind":"mutation","available":true,"blocker":null}]);
  let request=Request{version:1,operation:"uninstall".into(),parameters:json!({"confirmation":"/opt/Synergy"})};
  assert_eq!(request.validate(),Ok(true));

  let mut uninstalled=report.clone();
  uninstalled["result"]["installed"]=json!(false);
  let mut calls=Vec::new();
  let result=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
   calls.push(query.canonical());
   std::future::ready(Ok(uninstalled.clone()))
  }));
  let target_read=json!({"version":1,"operation":"target","parameters":{}});
  assert!(result.unwrap_err().contains("qualified removal operation"));
  assert_eq!(calls,[target_read.clone()]);
  assert!(!journal.exists());

  let removed=json!({"version":1,"ok":true,"result":{"removed_root":"/opt/Synergy","logical_removal_verified":true,
   "forensic_erasure_proven":false,"backup_created":false,"remaining_host_managed_records":[]}});
  let mut scope_mismatch=removed.clone();
  scope_mismatch["result"]["removed_root"]=json!("/opt/synergy");
  let refused=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Exact request needs one-time host operator authorization"}});
  let post_grant_error=json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"Controller validation or lifecycle operation failed"}});
  for (response,state,reported_ok) in [(Some(removed),"response_received",Some(true)), (Some(refused),"response_received",Some(false)),
   (Some(scope_mismatch),"uncertain",None),(Some(post_grant_error),"uncertain",None),(None,"uncertain",None)] {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(report.clone()),
     "uninstall"=>response.as_ref().map_or_else(||Err("Controller timed out".into()),|reply|crate::node_removal_scope::removal_reply(reply).map_err(String::from)),
     _=>unreachable!(),
    })
   }));
   assert_eq!(calls,[target_read.clone(),request.canonical()]);
   assert_eq!(calls[1].to_string(),r#"{"operation":"uninstall","parameters":{"confirmation":"/opt/Synergy"},"version":1}"#);
   let history=request_journal::inspect(&journal).unwrap();
   assert_eq!(history["records"][0]["state"],state);
   assert_eq!(history["records"][0]["request_digest"],request.approval_id());
   assert_eq!(history["records"][0]["response_ok"],json!(reported_ok));
   assert!(!history.to_string().contains("/opt/Synergy"));
   if reported_ok==Some(true) {
    assert_eq!(result.unwrap()["result"]["schema"],"nodenetwork-logical-removal-v1");
   } else if reported_ok==Some(false) {
    assert_eq!(result.unwrap()["error"]["code"],"authorization_required");
   } else {
    assert!(result.unwrap_err().contains("Removal outcome is uncertain"));
    assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"uninstall",&request.canonical()).is_err());
   }
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 #[test]
 fn reviewed_upgrade_requires_installed_qualified_target_before_journaling() {
  let (target,request,journal,report,_,_)=reviewed_upgrade_fixture();
  assert_eq!(request.validate(),Ok(true));
  let mut unreviewed=request.clone();
  unreviewed.parameters["resume"]=json!(true);
  assert!(unreviewed.validate().is_err());
  for (key,wrong) in [("installed",json!(false)),("architecture",json!("arm64")),("operations",json!([
   {"operation":"upgrade","kind":"mutation","available":true},{"operation":"upgrade","kind":"read","available":true}
  ]))] {
   let mut target_reply=report.clone();
   target_reply["result"][key]=wrong;
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(target_reply.clone()))
   }));
   assert!(result.unwrap_err().contains("qualified upgrade operation"));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
   assert!(!journal.exists());
  }
 }

 #[test]
 fn reviewed_upgrade_accepts_exact_owner_outcomes_without_sealed_preflight_and_fences_drift() {
  let (target,request,journal,report,completed,current)=reviewed_upgrade_fixture();
  let mut resumed=completed.clone();
  resumed["result"]["resumed"]=json!(true);
  let mut mismatched=completed.clone();
  mismatched["result"]["new_package_sha256"]=json!("c".repeat(64));
  let refused=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Exact request needs one-time host operator authorization"}});
  let unknown=json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"installation receipt is outside recorded upgrade"}});
  for (reply,outcome,journal_state) in [(current.clone(),Some("already_current"),"response_received"),
   (completed.clone(),Some("completed"),"response_received"),(resumed,Some("resumed"),"response_received"),
   (refused,None,"response_received"),(mismatched,None,"uncertain"),(unknown,None,"uncertain")] {
   let mut calls=Vec::new();
   let response=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(report.clone()),"upgrade"=>node_controller::upgrade_reply(&query,&reply).map_err(String::from),_=>unreachable!(),
    })
   }));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),request.canonical()]);
   assert_eq!(calls[1].to_string(),format!(r#"{{"operation":"upgrade","parameters":{{"manifest_sha256":"{}","release_id":"fixture-release"}},"version":1}}"#,"a".repeat(64)));
   let history=request_journal::inspect(&journal).unwrap();
   assert_eq!(history["records"][0]["state"],journal_state);
   assert_eq!(history["records"][0]["request_digest"],request.approval_id());
   assert!(!history.to_string().contains("fixture-release"));
   if let Some(outcome)=outcome {
    let (previous,vpn)=if outcome=="already_current" {(Value::Null,Value::Null)} else {(json!("b".repeat(64)),json!(true))};
    assert_eq!(response.unwrap()["result"],json!({"schema":"nodenetwork-software-upgrade-v1","outcome":outcome,
     "manifest_sha256":"a".repeat(64),"previous_manifest_sha256":previous,"vpn_restart_required":vpn}));
   } else if journal_state=="uncertain" {
    assert!(response.unwrap_err().contains("Software upgrade outcome is uncertain"));
    assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"upgrade",&request.canonical()).is_err());
   } else {
    assert_eq!(response.unwrap()["ok"],false);
   }
   std::fs::remove_dir_all(&journal).unwrap();
  }
  for (key,wrong) in [("package_sha256",json!("c".repeat(64))),("old_package_sha256",json!("a".repeat(64))),
   ("root",json!("/opt/synergy")),("resumed",json!("true")),("vpn_stopped",json!(true)),
   ("vpn_restart_required",Value::Null),("consensus_started",json!(true)),("automatic_restart",json!(true)),
   ("custody_or_state_copied",json!(true)),("already_current",json!(true))] {
   let mut changed=completed.clone();
   changed["result"][key]=wrong;
   assert!(node_controller::upgrade_reply(&request,&changed).is_err(), "{key}");
  }
  let mut wrong_current=current;
  wrong_current["result"]["package_sha256"]=json!("c".repeat(64));
  assert!(node_controller::upgrade_reply(&request,&wrong_current).is_err());
 }

 #[test]
 fn service_registration_requires_one_current_installed_capability_before_journal() {
  let (target,request,journal,report,_)=service_registration_fixture();
  assert_eq!(request.validate(),Ok(true));
  let mut unsupported=request.clone();
  unsupported.parameters=json!({"unit":"synergy-node"});
  assert!(unsupported.validate().is_err());

  let mut not_installed=report.clone();
  not_installed["result"]["installed"]=json!(false);
  let mut unqualified=report.clone();
  unqualified["result"]["operations"][0]["available"]=json!(false);
  let mut duplicate=report;
  let rows=duplicate["result"]["operations"].as_array_mut().unwrap();
  rows.push(rows[0].clone());
  for invalid in [not_installed,unqualified,duplicate] {
   let mut reads=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    reads.push(query.canonical());
    std::future::ready(Ok(invalid.clone()))
   }));
   assert!(outcome.unwrap_err().contains("qualified service registration"));
   assert_eq!(reads,[json!({"version":1,"operation":"target","parameters":{}})]);
   assert!(!journal.exists());
  }
 }

 #[test]
 fn service_registration_scopes_wire_receipt_and_uncertain_journal() {
  let (target,request,journal,report,valid)=service_registration_fixture();
  let mut relay=valid.clone();
  relay["result"]["registered"].as_array_mut().unwrap().push(json!("/etc/systemd/system/synergy-canary-rpc-relay.service"));
  let mut foreign=valid.clone();
  foreign["result"]["registered"][1]=json!("/private/foreign.service");
  let mut started=valid.clone();
  started["result"]["services_started"]=json!(true);
  let refused=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Exact request needs one-time host operator authorization"}});
  let unknown=json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"conflicting host service exists"}});
  for (reply, ids, state) in [(valid, json!(["node","vpn"]), "response_received"),
   (relay, json!(["node","vpn","canary-rpc-relay"]), "response_received"),
   (refused, Value::Null,"response_received"), (foreign,Value::Null,"uncertain"),
   (started,Value::Null,"uncertain"), (unknown,Value::Null,"uncertain")] {
   let mut operations=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    operations.push(query.canonical());
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(report.clone()),"register"=>node_controller::register_service_reply(&reply).map_err(String::from),_=>unreachable!(),
    })
   }));
   assert_eq!(operations,[json!({"version":1,"operation":"target","parameters":{}}),request.canonical()]);
   assert_eq!(operations[1].to_string(),r#"{"operation":"register","parameters":{},"version":1}"#);
   let history=request_journal::inspect(&journal).unwrap();
   assert_eq!(history["records"][0]["state"],state);
   assert_eq!(history["records"][0]["request_digest"],request.approval_id());
   assert!(!history.to_string().contains(".service"));
   if state=="uncertain" {
    assert!(outcome.unwrap_err().contains("uncertain"));
    assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"register",&request.canonical()).is_err());
   } else if ids.is_array() {
    assert_eq!(outcome.unwrap()["result"],json!({"schema":"nodenetwork-service-registration-v1","services":ids,
     "services_started":false,"boot_enabled":false}));
   } else {
    assert_eq!(outcome.unwrap()["ok"],false);
   }
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 fn genesis_stage_fixture() -> (Target,GenesisStageReview,PreparedGenesisStage,Value,Value,PathBuf) {
  let (target,_,_,journal)=genesis_bind_scope_fixture();
  let files_dir=journal.with_extension("inputs");
  std::fs::create_dir(&files_dir).unwrap();
  let paths=GENESIS_INPUTS.map(|(name,_)|files_dir.join(name));
  for (path,bytes) in paths.iter().zip([b"{\"sample\":1}\r\n".as_slice(),b"{}",&[0,255,128,2]]) {std::fs::write(path,bytes).unwrap();}
  let prepared=PreparedGenesisStage::read(paths).unwrap();
  std::fs::remove_dir_all(&files_dir).unwrap();
  let summary=prepared.summary();
  let address="synv1".to_owned()+&"a".repeat(36);
  let formation=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-formation-v1","address":address,"pending":true,
   "possession_verified":true,"membership_granted":false,"network_id":"fixture-formation","chain_id":"99999","formation_sha256":"b".repeat(64)}});
  let policy=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-genesis-stage-policy-v1","address":address,
   "genesis_sha256":summary["inputs"][0]["sha256"],"authority_sha256":summary["inputs"][1]["sha256"],"authority_root_sha256":summary["inputs"][2]["sha256"]}});
  let review=serde_json::from_value(json!({"networkId":"fixture-formation","chainId":"99999","validatorAddress":address,
   "formationSha256":"b".repeat(64),"requestSha256":summary["requestSha256"],"pins":{
    "genesisSha256":policy["result"]["genesis_sha256"],"authoritySha256":policy["result"]["authority_sha256"],
    "authorityRootSha256":policy["result"]["authority_root_sha256"]}})).unwrap();
  (target,review,prepared,formation,policy,journal)
 }

 #[test]
 fn genesis_stage_command_stops_after_changed_native_policy_before_creating_journal() {
  let (target,review,prepared,formation,mut policy,journal)=genesis_stage_fixture();
  policy["result"]["authority_sha256"]=json!("e".repeat(64));
  let mut reads=Vec::new();
  let refused=tauri::async_runtime::block_on(dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|request| {
   reads.push(request.canonical());
   std::future::ready(Ok(if request.operation=="formation_status" {formation.clone()} else {policy.clone()}))
  },|_|std::future::ready(Err("Unexpected staging transport".into()))));
  assert!(refused.unwrap_err().contains("differs from the reviewed address or input pins"));
  assert_eq!(reads,vec![json!({"version":1,"operation":"formation_status","parameters":{}}),
   json!({"version":1,"operation":"genesis_stage_preflight","parameters":{}})]);
  assert!(!journal.exists());
 }

 #[test]
 fn genesis_stage_command_fences_scope_mismatch_and_sends_only_exact_native_wire() {
  let (target,review,prepared,formation,policy,journal)=genesis_stage_fixture();
  let digest=prepared.request_sha256.clone();
  let exact=prepared.wire.clone();
  let mut receipt=policy.clone();
  receipt["result"]["schema"]=json!("nodenetwork-genesis-stage-v1");
  receipt["result"]["request_sha256"]=json!(digest);
  receipt["result"]["genesis_authority_verified"]=json!(true);
  receipt["result"]["membership_verified"]=json!(true);
  receipt["result"]["staged"]=json!(true);
  let valid=review.stage_reply(&receipt).unwrap();
  assert!(valid["result"].get("request_sha256").is_none());
  receipt["result"]["address"]=json!("synv1".to_owned()+&"b".repeat(36));
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|request| {
   std::future::ready(Ok(if request.operation=="formation_status" {formation.clone()} else {policy.clone()}))
  },|wire|{
   assert_eq!(wire,exact);
   let object:Value=serde_json::from_str(&wire).unwrap();
   assert_eq!(object,json!({"version":1,"operation":"genesis_stage","parameters":{"artifacts":{
    "genesis.json":"{\"sample\":1}\r\n","authority.json":"{}","authority-root.pub":"AP+AAg=="}}}));
   std::future::ready(Ok(receipt))
  }));
  assert!(outcome.unwrap_err().contains("outcome is uncertain"));
  let history=request_journal::inspect(&journal).unwrap();
  assert_eq!(history["records"][0]["state"],"uncertain");
  assert_eq!(history["records"][0]["request_digest"],digest);
  assert!(!history.to_string().contains("sample"));
  assert!(request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_stage",digest).is_err());
  std::fs::remove_dir_all(journal).unwrap();
 }

 #[test]
 fn genesis_bind_command_rechecks_scope_before_opening_the_journal_or_dispatching() {
  let (target,request,review,journal)=genesis_bind_scope_fixture();
  let mut calls=Vec::new();
  let mut drift=genesis_binding_projection(false);
  drift["result"]["address"]=json!("synv1".to_owned()+&"b".repeat(36));
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_binding(&target,&request,&review,&journal, |submitted| {
   calls.push(submitted.canonical());
   std::future::ready(Ok(drift.clone()))
  }));
  assert!(outcome.unwrap_err().contains("differs from the reviewed unbound Genesis scope"));
  assert_eq!(calls,vec![json!({"version":1,"operation":"genesis_binding_preflight","parameters":{}})]);
  assert!(!journal.exists());
 }

 #[test]
 fn genesis_bind_command_preserves_exact_wire_and_journals_validly_typed_scope_drift_as_uncertain() {
  let (target,request,review,journal)=genesis_bind_scope_fixture();
  let mut calls=Vec::new();
  let mut drift=genesis_binding_projection(true);
  drift["result"]["chain_id"]=json!("1266");
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_binding(&target,&request,&review,&journal, |submitted| {
   calls.push(submitted.canonical());
   let report=if submitted.operation=="genesis_binding_preflight" {genesis_binding_projection(false)} else {drift.clone()};
   std::future::ready(Ok(report))
  }));
  assert!(outcome.unwrap_err().contains("outcome is uncertain"));
  assert_eq!(calls,vec![json!({"version":1,"operation":"genesis_binding_preflight","parameters":{}}),request.canonical()]);
  assert_eq!(calls[1].to_string(),format!(r#"{{"operation":"genesis_bind","parameters":{{"genesis_sha256":"{}"}},"version":1}}"#,"a".repeat(64)));
  let history=request_journal::inspect(&journal).unwrap();
  assert_eq!(history["records"][0]["state"],"uncertain");
  assert_eq!(history["records"][0]["request_digest"],"0e8a5f309948535cbc5fa7fdb13f298d053a1d964d673646d247a1008649463e");
  assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),&request.operation,&request.canonical()).is_err());
  assert!(!history.to_string().contains("fixture-formation"));
  std::fs::remove_dir_all(journal).unwrap();
 }
}
