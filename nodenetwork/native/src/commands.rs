pub(crate) async fn controller(app:&tauri::AppHandle,target:crate::node_controller::Target,request:crate::node_controller::Request,control:&std::path::Path)->Result<serde_json::Value,String>{
 use tauri::Manager;crate::authorization_lifecycle::execute(&app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?,target,request,control).await
}
pub(crate) async fn exact_continuation(app:&tauri::AppHandle,target:&crate::node_controller::Target,request:&crate::node_controller::Request,control:&std::path::Path,pins:Option<&serde_json::Value>)->Result<(),String>{
 use tauri::Manager;crate::authorization_lifecycle::grant(&app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?,target,request,control,pins).await
}
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::{future::Future, path::{Path, PathBuf}};
use tauri::Manager;
use crate::{formation,node_network,node_controller,node_bootstrap,request_journal};
use crate::genesis_stage::{GenesisStageReview, PreparedGenesisStage, INPUTS as GENESIS_INPUTS};
use crate::request_journal::CustodyReceiptKind;
fn runtime_probe_refusal(reply:&Value)->String{
 const GENERIC:&str="Candidate Linux origin/crypto smoke refused; no software or authority was changed";
 const FAILURES:&[(&str,&str)]=&[
  ("runtime_probe_not_executable","Authenticated candidate node is not executable"),
  ("runtime_probe_scope_refused","Installed runtime probe scope refused"),
  ("runtime_probe_package_refused","Authenticated candidate inventory refused"),
  ("runtime_probe_origin_refused","Approved public origin refused"),
  ("runtime_probe_execution_refused","Candidate native origin verifier execution refused"),
  ("runtime_probe_response_refused","Candidate native origin response refused"),
  ("runtime_probe_changed","Runtime probe scope changed during verification"),
 ];
 if crate::gateway_admission::exact(reply,&["version","ok","error"])&&reply["version"]==1&&reply["ok"]==false
  &&crate::gateway_admission::exact(&reply["error"],&["code","message"]){
  for (code,message) in FAILURES{
   if reply["error"]["code"]==*code&&reply["error"]["message"]==*message{
    return format!("{code}: {message}; no software or authority was changed")
   }
  }
 }
 GENERIC.into()
}
#[cfg(test)]use crate::genesis_stage::GENESIS_STAGE_UNCERTAIN;
#[tauri::command]
pub async fn portal_nodenetwork_legacy_gateway_plan(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,operator:String)->Result<Value,String>{
 main_only(&window)?;
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 crate::legacy_gateway_plan::inspect(&target,&operator,&control).await
}
#[tauri::command]
pub fn portal_nodenetwork_request_scope(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target)->Result<Value,String>{
 main_only(&window)?; target.validate()?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?;
 Ok(serde_json::json!({"targetDigest":request_journal::scoped_digest(&base,&target.journal_identity())?}))
}

#[tauri::command]
pub fn portal_nodenetwork_requests(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<Value,String>{
 main_only(&window)?;
 request_journal::inspect(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?)
}

#[tauri::command]
pub async fn portal_nodenetwork_review_genesis_stage_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,
 target:node_controller::Target,record_id:String)->Result<Value,String>{
 read_custody_receipt(window,app,target,record_id,CustodyReceiptKind::GenesisStaging).await
}

#[tauri::command]
pub async fn portal_nodenetwork_review_genesis_binding_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,
 target:node_controller::Target,record_id:String)->Result<Value,String>{
 read_custody_receipt(window,app,target,record_id,CustodyReceiptKind::GenesisBinding).await
}

#[tauri::command]
pub async fn portal_nodenetwork_review_formation_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,
 target:node_controller::Target,record_id:String)->Result<Value,String>{
 read_custody_receipt(window,app,target,record_id,CustodyReceiptKind::Formation).await
}

#[tauri::command]
pub async fn portal_nodenetwork_review_identity_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,
 target:node_controller::Target,record_id:String)->Result<Value,String>{
 read_custody_receipt(window,app,target,record_id,CustodyReceiptKind::Identity).await
}

#[tauri::command]
pub async fn portal_nodenetwork_review_upgrade_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,
 target:node_controller::Target,record_id:String,release_id:String,manifest_sha256:String)->Result<Value,String>{
 let selection=node_controller::Request{version:1,operation:"upgrade".into(),
  parameters:serde_json::json!({"release_id":release_id,"manifest_sha256":manifest_sha256})};
 read_software_receipt(window,app,target,record_id,selection).await
}

#[tauri::command]
pub async fn portal_nodenetwork_reconcile_continuation(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;
 let base=app.path().app_local_data_dir().map_err(|_|"Native app state unavailable")?;
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let(operator,review,pin,snapshot)=crate::authorization_lifecycle::continuation_recovery(&base,&target,&control).await?;
 let message=format!("Target: {}\nPending continuation SHA-256: {}\n\nVerify only that this exact continuation was never applied: unchanged predecessor, no request grant or consumed audit, no partial exchange, same installed master/formation/initial approval. Only a fresh pinned proof can retire the exact local pending intent as NOT APPLIED, never success. No target change, grant creation or operation retry occurs. Any next mutation requires separate review.",target.label(),review["context"]["pending_sha256"]);
 let accepted=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review pending continuation nonapplication").buttons(MessageDialogButtons::OkCancelCustom("Verify and release only if not applied".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Continuation review interrupted")?;
 if !accepted{return Ok(None)}
 let _transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
 let(operator_now,fresh,pin_now,snapshot_now)=crate::authorization_lifecycle::continuation_recovery(&base,&target,&control).await?;
 if operator!=operator_now||pin!=pin_now||snapshot!=snapshot_now||review["pending_json"]!=fresh["pending_json"]||["initial_sha256","authorization","formation_sha256","target","selection","genesis_pins","pending_sha256"].iter().any(|k|review["context"][k]!=fresh["context"][k]){return Err("Continuation scope changed during review; no local intent released".into())}
 let deadline=std::time::Instant::now();
 let proof=node_bootstrap::prove_continuation_not_applied(&target,&operator,&control,pin.as_deref(),&fresh).await?;
 if deadline.elapsed()>std::time::Duration::from_secs(120){return Err("Continuation proof expired; pending intent preserved".into())}
 crate::authorization_lifecycle::retire_continuation(&base,&target,&fresh,&proof,&snapshot)?;
 Ok(Some(proof))
}

#[tauri::command]
pub async fn portal_nodenetwork_upgrade_not_applied(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,record_id:String,release_id:String,manifest_sha256:String)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;
 if !cfg!(debug_assertions){return Err("Upgrade non-application reconciliation is unavailable in production".into())}
 let request=node_controller::Request{version:1,operation:"upgrade".into(),parameters:serde_json::json!({"release_id":release_id,"manifest_sha256":manifest_sha256})};request.validate()?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?;
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let picker=window.clone();let folder=tauri::async_runtime::spawn_blocking(move||picker.dialog().file().set_parent(&picker).set_title("Select independently approved current master for read-only upgrade verification").blocking_pick_folder()).await.map_err(|_|"Verifier selection interrupted")?;
 let Some(folder)=folder else{return Ok(None)};
 let verifier=node_bootstrap::upgrade_verifier(&folder.into_path().map_err(|_|"Select a local approved verifier master")?)?;
 let (operator,context,host_pin,adoption)=crate::authorization_lifecycle::update_context(&base,&target,&control).await?;
 if adoption["selection"]["release_id"]!=request.parameters["release_id"]||adoption["selection"]["manifest_sha256"]!=request.parameters["manifest_sha256"]||adoption["previous_selection"]!=context["selection"]{return Err("Original upgrade adoption differs; no journal outcome changed".into())}
 let message=format!("READ-ONLY UPGRADE NON-APPLICATION PROOF\nTarget: {}\nOriginal upgrade request: {}\nVerifier manifest: {}\n\nVerify the complete unchanged old installation, exact consumed audit, stopped guest and services, original staged candidate, and absence of upgrade intent or partial exchange. Only a proven non-applied outcome is recorded as FALSE, never success. No upgrade is retried. Another release requires a separate review and authorization.",target.label(),request.approval_id(),verifier["verifier_sha256"]);
 let prompt=window.clone();let accepted=tauri::async_runtime::spawn_blocking(move||prompt.dialog().message(message).parent(&prompt).title("Review unchanged upgrade outcome").buttons(MessageDialogButtons::OkCancelCustom("Verify without replay".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Upgrade proof confirmation interrupted")?;
 if !accepted{return Ok(None)}
 let (operator_now,context_now,pin_now,adoption_now)=crate::authorization_lifecycle::update_context(&base,&target,&control).await?;
 if operator_now!=operator||pin_now!=host_pin||adoption_now!=adoption||!crate::authorization_lifecycle::same_update_review(&context,&context_now){return Err("Upgrade proof target context changed during review".into())}
 let ticket=request_journal::upgrade_not_applied_ticket(&base,&target.journal_identity(),&record_id,&request.canonical())?;
 let wire=serde_json::json!({"context":context_now,"adoption":adoption,"request":request.canonical(),"challenge":ticket.challenge(),"verifier_manifest_json":verifier["verifier_manifest_json"],"verifier_conformance":verifier["verifier_conformance"]});
 let proof=node_bootstrap::prove_upgrade_not_applied(&target,&operator,&control,host_pin.as_deref(),wire,verifier["verifier_sha256"].as_str().ok_or("Verifier pin unavailable")?).await?;
 request_journal::verify_upgrade_not_applied(&base,&target.journal_identity(),&request.canonical(),ticket)?;Ok(Some(proof))
}

#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct InstallReceiptSelection {
 release_id:String,
 manifest_sha256:String,
 network_id:String,
 chain_id:String,
 node_name:String,
}

impl InstallReceiptSelection {
 fn request(self)->Result<node_controller::Request,String>{
  let chain=self.chain_id.parse::<u64>().ok().filter(|value|*value>0&&value.to_string()==self.chain_id)
   .ok_or("Enter the exact nonzero recorded chain ID in unsigned decimal.")?;
  Ok(node_controller::Request{version:1,operation:"install".into(),parameters:serde_json::json!({
   "release_id":self.release_id,"manifest_sha256":self.manifest_sha256,"network_id":self.network_id,
   "chain_id":chain,"node_name":self.node_name,
  })})
 }
}

#[tauri::command]
pub async fn portal_nodenetwork_review_install_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,
 target:node_controller::Target,record_id:String,selection:InstallReceiptSelection)->Result<Value,String>{
 read_software_receipt(window,app,target,record_id,selection.request()?).await
}

async fn read_software_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,
 record_id:String,selection:node_controller::Request)->Result<Value,String>{
 main_only(&window)?;
 target.validate()?;
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let journal=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?;
 let serial=node_controller::SERIAL.lock().await;
 review_software_receipt(&target,&record_id,&selection,&journal,|request| {
  let (target,directory,serial)=(&target,&directory,&serial);
  async move {
   if request.operation=="target" {
    node_controller::execute_locked(target,&request,directory,None,serial).await
   } else {
    node_controller::execute_receipt_raw_locked(target,&request,directory,serial).await
   }
  }
 }).await
}

async fn review_software_receipt<Fut>(target:&node_controller::Target,record_id:&str,selection:&node_controller::Request,
 journal:&Path,mut read:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let operation=selection.operation.as_str();
 let schema=match operation {
  "install"=>"nodenetwork-install-receipt-review-v1",
  "upgrade"=>"nodenetwork-upgrade-receipt-review-v1",
  _=>return Err("Select a supported installation receipt review.".into()),
 };
 selection.validate()?;
 let fingerprint=target.journal_identity();
 let digest=selection.approval_id();
 let lookup=||request_journal::unresolved_software_receipt(journal,&fingerprint,record_id,operation,&digest);
 let record=lookup()?;
 let recheck=|| {
  if lookup()?==record {return Ok(());}
  Err(format!("The selected {operation} dispatch changed. Refresh local history and select it again."))
 };
 let query=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let controller=read(query("target")).await;
 recheck()?;
 let status=if controller.as_ref().is_ok_and(|reply|node_controller::supports_receipt_review(reply,"diagnostics")) {
  let diagnostics=read(query("diagnostics")).await;
  recheck()?;
  diagnostics.as_ref().map_or("unavailable",|reply|crate::node_diagnostics::software_receipt_status(reply,selection))
 } else {"unavailable"};
 Ok(serde_json::json!({"schema":schema,"status":status}))
}

async fn read_custody_receipt(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,
 record_id:String,kind:CustodyReceiptKind)->Result<Value,String>{
 main_only(&window)?;
 target.validate()?;
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let journal=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?;
 let serial=node_controller::SERIAL.lock().await;
 review_custody_receipt(&target,&record_id,&journal,kind,|request| {
  let (target,directory,serial)=(&target,&directory,&serial);
  async move {
   if request.operation=="target" {
    node_controller::execute_locked(target,&request,directory,None,serial).await
   } else {
    node_controller::execute_receipt_raw_locked(target,&request,directory,serial).await
   }
  }
 }).await
}

async fn review_custody_receipt<Fut>(target:&node_controller::Target,record_id:&str,journal:&Path,kind:CustodyReceiptKind,
 mut read:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let fingerprint=target.journal_identity();
 let record=request_journal::unresolved_custody_receipt(journal,&fingerprint,record_id,kind)?;
 let recheck=|| {
  let current=request_journal::unresolved_custody_receipt(journal,&fingerprint,record_id,kind)?;
  if current==record {return Ok(());}
  Err(format!("The selected {} dispatch changed. Refresh local history and select it again.",kind.label()))
 };
 let query=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let controller=read(query("target")).await;
 recheck()?;
 let (schema,read_operation)=match kind {
  CustodyReceiptKind::GenesisStaging=>("nodenetwork-genesis-stage-receipt-review-v1","genesis_binding_preflight"),
  CustodyReceiptKind::GenesisBinding=>("nodenetwork-genesis-binding-receipt-review-v1","genesis_binding_preflight"),
  CustodyReceiptKind::Formation=>("nodenetwork-formation-receipt-review-v1","formation_status"),
  CustodyReceiptKind::Identity=>("nodenetwork-identity-receipt-review-v1","identity_status"),
 };
 let mut identity_provenance="none";
 let status=if controller.as_ref().is_ok_and(|reply|node_controller::supports_receipt_review(reply,read_operation)) {
  match (read(query(read_operation)).await,kind) {
   (Ok(reply),CustodyReceiptKind::GenesisStaging)=>node_controller::genesis_receipt_status(&reply,record.request_digest(),"stage_request_sha256"),
   (Ok(reply),CustodyReceiptKind::GenesisBinding)=>node_controller::genesis_receipt_status(&reply,record.request_digest(),"request_sha256"),
   (Ok(reply),CustodyReceiptKind::Formation)=>node_controller::formation_receipt_status(&reply,record.request_digest()),
   (Ok(reply),CustodyReceiptKind::Identity)=>{
    let (status,provenance)=node_controller::identity_receipt_status(&reply,record.request_digest());
    identity_provenance=provenance;
    status
   },
   (Err(_),_)=>"unsupported",
  }
 } else {"unsupported"};
 recheck()?;
 let mut projection=serde_json::json!({"schema":schema,"status":status});
 if matches!(kind,CustodyReceiptKind::Identity) {projection["provenance"]=serde_json::json!(identity_provenance);}
 Ok(projection)
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
pub async fn portal_nodenetwork_review_operator_key(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Option<node_controller::Target>)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 if let Some(selected)=&target{selected.validate()?;if selected.kind!="remote"||selected.guest.is_some(){return Err("Select a physical remote target for its operator public identity".into())}}
 let view=window.clone();
 let Some(key)=tauri::async_runtime::spawn_blocking(move || {
  let Some(path)=pick_operator_public_key(&view)? else{return Ok(None)};
  node_bootstrap::selected_operator_key(&path).map(Some)
 }).await.map_err(|_|"Public key inspection did not finish.")?? else{return Ok(None)};
 let Some(target)=target else{return node_bootstrap::review_operator_public_key_bytes(&key).map(Some)};
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let base=app.path().app_local_data_dir().map_err(|_|"Native authorization unavailable")?;
 // Preserve independent target host trust; selecting a client key cannot grant host trust.
 let _pin=match crate::chain1266_relocation::destination_pin(&target,&directory)?{
  Some(pin)=>pin,
  None=>match crate::authorization_lifecycle::reinstallation_host_pin(&base,&target,&directory)?{Some(pin)=>pin,None=>node_controller::bootstrap_host_pin(&target,&directory)?},
 };
 let review=node_bootstrap::review_operator_public_key_bytes(&key)?;
 let message=format!("Target: {}\nOperator public-key SHA-256: {}\n\nBind this public key to this physical target's restricted controller SSH connection. The matching private key must already be available through your SSH agent. No private key is read or stored, no target operation is sent, and existing host-key verification remains mandatory. This does not prove the historical bootstrap key.",target.label(),review["canonicalSha256"]);
 let accepted=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Select target operator public key").buttons(MessageDialogButtons::OkCancelCustom("Use this public key for this target".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Operator identity confirmation interrupted")?;
 if !accepted{return Ok(None)}
 let _serial=node_controller::SERIAL.lock().await;
 // A live master predates this selection and would ignore -i. Close only this
 // exact restricted controller mux; the next exchange proves the selected key.
 node_controller::close_connection_checked(&target,&directory,"synergy-nodenetwork").await?;
 node_bootstrap::retain_operator_identity(&target,&directory,&key).map(Some)
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
 main_only(&window)?; review.validate()?;
 portal_nodenetwork_stage_signed_genesis(window,app,target,review.validator_address().to_owned()).await
}

#[cfg(test)]
async fn dispatch_reviewed_genesis_stage<Read,Stage>(target:&node_controller::Target,review:&GenesisStageReview,prepared:PreparedGenesisStage,
 journal:&Path,mut read:impl FnMut(node_controller::Request)->Read,stage:impl FnOnce(String)->Stage)->Result<Value,String>
where Read:Future<Output=Result<Value,String>>,Stage:Future<Output=Result<Value,String>> {
 review.matches_preparation(&prepared)?;
 let query=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let current_target=read(query("target")).await.map_err(|_|"The controller could not recheck the selected target before Genesis staging.")?;
 node_controller::require_genesis_target(&current_target,"genesis_stage")?;
 let formation=read(query("formation_status")).await
  .map_err(|_|"The controller could not recheck the prepared formation before Genesis staging.")?;
 review.require_current_formation(&formation)?;
 let policy=read(query("genesis_stage_preflight")).await
  .map_err(|_|"The controller could not recheck the reviewed Genesis staging policy.")?;
 review.require_current_policy(&policy)?;
 let current_target=read(query("target")).await.map_err(|_|"The controller could not recheck Genesis staging qualification after reviewing custody and pins.")?;
 node_controller::require_genesis_target(&current_target,"genesis_stage")?;
 let dispatch=request_journal::Dispatch::begin_digest(journal,&target.journal_identity(),"genesis_stage",prepared.request_sha256)?;
 let outcome=stage(prepared.wire).await.map_err(|_|GENESIS_STAGE_UNCERTAIN.to_owned()).and_then(|reply|review.stage_reply(&reply));
 dispatch.finish(&outcome).map_err(|_|"Genesis staging outcome could not be saved. Review the target before another change.")?;
 outcome
}
#[tauri::command]
pub async fn portal_nodenetwork_controller(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,request:node_controller::Request)->Result<Value,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 target.validate()?;
 if request.operation.starts_with("treasury_send_"){return Err("Use the dedicated native ordinary treasury review and one-use dispatch route".into())}
 if matches!(request.operation.as_str(),"treasury_prepare"|"treasury_export"|"treasury_preflight"|"commissioning_observation"|"genesis_stage"|"genesis_stage_preflight"|"network_formation_prepare"|"network_formation_export"|"vpn_enroll"|"vpn_bind"|"vpn_retire"|"vpn_cancel_unused"|"vpn_unused_preflight"|"network_transport_prepare"|"network_transport_sign"|"network_transport_export"|"guest_preflight"|"guest_boot_diagnostics"|"guest_status"|"guest_create"|"guest_stop"|"guest_resume"|"guest_remove"){
  return Err("Use the native signed Genesis folder review.".into());
 }
 let mutation=request.validate()?;
 if matches!(request.operation.as_str(), "chain1266_relocate" | "chain1266_relocation_status" | "chain1266_relocate_records" | "chain1266_relocation_records_status") {
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  return crate::chain1266_relocation::run(&window, &target, &directory, mutation, request.operation.contains("records")).await;
 }
 if matches!(request.operation.as_str(), "chain1266_retire" | "chain1266_retirement_status") {
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  return crate::chain1266_relocation::run_retirement(&window, &target, &directory, mutation).await;
 }
 if request.operation=="legacy_peer_preflight"{
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  return crate::vpn_enrollment::legacy_read(&window,&app,target,&directory).await;
 }
 if request.operation=="legacy_peer_key_read"{
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  return crate::vpn_enrollment::legacy_peer_key_read(&window,target,&directory).await;
 }
 if matches!(request.operation.as_str(),"legacy_peer_retire"|"legacy_peer_retire_status"){
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let base=app.path().app_local_data_dir().map_err(|_|"Portal operation directory unavailable")?;
  return crate::vpn_enrollment::legacy_retire(&window,target,&directory,&base,request.operation=="legacy_peer_retire_status").await;
 }
 if matches!(request.operation.as_str(), "legacy_gateway_service_status" | "legacy_gateway_service_stop") {
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let base=app.path().app_local_data_dir().map_err(|_|"Portal operation directory unavailable")?;
  return crate::legacy_gateway_plan::quiesce(&window, &target, &directory, &base, mutation).await;
 }
 if request.operation=="legacy_gateway_root_retire" {
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let base=app.path().app_local_data_dir().map_err(|_|"Portal operation directory unavailable")?;
  return crate::legacy_gateway_plan::retire_root(&window, &target, &directory, &base).await;
 }
 if request.operation=="operator_auth_load"{
  #[cfg(target_os="macos")]{
   let home=app.path().home_dir().map_err(|_|"Operator home unavailable")?;
   let directory=node_controller::control_directory(&home)?;
   if let Some(v)=crate::operator_credential::already_loaded(&target,&directory).await?{return Ok(serde_json::json!({"version":1,"ok":true,"result":v}))}
   let reviewed=crate::operator_credential::review(&home,&target,&directory)?;
   let prompt=window.clone();let message=format!("Load only the existing selected SSH credential into this app's existing OS agent for at most one hour?\nTarget: {}\nSelected public identity SHA256: {}\nApple's OS loader alone handles the existing file and Keychain. No passphrase entry, new credential, remote connection or automatic renewal. An already loaded identity is left unchanged.",target.label(),reviewed.public_sha());
   let accepted=tauri::async_runtime::spawn_blocking(move||prompt.dialog().message(message).parent(&prompt).title("Load selected existing SSH credential").buttons(MessageDialogButtons::OkCancelCustom("Load selected credential for one hour".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Local credential review interrupted")?;
   if !accepted{return Err("Local credential load cancelled; no credential was loaded".into())}
   let _serial=node_controller::SERIAL.lock().await;
   return Ok(serde_json::json!({"version":1,"ok":true,"result":crate::operator_credential::load(reviewed,&home,&target,&directory).await?}));
  }
  #[cfg(not(target_os="macos"))]return Err("Existing Keychain credential activation is available only on macOS; no credential was loaded".into());
 }
 if request.operation=="operator_auth_status"{
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  return Ok(serde_json::json!({"version":1,"ok":true,"result":crate::operator_auth::status(&target,&directory).await?}));
 }
 if request.operation=="upgrade_native_preflight"{
  if !node_bootstrap::matches_builtin_release(request.parameters["release_id"].as_str().ok_or("Candidate release required")?,request.parameters["manifest_sha256"].as_str().ok_or("Candidate manifest required")?){return Err("Candidate probe needs an independently compiled package approval".into())}
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let base=app.path().app_local_data_dir().map_err(|_|"Native approval unavailable")?;
  let _transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
  let authorization=controller(&app,target.clone(),node_controller::Request{version:1,operation:"authorization_status".into(),parameters:serde_json::json!({})},&directory).await?;
  if authorization["ok"]!=true{return Err("Candidate probe could not authenticate current origin approval".into())}
  let scope=crate::authorization_lifecycle::runtime_probe_scope(&base,&target,&authorization["result"])?;
  let reply=controller(&app,target,request.clone(),&directory).await?;
  if !crate::gateway_admission::exact(&reply,&["version","ok","result"])||reply["version"]!=1||reply["ok"]!=true{return Err(runtime_probe_refusal(&reply))}
  return Ok(serde_json::json!({"version":1,"ok":true,"result":crate::runtime_probe::review(&request,&reply["result"],&scope)?}));
 }
 if request.operation=="boot_policy"&&request.parameters["enabled"]==true&&target.guest.is_some(){return Err("Managed guest boot enablement is unavailable; no grant or mutation was sent".into())}
 let gateway_query=|request:&node_controller::Request|node_controller::Request{version:1,operation:if request.operation=="gateway_admission_prepare"{"gateway_admission_preflight".into()}else{"gateway_admission_status".into()},parameters:if request.operation=="gateway_admission_prepare"{request.parameters.clone()}else{serde_json::json!({})}};
 let gateway_review=if matches!(request.operation.as_str(),"gateway_admission_prepare"|"gateway_admission_sign"){
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let reply=controller(&app,target.clone(),gateway_query(&request),&directory).await?;
  Some(crate::gateway_admission::reviewed_mutation(&request,&reply)?)
 }else{None};
 let gateway_target_review=if matches!(request.operation.as_str(),"gateway_install"|"gateway_target_generate"|"gateway_target_commission"){
  let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let reply=controller(&app,target.clone(),crate::gateway_target::query(&request),&directory).await?;
  Some(crate::gateway_target::reviewed_mutation(&request,&reply)?)
 }else{None};

 let mut genesis_review=None;
 if request.operation=="network_formation_sign" {
  let dir=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
  let current=controller(&app,target.clone(),node_controller::Request{version:1,operation:"network_formation_status".into(),parameters:serde_json::json!({})},&dir).await?;
  let reviewed=crate::network_formation::review(&current["result"])?;
  if current["ok"]!=true||reviewed["signed"]!=false||reviewed["review_sha256"]!=request.parameters["review_sha256"]{return Err("The exact unsigned Genesis review changed; inspect before signing".into())}
  genesis_review=Some(reviewed);
 }
 if mutation {
  let title=format!("Authorize NodeNetwork {}",request.operation);
  let parameters=if gateway_review.is_some(){serde_json::json!({"reviewed_public_scope":gateway_review})}else if gateway_target_review.is_some(){serde_json::json!({"reviewed_public_scope":gateway_target_review})}else{request.parameters.clone()};
  let message=format!("Target: {}\nRoot: /opt/synergy\nOperation: {}\nParameters: {}\nExact request approval ID: {}\n\nThis action changes the selected target. A separate matching host grant is required. In an independently approved debug formation, this confirmation can stage a short-lived exact continuation for the same target/master/network; production remains denied. Uninstall destroys the node, keys and signing-safety state. No action is retried automatically.",target.label(),request.operation,parameters,request.approval_id());
  let message=if gateway_review.is_some(){format!("{message}\n\nENGINEERING GATEWAY ADMISSION ONLY. Approve only this exact additional issuer purpose, public gateway enrollment and signed network origin. Preparation stages the fixed public purpose approval; signing is a separate action using role-bound issuer custody. This does not commission or start a gateway, expose validator RPC, migrate Wallet trust, or approve production. If the reply is lost, reconcile this exact request ID; never regrant blindly.")}else{message};
  let message=if gateway_target_review.is_some(){format!("{message}\n\nENGINEERING GATEWAY TARGET ONLY. Fresh custody is generated only on this selected target; no private material is imported or exported. Commissioning verifies the exact public admission, configuration and target custody. Services remain stopped, boot disabled and public RPC closed. This does not sign an admission, change Wallet trust or approve production. Reconcile the original request if its response is lost; never regenerate blindly.")}else{message};
  let message=if request.operation=="vpn_stop"{format!("{message}\n\nStop ONLY the attributed node VPN. The validator must already be stopped. Original enrollment attempts, custody and VPN state are preserved. This does not revoke a key, delete a peer or contact the provider. If the reply is lost, read diagnostics; do not repeat blindly.")}else{message};
  let message=if request.operation=="vpn_resume"{format!("{message}\n\nResume ONLY the already enrolled, independently server-bound node VPN using its existing private identity. The validator stays stopped. No setup key, provider API, new enrollment, or validator start is requested. Issuance approval expiry does not replace the existing peer. If the reply is lost, read Resume status; do not repeat blindly.")}else{message};
  let message=if request.operation=="boot_policy"{format!("{message}\n\nChange when the selected service starts after reboot. The node setting applies to the installed role’s runtime, including the RPC relay on a gateway. Enabling requires the commissioned role and its bound VPN. The runtime starts its VPN dependency at boot. If a reply is lost, read boot policy status before retrying.")}else{message};
  let message=if let Some(review)=genesis_review{format!("{message}\n\nVerified unsigned Genesis review: {review}\n\nThis signs a new isolated engineering network with its prepared APQE authority custody. It does not approve production or start validators.")}else{message};
  let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title(title)
   .buttons(MessageDialogButtons::OkCancelCustom("Authorize once".into(),"Cancel".into())).blocking_show())
   .await.map_err(|_|"Operator confirmation did not finish.")?;
  if !confirmed {return Err("Operator canceled; no controller mutation was sent.".into());}
 }
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let operation=request.operation.clone();
 let target_for_eligibility=target.clone();
 let target_identity=target.journal_identity();
 let resume_base=app.path().app_local_data_dir().map_err(|_|"Portal journal unavailable")?;
 let _resume_transaction=if matches!(operation.as_str(),"vpn_resume"|"vpn_resume_status"|"boot_policy"|"boot_policy_status"|"commission"|"gateway_install"|"gateway_install_status")||operation.starts_with("gateway_admission_")||operation.starts_with("gateway_target_"){Some(crate::authorization_lifecycle::continuation_lock(&resume_base,&target)?)}else{None};
 if let Some(reviewed)=&gateway_review{
  request_journal::require_resumable_scope(&resume_base,&target_identity)?;
  let reply=controller(&app,target.clone(),gateway_query(&request),&directory).await?;
  if &crate::gateway_admission::reviewed_mutation(&request,&reply)?!=reviewed{return Err("Gateway admission scope changed after review; no grant or mutation was sent".into())}
  crate::authorization_lifecycle::gateway_grant_locked(&resume_base,&target,&request,&directory,_resume_transaction.as_ref().ok_or("Gateway transaction unavailable")?).await?;
 }else if let Some(reviewed)=&gateway_target_review{
  request_journal::require_resumable_scope(&resume_base,&target_identity)?;
  let reply=controller(&app,target.clone(),crate::gateway_target::query(&request),&directory).await?;
  if &crate::gateway_target::reviewed_mutation(&request,&reply)?!=reviewed{return Err("Gateway target scope changed after review; no grant or mutation was sent".into())}
  crate::authorization_lifecycle::gateway_target_grant_locked(&resume_base,&target,&request,&directory,_resume_transaction.as_ref().ok_or("Gateway target transaction unavailable")?).await?;
 }else if matches!(operation.as_str(),"vpn_resume"|"boot_policy"|"commission"){
  request_journal::require_resumable_scope(&resume_base,&target_identity)?;
  crate::authorization_lifecycle::grant_locked(&resume_base,&target,&request,&directory,None,_resume_transaction.as_ref().ok_or("Service-policy transaction unavailable")?).await?;
 }else if mutation{exact_continuation(&app,&target,&request,&directory,None).await?;}
 let dispatch=if mutation {Some(request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?,&target_identity,&operation,&request.canonical())?)} else {None};
 let dispatched_request=request.clone();
 let result=controller(&app,target,request,&directory).await.and_then(|reply|node_controller::mutation_acknowledgement(&dispatched_request,reply)).and_then(|reply|if operation=="uninstall"{crate::authorization_lifecycle::verify_removal(&target_for_eligibility,reply)}else{Ok(reply)});
 if let Some(dispatch)=dispatch {dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;}
 let mut result=result?;
 if operation.starts_with("gateway_target_")&&result["ok"]==true{
  result["result"]=match operation.as_str(){
   "gateway_target_commission_preflight"=>crate::gateway_target::commission_preflight(&dispatched_request,&result["result"])?,
   "gateway_target_configuration"=>crate::gateway_target::profile_configuration(&result["result"])?,
   _=>crate::gateway_target::review(&result["result"],operation=="gateway_target_export")?,
  };
  if operation=="gateway_target_reconcile"{
   let original_operation=crate::gateway_target::reconciliation(&dispatched_request,&result["result"])?;
   request_journal::reconcile_verified(&resume_base,&target_identity,original_operation,dispatched_request.parameters["request_sha256"].as_str().ok_or("Exact gateway target request required")?)?;
  }
 }
 if operation=="gateway_install_preflight"{return node_controller::install_preflight_reply(&dispatched_request,&result).map_err(String::from)}
 if operation=="gateway_install_status"&&result["ok"]==true{
  result["result"]=crate::gateway_target::installation_status(&dispatched_request,&result["result"])?;
  request_journal::reconcile_verified(&resume_base,&target_identity,"gateway_install",dispatched_request.parameters["request_sha256"].as_str().ok_or("Exact original gateway installation request required")?)?;
 }
 if operation.starts_with("gateway_admission_")&&result["ok"]==true{
  result["result"]=if operation=="gateway_admission_preflight"{crate::gateway_admission::preflight(&dispatched_request,&result["result"])?}else{crate::gateway_admission::review(&result["result"],operation=="gateway_admission_export")?};
  if operation=="gateway_admission_reconcile"{if let Some(original_operation)=crate::gateway_admission::reconciliation(&dispatched_request,&result["result"])?{
   request_journal::reconcile_verified(&resume_base,&target_identity,original_operation,dispatched_request.parameters["request_sha256"].as_str().ok_or("Exact gateway request required")?)?;
  }}
 }
 if result["ok"]==true {
  if operation=="target"&&crate::authorization_lifecycle::eligible(&app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?,&target_for_eligibility,&directory).await?{
   result["result"]["engineeringContinuation"]=serde_json::json!(true);
   if let Some(operations)=result["result"]["operations"].as_array_mut(){for row in operations{if row["kind"]=="mutation"&&row["blocker"]=="Operation has not passed host qualification"{row["engineeringContinuation"]=serde_json::json!(true);}}}
  }
  if operation=="boot_policy_status" {
   if let Some(digest)=node_controller::boot_policy_reconciliation(&result)?{
    request_journal::reconcile_verified(&resume_base,&target_identity,"boot_policy",&digest)?;
   }
  }
  if operation=="vpn_resume_status" {
   if let Some(digest)=node_controller::vpn_resume_reconciliation(&result)?{
    request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal journal unavailable")?,&target_identity,"vpn_resume",&digest)?;
   }
  }
  if operation=="vpn_stop_status" {
   if let Some(digest)=node_controller::vpn_stop_reconciliation(&result)?{
    request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal journal unavailable")?,&target_identity,"vpn_stop",&digest)?;
   }
  }
  if operation=="authorization_status" {
   let update=&result["result"]["update"];
   if !update.is_null(){
    let request=serde_json::json!({"version":1,"operation":"update_stage","parameters":{"release_id":update["selection"]["release_id"],"manifest_sha256":update["selection"]["manifest_sha256"]}});
    let digest=format!("{:x}",Sha256::digest(request.to_string().as_bytes()));
    if update["request_sha256"]!=digest{return Err("Update adoption receipt has no exact dispatch identity".into())}
    request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal journal unavailable")?,&target_identity,"update_stage",&digest)?;
   }
   let record=&result["result"]["authorization"];
   if result["result"]["schema"]!="nodenetwork-engineering-authorization-status-v1"{return Err("Unsupported authorization status".into())}
   if !record.is_null(){
    let pin=record["sha256"].as_str().filter(|s|s.len()==64&&s.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))).ok_or("Invalid target authorization receipt")?;
 let request=serde_json::json!({"version":1,"operation":"authorization_stage","parameters":{"authorization_sha256":pin}});
    let digest=format!("{:x}",Sha256::digest(request.to_string().as_bytes()));
    request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal journal unavailable")?,&target_identity,"authorization_stage",&digest)?;
   }
  }
  if let Some((mutation,request_digest))=formation::reconcile_evidence(&operation,&result["result"])?{
   request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?,&target_identity,mutation,request_digest)?;
  }
  if matches!(operation.as_str(),"genesis_binding_preflight"|"identity_preflight") {
   if let Some(request_digest)=formation::stage_recovery(&result["result"])?{
    request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?,&target_identity,"genesis_stage",request_digest)?;
   }
  }
 }
 if (operation=="network_formation_status"||operation=="network_formation_sign")&&result["ok"]==true{
   result["result"]=crate::network_formation::review(&result["result"])?;
   if operation=="network_formation_status"&&result["result"]["pending"]==true{
    let base=app.path().app_local_data_dir().map_err(|_|"Local journal unavailable")?;
    for (op,field)in[("network_formation_prepare","request_sha256"),("network_formation_sign","sign_request_sha256")]{if let Some(pin)=result["result"][field].as_str(){request_journal::reconcile_verified(&base,&target_identity,op,pin)?;}}
   }
 }
 if let Some(public)=result["result"].as_object_mut(){
  // Exact artifacts are saved only after a native export review.
  public.remove("registration_json");
  public.remove("enrollment_json");
 }
 Ok(result)
}

#[cfg(test)]
async fn dispatch_reviewed_software<Fut>(target:&node_controller::Target,request:&node_controller::Request,
 journal:&Path,mut execute:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let read=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let fresh_target=execute(read("target")).await
  .map_err(|_|"The controller could not recheck the selected target.")?;
 match request.operation.as_str() {
  "commission"=>{
   node_controller::require_commission_target(&fresh_target,false)?;
   let formation_reply=execute(read("formation_status")).await
    .map_err(|_|"The controller could not recheck pending formation custody. Review custody before commissioning.")?;
   let pending=node_controller::commission_pending_formation(&formation_reply)?;
   if let Some(formation)=pending {
    // Testnet v3 613fa6ab controller.py rechecks these conditions before
    // authorizing its formation branch. The owner still checks public pins.
    node_controller::require_commission_target(&fresh_target,true)?;
    let vpn=execute(read("vpn_status")).await
     .map_err(|_|"The controller could not recheck bound VPN connectivity for formation commissioning.")?;
    node_controller::require_formation_commission_vpn(&vpn)?;
    let binding=execute(read("genesis_binding_preflight")).await
     .map_err(|_|"The controller could not recheck Genesis custody. Review custody before commissioning.")?;
    node_controller::require_formation_commission_binding(formation,&binding)?;
   }
   let current_target=execute(read("target")).await
    .map_err(|_|"The controller could not recheck commissioning qualification after reviewing custody.")?;
   node_controller::require_commission_target(&current_target,pending.is_some())?;
  },
  "register"=>node_controller::require_service_registration_target(&fresh_target)?,
  // Testnet v3 613fa6ab authorizes Stop without VPN or startup checks.
  "stop"=>node_controller::require_service_stop_target(&fresh_target)?,
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
  "start"|"restart"|"stop"=>node_controller::NODE_SERVICE_UNCERTAIN.into(),
  "vpn_enroll"=>node_controller::VPN_ENROLLMENT_UNCERTAIN.into(),
  _=>error,
 }).and_then(|reply|match request.operation.as_str() {
  "commission"=>node_controller::commissioning_reply(&reply).map_err(String::from),
  "start"|"restart"|"stop"=>node_controller::node_service_reply(&request.operation,&reply).map_err(String::from),
  "vpn_enroll"=>node_controller::vpn_enrollment_reply(&reply).map_err(String::from),
  _=>Ok(reply),
 });
 dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes.")?;
 result
}

#[cfg(test)]
async fn dispatch_reviewed_genesis_binding<Fut>(target:&node_controller::Target,request:&node_controller::Request,
 review:&node_controller::GenesisBindingReview,journal:&Path,mut execute:impl FnMut(node_controller::Request)->Fut)->Result<Value,String>
where Fut:Future<Output=Result<Value,String>> {
 let read=|operation:&str|node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})};
 let current_target=execute(read("target")).await.map_err(|_|"The controller could not recheck the selected target before Genesis binding.")?;
 node_controller::require_genesis_target(&current_target,"genesis_bind")?;
 let fresh=execute(read("genesis_binding_preflight")).await
  .map_err(|_|"The controller could not recheck the reviewed unbound Genesis scope. Review it again before binding.")?;
 review.require_unbound(request,&fresh)?;
 let current_target=execute(read("target")).await.map_err(|_|"The controller could not recheck Genesis binding qualification after reviewing custody.")?;
 node_controller::require_genesis_target(&current_target,"genesis_bind")?;
 let dispatch=request_journal::Dispatch::begin(journal,&target.journal_identity(),&request.operation,&request.canonical())?;
 let result=execute(request.clone()).await.map_err(|_|node_controller::GENESIS_BIND_UNCERTAIN.to_owned())
  .and_then(|reply|review.verify_acknowledgement(request,reply));
 dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;
 result
}

#[cfg(test)]
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
pub async fn portal_nodenetwork_bootstrap(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,operator:String,parameters:Value,network_profile:Option<Value>)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;node_bootstrap::validate_operator(&operator)?;
 if target.kind=="local"&&!cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local bootstrap requires Linux x86_64; select a remote headless target.".into());}
 node_controller::Request{version:1,operation:"install_preflight".into(),parameters:parameters.clone()}.validate()?;
 if let Some(profile)=&network_profile {
  if !cfg!(debug_assertions)||target.kind!="remote"||target.guest.is_some()
   ||profile["schema"]!="synergy-network-provisioning-v1"||profile["role"]!="rpc_gateway"
   ||!profile["profile_id"].as_str().is_some_and(node_controller::validator_network_id)
   ||!["network_id","chain_id","node_name"].iter().all(|key|profile[*key]==parameters[*key]){
   return Err("Choose an exact gateway profile for the physical target".into());
  }
 }
 let view=window.clone();let fields=parameters.clone();
 let profile_bound=network_profile.is_some();
 let reviewed_target=target.clone();
 let prepared=tauri::async_runtime::spawn_blocking(move ||{
  let Some(folder)=view.dialog().file().set_parent(&view).set_title("Select the approved Synergy master to stage").blocking_pick_folder() else{return Ok(None)};
  let root=folder.into_path().map_err(|_|"Select a local Synergy master directory.")?;
  let Some(key)=pick_operator_public_key(&view)? else{return Ok(None)};
  let host=if profile_bound {
   let Some(path)=view.dialog().file().set_parent(&view).set_title("Select the independently verified SSH host pin")
    .add_filter("SSH host pin",&["known-hosts","txt"]).blocking_pick_file() else{return Ok(None)};
   let path=path.into_path().map_err(|_|"Select the existing verified SSH host pin file")?;
   Some(node_controller::profile_host_identity(&reviewed_target,&path)?)
  }else{None};
  node_bootstrap::prepare(&root,&key,&fields).map(|prepared|Some((prepared,host)))
 }).await.map_err(|_|"Master bootstrap inspection did not finish.")??;
 let Some((prepared,reviewed_host))=prepared else{return Ok(None)};
 let base=app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no bootstrap was sent.")?;
 let bootstrap_request=serde_json::json!({"version":1,"operation":"bootstrap","operator":operator,"parameters":parameters,"bootstrapPin":node_bootstrap::script_pin()});
 // Bind this read-only review to the current selected key without rewriting the legacy dispatch request.
 let absence_review=serde_json::json!({"request":bootstrap_request,"operator_public_key_sha256":prepared.operator_public_key_sha256()});
 let reconciliation=request_journal::bootstrap_absence_candidate(&base,&target.journal_identity(),&absence_review)?;
 let reconciliation_notice=if let Some(ticket)=&reconciliation{format!("\n\nOriginal uncertain bootstrap request SHA-256: {}\nThis confirmation authorizes ONLY a pinned, read-only absence check of both Synergy roots, registrations, accounts, mounts and application/bootstrap processes. The original record remains bound to its original request even if the selected release or embedded script has changed. The administrative account and public key shown above are current selections; the legacy journal does not prove their historical equivalence. Only a fully clean proof resolves the original entry as verified absence, never success. No bootstrap is retried in this action; confirm a fresh Bootstrap action separately.",ticket.original_request_sha256())}else{String::new()};
 let message=format!("Target: {}\nAdministrative account: {}\nRoot: /opt/synergy\nRelease: {}\nManifest SHA-256: {}\nEmbedded bootstrap SHA-256: {}\nNetwork incarnation: {}\nChain: {}\nNode name: {}\nOperator public-key SHA-256: {}\n\nThis stages the verified software and installs a restricted host controller account, rooted SSH/sudo definitions and the automatic removal guard. The target must be clean. No community enrollment, custody creation, consensus membership or activation is authorized. No passwords are requested or stored by Portal.",target.label(),operator,prepared.release,prepared.manifest_sha256,node_bootstrap::script_pin(),parameters["network_id"],parameters["chain_id"],parameters["node_name"],prepared.operator_public_key_sha256());
 let host_notice=reviewed_host.as_ref().map_or_else(String::new,|(_,fingerprint)|
  format!("\n\nVerified SSH host fingerprint: {fingerprint}\nCompare it with the host identity in your approved infrastructure record."));
 let message=format!("{message}{host_notice}{reconciliation_notice}");
 let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title("Authorize NodeNetwork target bootstrap")
  .buttons(MessageDialogButtons::OkCancelCustom("Bootstrap selected target once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Bootstrap confirmation did not finish.")?;
 if !confirmed{return Err("Operator canceled; no bootstrap was sent.".into());}
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let prior_pin=crate::authorization_lifecycle::reinstallation_host_pin(&base,&target,&directory)?;
 let profile_pin=if let Some((line,_))=reviewed_host {
  if let Some(prior)=&prior_pin {
   if node_controller::profile_host_identity(&target,prior)?.0!=line {
    return Err("Selected SSH host identity differs from the authorized installation record".into());
   }
  }
  Some(node_controller::retain_profile_host_pin(&target,&directory,&line)?)
 }else{None};
 let pin=prior_pin.as_deref().or(profile_pin.as_deref());
 if let Some(ticket)=reconciliation{
  node_bootstrap::prove_clean_bootstrap(&target,&operator,&prepared,&directory,pin,&ticket.challenge()).await?;
  request_journal::verify_bootstrap_absence(&base,&target.journal_identity(),&absence_review,ticket)?;
  return Err("The exact prior uncertain bootstrap was reconciled as verified clean absence, not success. No bootstrap was retried. Select Bootstrap and confirm again to authorize one fresh attempt.".into())
 }
 if target.kind=="remote"&&target.guest.is_none(){node_bootstrap::require_selected_operator_identity(&target,&directory,&prepared.public_key)?;}
 let retry=crate::authorization_lifecycle::prepare_reinstallation(&base,&target,&operator,&parameters,&bootstrap_request)?;
 let dispatch=request_journal::Dispatch::begin_bootstrap(&base,&target.journal_identity(),&bootstrap_request,retry)?;
 let expected=parameters.clone();
 let identity_target=target.clone();let identity_key=prepared.public_key.clone();
 let result=node_bootstrap::execute_pinned(target,operator,parameters,prepared,&directory,pin).await.and_then(|reply|{
  if reply["ok"]==true&&(reply["result"]["root"]!="/opt/synergy"||reply["result"]["stagedRelease"]!=expected["release_id"]||reply["result"]["manifestSha256"]!=expected["manifest_sha256"]||reply["result"]["controllerEnrolled"]!=true||reply["result"]["softwareInstalled"]!=false||reply["result"]["rootDeletionGuardActive"]!=true){return Err("Fresh bootstrap receipt differs; preserve the native journal for reconciliation".into())}Ok(reply)
 });
 if result.as_ref().is_ok_and(|reply|reply["ok"]==true)&&identity_target.kind=="remote"&&identity_target.guest.is_none(){node_bootstrap::retain_operator_identity(&identity_target,&directory,&identity_key)?;}
 dispatch.finish(&result).map_err(|_|"Bootstrap outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;
 result.map(Some)
}
#[tauri::command]
pub async fn portal_nodenetwork_export_registration(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,expected_address:String,expected_scope_sha256:String)->Result<Option<Value>,String>{
 export_public(window,app,target,expected_address,expected_scope_sha256,formation::Export::Formation).await
}
#[tauri::command]
pub async fn portal_nodenetwork_export_bound_enrollment(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,expected_address:String,expected_scope_sha256:String)->Result<Option<Value>,String>{
 export_public(window,app,target,expected_address,expected_scope_sha256,formation::Export::BoundEnrollment).await
}
async fn export_public(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,expected_address:String,expected_scope_sha256:String,export:formation::Export)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::DialogExt;
 use std::io::Write;
 main_only(&window)?;
 target.validate()?;
 let (operation,name,scope)=match export{
  formation::Export::Formation=>("formation_export","validator-formation-registration.json","formation_sha256"),
  formation::Export::BoundEnrollment=>("genesis_binding_preflight","validator-bound-enrollment.json","genesis_sha256"),
 };
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let reply=controller(&app,target,node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})},&directory).await?;
 if reply["ok"]!=true{return Err("Target refused the verified public artifact; inspect its formation or binding status first.".into());}
 let (bytes,summary)=formation::export_bytes(&reply["result"],export)?;
 if summary["address"].as_str()!=Some(expected_address.as_str())||reply["result"][scope].as_str()!=Some(expected_scope_sha256.as_str()){return Err("The public artifact differs from the previously reviewed validator identity or network scope.".into());}
 let bytes=bytes.to_vec();
 tauri::async_runtime::spawn_blocking(move||{
  let title=format!("Save verified public validator artifact · SHA-256 {}",summary["sha256"].as_str().unwrap_or(""));
  let Some(file)=window.dialog().file().set_parent(&window).set_title(title).set_file_name(name).add_filter("Public validator JSON",&["json"]).blocking_save_file() else{return Ok(None);};
  let path=file.into_path().map_err(|_|"Select a local destination for this public artifact.")?;
  let mut options=std::fs::OpenOptions::new();
  options.write(true).create_new(true);
  #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
  let mut file=options.open(path).map_err(|_|"Public export destination already exists or is unavailable; choose a new file.")?;
  file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"Public export could not be saved completely; check the destination before using it.")?;
  Ok(Some(summary))
 }).await.map_err(|_|"Public export did not finish.")?
}
pub(crate) fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("Use the main Portal window for native services.".into()) } }

#[tauri::command]
pub async fn portal_nodenetwork_stage_signed_genesis(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,expected_address:String)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 target.validate()?;
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?;
 let derived=if expected_address.starts_with("network:"){None}else{crate::authorization_lifecycle::engineering_stage(&base,&target,&expected_address,&directory).await?};
 let (policy,artifacts)=if let Some((policy,artifacts))=derived{formation::stage_policy(&policy,&expected_address)?;(policy,artifacts)}else{
 let policy_reply=controller(&app,target.clone(),node_controller::Request{version:1,operation:"genesis_stage_preflight".into(),parameters:serde_json::json!({})},&directory).await?;
 if policy_reply["ok"]!=true {return Err("The target did not authorize signed Genesis staging. Check its independent authority policy and prepared custody.".into());}
 let policy=policy_reply["result"].clone();
 formation::stage_policy(&policy,&expected_address)?;
 let view=window.clone();
 let pins=policy.clone();
 let selected=tauri::async_runtime::spawn_blocking(move ||{
  let Some(folder)=view.dialog().file().set_parent(&view).set_title("Select the independently signed Genesis authority folder").blocking_pick_folder() else{return Ok(None);};
  let path=folder.into_path().map_err(|_|"Select a local signed Genesis authority folder.")?;
  formation::select_stage_artifacts(&path,&pins).map(Some)
 }).await.map_err(|_|"Signed Genesis folder review did not finish.")??;
 let Some(artifacts)=selected else{return Ok(None);};
 (policy,artifacts)
 };
 let request=node_controller::Request{version:1,operation:"genesis_stage".into(),parameters:serde_json::json!({"artifacts":artifacts})};
 request.validate()?;
 let approval=request.approval_id();
 let subject=if policy["schema"]=="nodenetwork-existing-genesis-stage-policy-v1"{format!("Existing network: {} (chain {})",policy["network_id"],policy["chain_id"])}else{format!("Prepared validator: {expected_address}")};
 let message=format!("Target: {}\n{}\n\nGenesis SHA-256: {}\nAuthority SHA-256: {}\nAuthority root SHA-256: {}\n\nExact request approval ID: {}\n\nOnly these three public files will be sent. The controller requires its own matching authorization and will verify the signed network before publishing them. This does not bind custody, prove stake, or start the validator.",target.label(),subject,policy["genesis_sha256"],policy["authority_sha256"],policy["authority_root_sha256"],approval);
 let confirmed=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Authorize exact signed Genesis staging").buttons(MessageDialogButtons::OkCancelCustom("Stage these public files once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Signed Genesis staging confirmation did not finish.")?;
 if !confirmed{return Ok(None);}
 let pins=serde_json::json!({"genesis.json":policy["genesis_sha256"],"authority.json":policy["authority_sha256"],"authority-root.pub":policy["authority_root_sha256"]});
 exact_continuation(&app,&target,&request,&directory,Some(&pins)).await?;
 let dispatch=request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; nothing was staged.")?,&target.journal_identity(),"genesis_stage",&request.canonical())?;
 let result=controller(&app,target,request,&directory).await.and_then(|reply|{
  if reply["ok"]==true{formation::stage_receipt(&reply["result"],&policy,&approval)?;}
  Ok(reply)
 });
 dispatch.finish(&result).map_err(|_|"Genesis staging outcome could not be saved to the local journal. Verify signed Genesis on the target before any further mutation.")?;
 result.map(Some)
}

/// File selection and exact independent native pin precede any privileged action.
#[tauri::command]
pub async fn portal_nodenetwork_stage_authorization(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,operator:String,network_profile:Option<Value>)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;node_bootstrap::validate_operator(&operator)?;
 let view=window.clone();let selected_target=target.clone();
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let review_directory=directory.clone();
 let selected=tauri::async_runtime::spawn_blocking(move||{
  let Some(file)=view.dialog().file().set_parent(&view).set_title("Select the independently approved engineering authorization.json").add_filter("Engineering authorization",&["json"]).blocking_pick_file() else{return Ok(None)};
  let path=file.into_path().map_err(|_|"Select a local authorization document")?;
  crate::operator_authorization::prepare(&path,&selected_target,network_profile.as_ref(),&review_directory).map(Some)
 }).await.map_err(|_|"Authorization inspection did not finish")??;
 let Some(prepared)=selected else{return Ok(None)};
 let summary=prepared.summary.clone();
 let message=format!("Target: {}\nAdministrative account: {}\nExact authorization SHA-256: {}\n\nReviewed public scope: {}\n\nThis isolated engineering approval stages only exact fixed-name inputs and expiring one-use requests inside /opt/synergy. It does not grant Genesis membership, stake or consensus authority. Private VPN input, if approved, is not returned to the renderer. Nothing is automatically retried.",target.label(),operator,prepared.sha256,summary);
 let confirmed=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Authorize exact engineering formation inputs").buttons(MessageDialogButtons::OkCancelCustom("Stage approved scope once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Authorization confirmation did not finish")?;
 if !confirmed{return Ok(None)};
 let base=app.path().app_local_data_dir().map_err(|_|"Portal journal unavailable")?;
 crate::authorization_lifecycle::remember(&base,&target,&operator,&prepared)?;
 let request=serde_json::json!({"version":1,"operation":"authorization_stage","parameters":{"authorization_sha256":prepared.sha256}});
 let dispatch=request_journal::Dispatch::begin(&base,&target.journal_identity(),"authorization_stage",&request)?;
 let result=crate::operator_authorization::execute(target,operator,prepared,&directory).await.and_then(|reply|{
  if reply["ok"]==true&&(reply["result"]["schema"]!="nodenetwork-engineering-authorization-v1"||reply["result"]["sha256"]!=summary["sha256"]||reply["result"]["sequence"]!=summary["sequence"]||reply["result"]["applied"]!=true||reply["result"]["grants_recreated"]!=false){return Err("Target authorization receipt differs; inspect before further operations".into())}
  Ok(reply)
 });
 dispatch.finish(&result).map_err(|_|"Authorization outcome could not be journaled; inspect the target and do not resend")?;
 result.map(Some)
}

#[tauri::command]
pub async fn portal_nodenetwork_prepare_network_genesis(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,formation_sha256:String)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;
 let view=window.clone();let pin=formation_sha256.clone();
 let selected=tauri::async_runtime::spawn_blocking(move||{
  let Some(folder)=view.dialog().file().set_parent(&view).set_title("Select public formation recipe and five registrations").blocking_pick_folder() else{return Ok(None)};
  crate::network_formation::prepare_inputs(&folder.into_path().map_err(|_|"Select a local public input folder")?,&pin).map(Some)
 }).await.map_err(|_|"Public formation input review interrupted")??;
 let Some(parameters)=selected else{return Ok(None)};
 let request=node_controller::Request{version:1,operation:"network_formation_prepare".into(),parameters};request.validate()?;
 let message=format!("Target: {}\nFormation SHA-256: {}\nExact public-input request: {}\n\nPrepare one fresh isolated engineering network from five public registrations. New encrypted authority custody stays on this managed target. Preparation does not sign Genesis, grant membership, start validators, or approve production. An independent exact host grant is required. Never repeat an uncertain operation; read status.",target.label(),formation_sha256,request.approval_id());
 let confirmed=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Prepare fresh engineering Genesis").buttons(MessageDialogButtons::OkCancelCustom("Prepare once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Native review interrupted")?;
 if !confirmed{return Ok(None)};
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 exact_continuation(&app,&target,&request,&directory,None).await?;
 let dispatch=request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Local journal unavailable")?,&target.journal_identity(),"network_formation_prepare",&request.canonical())?;
 let result=controller(&app,target,request,&directory).await;dispatch.finish(&result)?;
 let mut reply=result?;if reply["ok"]==true{reply["result"]=crate::network_formation::review(&reply["result"])?;}Ok(Some(reply))
}
#[tauri::command]
pub async fn portal_nodenetwork_export_network_genesis(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,review_sha256:String)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::DialogExt;use std::io::Write;
 main_only(&window)?;target.validate()?;
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let reply=controller(&app,target.clone(),node_controller::Request{version:1,operation:"network_formation_export".into(),parameters:serde_json::json!({})},&directory).await?;
 if reply["ok"]!=true{return Err("Native target refused signed Genesis export".into())}
 let files=crate::network_formation::export(&reply["result"],&review_sha256)?;
 crate::authorization_lifecycle::remember_export(&app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?,&target,&reply["result"],&directory).await?;
 let summary=serde_json::json!({"review_sha256":review_sha256,"genesis_sha256":reply["result"]["genesis_sha256"],"authority_sha256":reply["result"]["authority_sha256"],"authority_root_sha256":reply["result"]["authority_root_sha256"]});
 tauri::async_runtime::spawn_blocking(move||{
  let Some(folder)=window.dialog().file().set_parent(&window).set_title("Select parent for new signed public Genesis export").blocking_pick_folder() else{return Ok(None)};
  let path=folder.into_path().map_err(|_|"Choose a local public export folder")?.join(format!("signed-genesis-{}",&review_sha256[..16]));
  std::fs::create_dir(&path).map_err(|_|"Export directory exists or cannot be created; no overwrite is allowed")?;
  for(name,bytes)in files{let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}let mut file=options.open(path.join(name)).map_err(|_|"Public export interrupted; inspect destination")?;file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"Public export interrupted; inspect destination")?;}
  Ok(Some(summary))
 }).await.map_err(|_|"Public export interrupted")?
}

#[tauri::command]
pub async fn portal_nodenetwork_stage_update(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;target.validate()?;
 if !cfg!(debug_assertions){return Err("Engineering release adoption is disabled in production".into())}
 let base=app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?;
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let(operator,mut context,pin,pending_update)=crate::authorization_lifecycle::update_context(&base,&target,&control).await?;
 let view=window.clone();let selection=context["selection"].clone();
 let prepared=tauri::async_runtime::spawn_blocking(move||{
  let Some(folder)=view.dialog().file().set_parent(&view).set_title("Select the exact NEW engineering synergy master").blocking_pick_folder() else{return Ok(None)};
  let folder=folder.into_path().map_err(|_|"Choose a local master folder")?;
  node_bootstrap::prepare_update(&folder,&selection).map(|prepared|(prepared,folder)).map(Some)
 }).await.map_err(|_|"Update inventory review interrupted")??;
 let Some((prepared,folder))=prepared else{return Ok(None)};
 if context["selection"]["release_id"]==prepared.release||context["selection"]["manifest_sha256"]==prepared.manifest_sha256{return Err("Choose a distinct new release; reconcile an already staged update instead of replaying".into())}
 let pending=crate::authorization_lifecycle::pending_update(&pending_update,&context["selection"]);
 let replacement=pending&&(pending_update["selection"]["release_id"]!=prepared.release||pending_update["selection"]["manifest_sha256"]!=prepared.manifest_sha256);
 let reconcile=pending&&!replacement;
 let old_upgrade=serde_json::json!({"version":1,"operation":"upgrade","parameters":{"release_id":pending_update["selection"]["release_id"],"manifest_sha256":pending_update["selection"]["manifest_sha256"]}});
 let stage_request=serde_json::json!({"version":1,"operation":"update_stage","parameters":{"release_id":prepared.release,"manifest_sha256":prepared.manifest_sha256}});
 let mut replacement_unused=false;
 let verifier=if replacement{
  // The local terminal record permits review only. The remote re-runs the full
  // authenticated non-application proof under its lock before replacing bytes.
  replacement_unused=request_journal::update_replacement_ticket(&base,&target.journal_identity(),&old_upgrade,&stage_request)?.unused();
  Some(node_bootstrap::upgrade_verifier(&folder)?)
 }else{None};
 let commission_review=node_bootstrap::inspect_update_commission_grant(&target,&operator,&control,pin.as_deref(),&context).await?;
 context["release_id"]=serde_json::json!(prepared.release);context["manifest_sha256"]=serde_json::json!(prepared.manifest_sha256);
 let preservation_notice=if commission_review["preservation"].is_null(){String::new()}else{format!("PRESERVE EXACT EXPIRED UNUSED COMMISSION GRANT\nRequest: {}\nGrant SHA-256: {}\nExpired at: {}\nStaged commissioning commitment: {}\nThe exact expired grant is preserved byte-for-byte, not consumed, renewed or replayed. No commissioning or validator activation is authorized.\n",commission_review["preservation"]["request_sha256"],commission_review["preservation"]["grant_sha256"],commission_review["preservation"]["expires_at"],commission_review["preservation"]["commissioning_sha256"])};
 let action=if replacement&&replacement_unused{"VERIFY EXACT UNUSED STAGED UPGRADE THEN STAGE NEW RELEASE ONCE — no old upgrade dispatch, grant, consumed audit, intent or partial is permitted; preserve a NOT-APPLIED receipt, never upgrade success"}else if replacement{"REPLACE EXACT VERIFIED-NOT-APPLIED STAGE — full unchanged-installation proof runs again; old upgrade is never retried"}else if reconcile{"RECONCILE ALREADY ADOPTED CONTROLLER ONLY — no archive upload or repeated adoption"}else{"STAGE EXACT NEW RELEASE ONCE"};
 let superseded_notice=if replacement{format!("Original staged selection: {}\nOriginal verified-not-applied upgrade request: {:x}\nOnly authenticated staged public software is replaced; original audit and false outcome remain.\n",pending_update["selection"],Sha256::digest(old_upgrade.to_string().as_bytes()))}else{String::new()};
 let message=format!("{action}\n{superseded_notice}{preservation_notice}ISOLATED DEBUG ENGINEERING RELEASE ADOPTION ONLY\nTarget: {}\nRoot: /opt/synergy\nCurrent exact release: {}\nNEW release: {}\nNEW manifest SHA-256: {}\nInitial native approval: {}\nCurrent authorization: {}\nFormation: {}\n\nThe complete local package inventory was hashed by native code. This confirmation approves these exact new software bytes for this existing authenticated engineering target/network. It is not production publisher approval. Stop the validator first. This stages software and the matching controller, or reconciles ONLY the exact already-adopted controller backup without retransmitting the archive. It does not upgrade, restart, change custody or grant membership. A separate reviewed upgrade and one-use host grant remain mandatory. Never replay an uncertain result.",target.label(),context["selection"],prepared.release,prepared.manifest_sha256,context["initial_sha256"],context["parent_sha256"],context["formation_sha256"]);
 let confirmed=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review exact engineering update").buttons(MessageDialogButtons::OkCancelCustom(if reconcile{"Reconcile exact staged controller".into()}else{"Approve and stage exact release once".into()},"Cancel".into())).blocking_show()).await.map_err(|_|"Update confirmation interrupted")?;
 if !confirmed{return Ok(None)}
 // Human review and local hashing must not consume the remote 300-second lease.
 // Re-observe the authenticated scope after confirmation; changes require review again.
 let(fresh_operator,mut fresh,fresh_pin,fresh_pending)=crate::authorization_lifecycle::update_context(&base,&target,&control).await?;
 if operator!=fresh_operator||pin!=fresh_pin||pending_update!=fresh_pending||!crate::authorization_lifecycle::same_update_review(&context,&fresh){return Err("Update scope changed during native review; inspect and review again without dispatch".into())}
 let commission_now=node_bootstrap::inspect_update_commission_grant(&target,&operator,&control,pin.as_deref(),&fresh).await?;
 if !node_bootstrap::same_update_commission_review(&commission_review,&commission_now){return Err("Expired commissioning grant changed during review; no update dispatched".into())}
 if !commission_now["preservation"].is_null(){fresh["commission_grant_preservation"]=commission_now["preservation"].clone();}
 fresh["release_id"]=context["release_id"].clone();fresh["manifest_sha256"]=context["manifest_sha256"].clone();fresh["reconcile_only"]=serde_json::json!(reconcile);context=fresh;
 let request=stage_request;
 let dispatch=if let Some(verifier)=verifier{
  let ticket=request_journal::update_replacement_ticket(&base,&target.journal_identity(),&old_upgrade,&request)?;
  if ticket.unused()!=replacement_unused{return Err("Original upgrade evidence changed during review; no stage sent".into())}
  let mut proof_context=context.clone();let fields=proof_context.as_object_mut().ok_or("Invalid native replacement context")?;
  for name in ["release_id","manifest_sha256","reconcile_only","commission_grant_preservation"]{fields.remove(name);}
  let mut wire=serde_json::json!({"context":proof_context,"adoption":pending_update,"request":old_upgrade,"challenge":ticket.challenge(),"verifier_manifest_json":verifier["verifier_manifest_json"],"verifier_conformance":verifier["verifier_conformance"]});
  if replacement_unused{
   wire["unused"]=serde_json::json!(true);
   let proof=node_bootstrap::prove_upgrade_not_applied(&target,&operator,&control,pin.as_deref(),wire.clone(),verifier["verifier_sha256"].as_str().ok_or("Verifier pin unavailable")?).await?;
   crate::authorization_lifecycle::remember_unused_upgrade(&base,&target,&wire,&proof)?;
  }
  context["superseded_upgrade"]=wire;
  request_journal::Dispatch::begin_update_replacement(&base,&target.journal_identity(),&request,ticket)?
 }else{request_journal::Dispatch::begin(&base,&target.journal_identity(),"update_stage",&request)?};
 let result=node_bootstrap::execute_update(target,operator,context.clone(),prepared,&control,pin.as_deref()).await;
 dispatch.finish(&result).map_err(|_|"Update outcome uncertain; read authorization status before any further operation")?;
 let result=result?;
 if result["ok"]==true&&(result["result"]["schema"]!="nodenetwork-update-stage-v1"||result["result"]["stagedRelease"]!=context["release_id"]||result["result"]["manifestSha256"]!=context["manifest_sha256"]||result["result"]["initial_sha256"]!=context["initial_sha256"]||result["result"]["parent_sha256"]!=context["parent_sha256"]||result["result"]["controllerAdopted"]!=true||result["result"]["validatorUpgraded"]!=false){return Err("Update response does not confirm the exact reviewed release; reconcile without replay".into())}
 Ok(Some(result))
}

#[tauri::command]
pub async fn portal_nodenetwork_vpn(window:tauri::WebviewWindow,app:tauri::AppHandle,target:crate::node_controller::Target,operation:String)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};main_only(&window)?;target.validate()?;
 if !cfg!(debug_assertions)||!matches!(operation.as_str(),"enroll"|"reconcile"|"revoke"|"retire"|"cancel_unused"){return Err("This native build has no approved VPN workflow".into())}
 let select=window.clone();
 let picked=tauri::async_runtime::spawn_blocking(move||{
  let Some(folder)=select.dialog().file().set_parent(&select).set_title("Choose independently approved VPN provider folder").blocking_pick_folder()else{return Ok(None)};
  let folder=folder.into_path().map_err(|_|"Select a local provider folder")?;
  let Some(credential)=select.dialog().file().set_parent(&select).set_title("Choose the approved VPN credential locator or isolated test credential").blocking_pick_file()else{return Ok(None)};
  let credential=credential.into_path().map_err(|_|"Select a private credential file")?;
  Ok::<_,String>(Some((folder,credential)))
 }).await.map_err(|_|"Native VPN selection did not finish")??;
 let Some((folder,credential))=picked else{return Ok(None)};
 let base=app.path().app_local_data_dir().map_err(|_|"Native app state unavailable")?;
 let control=crate::node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let prepared=crate::vpn_enrollment::prepare(&base,&target,&control,&folder,&credential).await?;
 let scope=format!("VPN operation {}\nTarget {}\n{}\n\nThe coordinator credential stays in native memory. Enrollment issues one setup key. Reconcile an uncertain outcome before retrying. Revocation and retirement apply only to the attributed key or peer.",operation,target.label(),prepared.review);
 let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(scope).parent(&window).title("Authorize native VPN workflow once")
  .buttons(MessageDialogButtons::OkCancelCustom("Authorize once".into(),"Cancel".into())).blocking_show())
  .await.map_err(|_|"Native VPN confirmation did not finish")?;
 if !confirmed { return Ok(None); }
 crate::vpn_enrollment::execute(&base,target,&control,prepared,&credential,&operation).await.map(Some)
}
#[cfg(all(test,unix))]
mod tests {
 use super::*;
 use crate::node_controller::{GenesisBindingReview,Request,Target,ROOT};
 use serde_json::json;
 use std::sync::atomic::{AtomicU64,Ordering};

 #[test]
 fn runtime_probe_refusal_exposes_only_exact_fixed_controller_failures(){
  let generic=runtime_probe_refusal(&Value::Null);
  let pairs=[
   ("runtime_probe_not_executable","Authenticated candidate node is not executable"),
   ("runtime_probe_scope_refused","Installed runtime probe scope refused"),
   ("runtime_probe_package_refused","Authenticated candidate inventory refused"),
   ("runtime_probe_origin_refused","Approved public origin refused"),
   ("runtime_probe_execution_refused","Candidate native origin verifier execution refused"),
   ("runtime_probe_response_refused","Candidate native origin response refused"),
   ("runtime_probe_changed","Runtime probe scope changed during verification"),
  ];
  for (code,message) in pairs{
   let reply=json!({"version":1,"ok":false,"error":{"code":code,"message":message}});
   assert_eq!(runtime_probe_refusal(&reply),format!("{code}: {message}; no software or authority was changed"));
   for field in ["code","message"]{
    let mut bad=reply.clone();bad["error"][field]=json!("private stderr\n/path/custody");
    assert_eq!(runtime_probe_refusal(&bad),generic);
   }
   let mut extra=reply.clone();extra["error"]["stderr"]=json!("private detail");
   assert_eq!(runtime_probe_refusal(&extra),generic);
   extra=reply.clone();extra["result"]=json!({});assert_eq!(runtime_probe_refusal(&extra),generic);
   for (key,value) in [("version",json!(2)),("version",json!("1")),("ok",json!(true)),("ok",json!(0))]{
    let mut bad=reply.clone();bad[key]=value;assert_eq!(runtime_probe_refusal(&bad),generic);
   }
   for field in ["code","message"]{
    let mut bad=reply.clone();bad["error"][field]=Value::Null;assert_eq!(runtime_probe_refusal(&bad),generic);
    bad["error"].as_object_mut().unwrap().remove(field);assert_eq!(runtime_probe_refusal(&bad),generic);
   }
  }
  for unsupported in [json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":"Controller validation or lifecycle operation failed"}}),json!({"version":1,"ok":true,"result":{}}),json!([])]{
   assert_eq!(runtime_probe_refusal(&unsupported),generic);
  }
 }

 fn genesis_bind_scope_fixture() -> (Target,Request,GenesisBindingReview,PathBuf) {
  static NEXT_FIXTURE:AtomicU64=AtomicU64::new(0);
  let target=Target{kind:"remote".into(),host:Some("fixture.invalid".into()),port:None,root:ROOT.into(),guest:None};
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

 fn genesis_target_capability(operation:&str)->Value {
  let reads:&[&str]=if operation=="genesis_stage" {&["formation_status","genesis_stage_preflight"]} else {&["genesis_binding_preflight"]};
  let mut operations=vec![json!({"operation":operation,"kind":"mutation","available":true,"blocker":null})];
  operations.extend(reads.iter().map(|name|json!({"operation":name,"kind":"read","available":true,"blocker":null})));
  json!({"version":1,"ok":true,"result":{"controllerVersion":1,"root":ROOT,"installed":true,
   "platform":"linux","architecture":"x86_64","localValidatorSupported":true,"communityEnrollment":false,"operations":operations}})
 }

 fn reviewed_install_fixture() -> (Target, Request, PathBuf, Value, Value, Value) {
  let (target,_,_,journal)=genesis_bind_scope_fixture();
  let request=Request{version:1,operation:"install".into(),parameters:json!({
   "release_id":"fixture-release","manifest_sha256":"a".repeat(64),"network_id":"fixture-network","chain_id":1266,"node_name":"fixture-node"})};
  let staged=json!({"version":1,"ok":true,"result":{"controllerVersion":1,"root":"/opt/synergy","installed":false,
   "platform":"linux","architecture":"x86_64","localValidatorSupported":true,"operations":[
    {"operation":"install","kind":"mutation","available":true,"blocker":null},
    {"operation":"install_preflight","kind":"read","available":true,"blocker":null}]}});
  let preflight=json!({"version":1,"ok":true,"result":{"packageVerified":true,"release":"fixture-release","root":"/opt/synergy",
   "networkSelectionApproved":true,"genesisAuthorityVerified":false,"activationAuthorized":false}});
  let receipt=json!({"version":1,"ok":true,"result":{"format":"synergy-universal-linux-v1","root":"/opt/synergy","role":"validator",
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

 fn reviewed_service_stop_fixture()->(Target,Request,PathBuf,Value,Value) {
  let (target,request,journal,mut capability,_,receipt)=reviewed_service_start_fixture("stop");
  capability["result"]["operations"].as_array_mut().unwrap().pop();
  (target,request,journal,capability,receipt)
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
  wrong_root["result"]["root"]=json!("/opt/Synergy");
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
   wrong_root["result"]["root"]=json!("/opt/Synergy");
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
 fn reviewed_service_stop_rechecks_the_installed_stop_capability_before_journaling() {
  let (target,request,journal,capability,_)=reviewed_service_stop_fixture();
  let mut cases=Vec::new();
  for (field,value) in [("installed",json!(false)),("controllerVersion",json!(2)),("platform",json!("darwin")),
   ("architecture",json!("aarch64")),("root",json!("/opt/Synergy")),("localValidatorSupported",json!(false))] {
   let mut changed=capability.clone();
   changed["result"][field]=value;
   cases.push(changed);
  }
  for operations in [json!([]),json!([{"operation":"stop","kind":"read","available":true}]),
   json!([{"operation":"stop","kind":"mutation","available":false}]),
   json!([{"operation":"stop","kind":"mutation","available":true},{"operation":"stop","kind":"mutation","available":true}])] {
   let mut changed=capability.clone();
   changed["result"]["operations"]=operations;
   cases.push(changed);
  }
  for changed in cases {
   let mut calls=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(changed.clone()))
   }));
   assert!(outcome.unwrap_err().contains("qualified stop action"));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
   assert!(!journal.exists());
  }
 }

 #[test]
 fn reviewed_service_stop_sends_only_the_exact_request_and_fences_ambiguous_outcomes() {
  let (target,request,journal,capability,receipt)=reviewed_service_stop_fixture();
  let refused=|code,message|json!({"version":1,"ok":false,"error":{"code":code,"message":message}});
  let mut malformed=receipt.clone();
  malformed["metadata"]=json!("private fixture");
  let mut unsupported=receipt.clone();
  unsupported["version"]=json!(2);
  let mut ambiguous_refusal=refused("authorization_required","Host authorization expired or differs");
  ambiguous_refusal["error"]["detail"]=json!("private fixture");
  let cases=[(Ok(receipt.clone()),Some(true)),
   (Ok(refused("authorization_required","Host authorization expired or differs")),Some(false)),
   (Ok(refused("qualification_required","Operation has not passed host qualification")),Some(false)),
   (Ok(refused("vpn_readiness_required","Current native VPN must match the recorded, independently server-bound validator peer")),None),
   (Ok(malformed),None),(Ok(unsupported),None),(Ok(ambiguous_refusal),None),
   (Ok(json!({"version":1,"ok":true,"result":{"requested":"restart","healthNotInferred":true}})),None),
   (Ok(json!({"version":1,"ok":true,"result":{"requested":"stop","healthNotInferred":false}})),None),
   (Err("private fixture".into()),None)];
  for (raw,settled) in cases {
   let mut calls=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(capability.clone()),"stop"=>raw.clone(),_=>panic!("stop must not inspect VPN, health or startup"),
    })
   }));
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),request.canonical()]);
   assert_eq!(calls[1].to_string(),r#"{"operation":"stop","parameters":{},"version":1}"#);
   let history=request_journal::inspect(&journal).unwrap();
   let row=&history["records"][0];
   assert_eq!(row["request_digest"],request.approval_id());
   assert_eq!(row["operation"],"stop");
   assert_eq!(row["response_ok"],json!(settled));
   assert_eq!(row["state"],if settled.is_some(){"response_received"}else{"uncertain"});
   match settled {
    Some(true)=>assert_eq!(outcome.unwrap(),receipt),
    Some(false)=>assert_eq!(outcome.unwrap()["ok"],false),
    None=>{
     assert_eq!(outcome.unwrap_err(),node_controller::NODE_SERVICE_UNCERTAIN);
     assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"stop",&request.canonical()).is_err());
    },
   }
   assert!(!history.to_string().contains("private fixture"));
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 #[test]
 fn reviewed_service_stop_respects_an_existing_uncertain_target_dispatch() {
  let (target,request,journal,capability,_)=reviewed_service_stop_fixture();
  let prior=Request{version:1,operation:"start".into(),parameters:json!({})};
  request_journal::Dispatch::begin(&journal,&target.journal_identity(),"start",&prior.canonical()).unwrap()
   .finish(&Err(node_controller::NODE_SERVICE_UNCERTAIN.into())).unwrap();
  let original=request_journal::inspect(&journal).unwrap();
  let mut calls=Vec::new();
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
   calls.push(query.canonical());
   std::future::ready(Ok(capability.clone()))
  }));
  assert!(outcome.unwrap_err().contains("earlier local dispatch"));
  assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
  assert_eq!(request_journal::inspect(&journal).unwrap(),original);
  std::fs::remove_dir_all(&journal).unwrap();
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
    assert_eq!(result["result"],json!({"schema":"nodenetwork-installed-validator-v1","root":"/opt/synergy","role":"validator",
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
  report["result"]["communityEnrollment"]=json!(false);
  report["result"]["operations"]=json!([{"operation":"commission","kind":"mutation","available":true,"blocker":null},
   {"operation":"formation_status","kind":"read","available":true,"blocker":null}]);
  let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
  let receipt=json!({"version":1,"ok":true,"result":{"commissioned":true,"consensus_started":false,"production_approved":false}});
  (target,request,journal,report,receipt)
 }

 fn formation_absent()->Value {
  json!({"version":1,"ok":true,"result":{"pending":false}})
 }

 fn commission_formation_scope(report:&mut Value)->(Value,Value,Value) {
  let operations=report["result"]["operations"].as_array_mut().unwrap();
  for operation in ["vpn_status","genesis_binding_preflight"] {
   operations.push(json!({"operation":operation,"kind":"read","available":true,"blocker":null}));
  }
  let preparation=Request{version:1,operation:"formation_prepare".into(),parameters:json!({"formation_sha256":"b".repeat(64)})};
  let formation=json!({"version":1,"ok":true,"result":{"pending":true,"schema":"nodenetwork-formation-v1",
   "network_id":"fixture-formation","chain_id":"99999","formation_sha256":"b".repeat(64),"formation_id":"c".repeat(64),
   "request_sha256":preparation.approval_id(),"address":"synv1".to_owned()+&"a".repeat(36),
   "possession_verified":true,"membership_granted":false}});
  let vpn=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-status-v1","service_registered":true,
   "enrollment_staged":false,"enrollment_recorded":true,"reconciliation_required":false,"server_bound":true,"connected":true}});
  (formation,vpn,genesis_binding_projection(true))
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
  operations.push(operations[1].clone());
  let mut invalid_reports=vec![wrong_read,unavailable,duplicate];
  let mut missing_formation=report.clone();
  missing_formation["result"]["operations"].as_array_mut().unwrap().pop();
  invalid_reports.push(missing_formation);
  for (field,value) in [("installed",json!(false)),("controllerVersion",json!(2)),("platform",json!("darwin")),
   ("architecture",json!("aarch64")),("root",json!("/opt/Synergy")),("localValidatorSupported",json!(false)),("communityEnrollment",json!(true))] {
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
 fn reviewed_commission_refuses_ambiguous_formation_status_before_vpn_or_journal() {
  let (target,request,journal,mut report,_)=reviewed_commission_fixture();
  let (mut unsupported,_,_)=commission_formation_scope(&mut report);
  unsupported["result"]["request_sha256"]=json!("1".repeat(64));
  let mut extra=formation_absent();
  extra["raw"]=json!("private fixture");
  let mut wrong_version=formation_absent();
  wrong_version["version"]=json!(2);
  let mut extra_result=formation_absent();
  extra_result["result"]["name"]=json!("private fixture");
  let refused=json!({"version":1,"ok":false,"error":{"code":"reconciliation_required","message":"private fixture"}});
  for invalid in [Ok(unsupported),Ok(extra),Ok(wrong_version),Ok(extra_result),Ok(refused),Err("private fixture".into())] {
   let mut wire=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    wire.push(query.canonical());
    std::future::ready(if query.operation=="target" {Ok(report.clone())} else {invalid.clone()})
   }));
   assert!(!outcome.unwrap_err().contains("private fixture"));
   assert_eq!(wire,[json!({"version":1,"operation":"target","parameters":{}}),
    json!({"version":1,"operation":"formation_status","parameters":{}})]);
   assert!(!journal.exists());
  }
 }

 #[test]
 fn reviewed_commission_accepts_only_current_pending_formation_vpn_and_binding() {
  let (target,request,journal,mut report,receipt)=reviewed_commission_fixture();
  let (formation,vpn,binding)=commission_formation_scope(&mut report);
  let mut wire=Vec::new();
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
   wire.push(query.canonical());
   std::future::ready(Ok(match query.operation.as_str() {
    "target"=>report.clone(),"formation_status"=>formation.clone(),"vpn_status"=>vpn.clone(),
    "genesis_binding_preflight"=>binding.clone(),"commission"=>receipt.clone(),_=>panic!("unadmitted method"),
   }))
  }));
  assert_eq!(wire,["target","formation_status","vpn_status","genesis_binding_preflight","target","commission"]
   .map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
  let reply=outcome.unwrap();
  assert_eq!(reply["result"]["schema"],"nodenetwork-commissioning-v1");
  assert_eq!(reply["result"]["commissioned"],true);
  assert_eq!(reply["result"]["consensus_started"],false);
  let history=request_journal::inspect(&journal).unwrap();
  assert_eq!(history["records"][0]["request_digest"],request.approval_id());
  assert_eq!(history["records"][0]["state"],"response_received");
  for retained in [&reply,&history] {
   let representation=retained.to_string();
   assert!(!representation.contains("fixture-formation") && !representation.contains("genesis_sha256"));
  }
  std::fs::remove_dir_all(&journal).unwrap();
 }

 #[test]
 fn reviewed_commission_refuses_formation_scope_and_late_target_drift_without_dispatch() {
  let (target,request,journal,mut report,_)=reviewed_commission_fixture();
  let (formation,vpn,binding)=commission_formation_scope(&mut report);
  let mut no_binding_read=report.clone();
  no_binding_read["result"]["operations"].as_array_mut().unwrap().pop();
  let mut lost_commission=report.clone();
  lost_commission["result"]["operations"][0]["available"]=json!(false);
  let mut cases=vec![(no_binding_read.clone(),vpn.clone(),binding.clone(),report.clone(),2),
   (report.clone(),vpn.clone(),binding.clone(),no_binding_read,5),
   (report.clone(),vpn.clone(),binding.clone(),lost_commission,5)];
  for (field,wrong) in [("service_registered",false),("enrollment_recorded",false),("reconciliation_required",true),
   ("server_bound",false),("connected",false)] {
   let mut invalid=vpn.clone();
   invalid["result"][field]=json!(wrong);
   cases.push((report.clone(),invalid,binding.clone(),report.clone(),3));
  }
  for (field,wrong) in [("bound",json!(false)),("network_id",json!("foreign-fixture")),("chain_id",json!("1266")),
   ("address",json!("synv1".to_owned()+&"b".repeat(36))),("membership_verified",json!(false)),
   ("genesis_authority_verified",json!(false)),("genesis_sha256",json!("invalid")),("stage_receipt_verified",json!(null)),
   ("leak",json!("private fixture"))] {
   let mut invalid=binding.clone();
   invalid["result"][field]=wrong;
   cases.push((report.clone(),vpn.clone(),invalid,report.clone(),4));
  }
  for (initial,vpn,binding,final_target,seen) in cases {
   let mut wire=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_software(&target,&request,&journal,|query| {
    wire.push(query.canonical());
    std::future::ready(Ok(match query.operation.as_str() {
     "target" if wire.len()==1=>initial.clone(),"target"=>final_target.clone(),
     "formation_status"=>formation.clone(),"vpn_status"=>vpn.clone(),"genesis_binding_preflight"=>binding.clone(),
     _=>panic!("scope drift must refuse before dispatch"),
    }))
   }));
   assert!(!outcome.unwrap_err().contains("private fixture"));
   let intended=["target","formation_status","vpn_status","genesis_binding_preflight","target"]
    .map(|operation|json!({"version":1,"operation":operation,"parameters":{}}));
   assert_eq!(wire,&intended[..seen]);
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
    std::future::ready(match query.operation.as_str(){
     "target"=>Ok(report.clone()),"formation_status"=>Ok(formation_absent()),"commission"=>raw.clone(),_=>panic!("unadmitted method"),
    })
   }));
   assert_eq!(wire,["target","formation_status","target","commission"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
   assert_eq!(wire[3].to_string(),r#"{"operation":"commission","parameters":{},"version":1}"#);
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
      let response=if query.operation=="formation_status" {formation_absent()} else {report.clone()};
      attempted.push(query.operation);
      std::future::ready(Ok(response))
     }));
     assert_eq!(attempted,["target","formation_status","target"]);
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
  let completed=json!({"version":1,"ok":true,"result":{"format":"synergy-software-upgrade-completed-v1","root":"/opt/synergy",
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
  let request=Request{version:1,operation:"uninstall".into(),parameters:json!({"confirmation":"/opt/synergy"})};
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
  assert_eq!(calls.as_slice(),std::slice::from_ref(&target_read));
  assert!(!journal.exists());

  let removed=json!({"version":1,"ok":true,"result":{"removed_root":"/opt/synergy","logical_removal_verified":true,
   "forensic_erasure_proven":false,"backup_created":false,"remaining_host_managed_records":[]}});
  let mut scope_mismatch=removed.clone();
  scope_mismatch["result"]["removed_root"]=json!("/opt/Synergy");
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
   assert_eq!(calls[1].to_string(),r#"{"operation":"uninstall","parameters":{"confirmation":"/opt/synergy"},"version":1}"#);
   let history=request_journal::inspect(&journal).unwrap();
   assert_eq!(history["records"][0]["state"],state);
   assert_eq!(history["records"][0]["request_digest"],request.approval_id());
   assert_eq!(history["records"][0]["response_ok"],json!(reported_ok));
   assert!(!history.to_string().contains("/opt/synergy"));
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
   ("root",json!("/opt/Synergy")),("resumed",json!("true")),("vpn_stopped",json!(true)),
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

 fn upgrade_receipt_fixture()->(Target,Request,PathBuf,Value,Value) {
  let (target,selection,journal,mut report,_,_)=reviewed_upgrade_fixture();
  report["result"]["operations"]=json!([{"operation":"diagnostics","kind":"read","available":true,"blocker":null}]);
  let diagnostics=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-diagnostics-v1","observed_at_ms":200,
   "installation":{"role":"validator","network_id":"fixture-network","node_name":"fixture-private-node","chain_id":"18446744073709551615",
    "package_sha256":selection.parameters["manifest_sha256"]},"services":{"node":null,"vpn":null},
   "storage":{"capacity_bytes":100,"available_bytes":50},"log":{"available":false,"size_bytes":null,
    "window_bytes":0,"complete_lines":0,"severity":{"error":0,"warn":0,"info":0,"debug":0,"trace":0,"unclassified":0}}}});
  (target,selection,journal,report,diagnostics)
 }

 fn install_receipt_selection(chain:&str)->InstallReceiptSelection {
  serde_json::from_value(json!({"releaseId":"fixture-release","manifestSha256":"a".repeat(64),
   "networkId":"fixture-network","chainId":chain,"nodeName":"fixture-private-node"})).unwrap()
 }

 #[test]
 fn reviewed_install_receipt_uses_the_pinned_owner_hash_and_exact_decimal_u64() {
  let parsed=install_receipt_selection("18446744073709551615").request().unwrap();
  assert_eq!(parsed.validate(),Ok(true));
  assert_eq!(parsed.parameters["chain_id"].as_u64(),Some(u64::MAX));
  assert_eq!(parsed.approval_id(),"798042cdf35369cf2f7d329f5e8ce145841cf5b40d03458b3efc93812c497ce0");
  for wrong in ["0","-1","+1266","01266","1266\n","18446744073709551616","1e3"] {
   assert!(install_receipt_selection(wrong).request().is_err(),"{wrong:?}");
  }
 }

 #[test]
 fn reviewed_install_receipt_checks_all_identity_fields_and_preserves_the_exact_journal() {
  let (target,_,journal,report,diagnostics)=upgrade_receipt_fixture();
  let selection=install_receipt_selection("18446744073709551615").request().unwrap();
  request_journal::Dispatch::begin(&journal,&target.journal_identity(),"install",&selection.canonical()).unwrap()
   .finish(&Err("unknown outcome".into())).unwrap();
  let history=request_journal::inspect(&journal).unwrap();
  let record_id=history["records"][0]["id"].as_str().unwrap();
  let path=journal.join("nodenetwork-requests-v1").join(format!("{record_id}.json"));
  let original=std::fs::read(&path).unwrap();
  let mut replies=vec![(diagnostics.clone(),"match")];
  for (field,value) in [("role",json!("rpc_gateway")),("network_id",json!("different-network")),
   ("chain_id",json!("18446744073709551614")),("node_name",json!("other-validator")),("package_sha256",json!("b".repeat(64)))] {
   let mut changed=diagnostics.clone();
   changed["result"]["installation"][field]=value;
   replies.push((changed,"different"));
  }
  let mut malformed=diagnostics;
  malformed["result"]["installation"]["chain_id"]=json!(18446744073709551615_u64);
  replies.push((malformed,"unavailable"));
  for (reply,status) in replies {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(review_software_receipt(&target,record_id,&selection,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(match query.operation.as_str(){"target"=>report.clone(),"diagnostics"=>reply.clone(),_=>panic!("unadmitted request")}))
   })).unwrap();
   assert_eq!(result,json!({"schema":"nodenetwork-install-receipt-review-v1","status":status}));
   assert_eq!(calls,["target","diagnostics"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
   assert_eq!(std::fs::read(&path).unwrap(),original);
  }
  assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"install",&selection.canonical()).is_err());
  assert_eq!(request_journal::inspect(&journal).unwrap(),history);
  std::fs::remove_dir_all(journal).unwrap();
 }

 #[test]
 fn reviewed_install_receipt_excludes_bootstrap_wrong_digest_and_late_record_drift() {
  let (target,_,journal,report,diagnostics)=upgrade_receipt_fixture();
  let selection=install_receipt_selection("18446744073709551615").request().unwrap();
  let fingerprint=target.journal_identity();
  let mut fixtures=Vec::new();
  for operation in ["bootstrap","install"] {
   let directory=journal.join(operation);
   let dispatch=request_journal::Dispatch::begin(&directory,&fingerprint,operation,&selection.canonical()).unwrap();
   let history=request_journal::inspect(&directory).unwrap();
   fixtures.push((directory,history["records"][0]["id"].as_str().unwrap().to_owned(),dispatch));
  }
  let (bootstrap,id,_)=&fixtures[0];
  let never_read=|_| -> std::future::Ready<Result<Value,String>> {panic!("unmatched request must refuse before transport")};
  assert!(tauri::async_runtime::block_on(review_software_receipt(&target,id,&selection,bootstrap,never_read)).is_err());
  let (directory,id,dispatch)=fixtures.pop().unwrap();
  let wrong=install_receipt_selection("18446744073709551614").request().unwrap();
  assert!(tauri::async_runtime::block_on(review_software_receipt(&target,&id,&wrong,&directory,never_read))
   .unwrap_err().contains("do not match this install dispatch"));
  let mut pending=Some(dispatch);
  let result=tauri::async_runtime::block_on(review_software_receipt(&target,&id,&selection,&directory,|query| {
   if query.operation=="diagnostics" {pending.take().unwrap().finish(&Err("record progressed".into())).unwrap();}
   std::future::ready(Ok(if query.operation=="target" {report.clone()} else {diagnostics.clone()}))
  }));
  assert!(result.unwrap_err().contains("selected install dispatch changed"));
  std::fs::remove_dir_all(journal).unwrap();
 }

 #[test]
 fn reviewed_upgrade_receipt_compares_only_reported_installation_and_preserves_journal_bytes() {
  let (target,selection,journal,report,diagnostics)=upgrade_receipt_fixture();
  // Exact hash also emitted by the pinned Testnet owner for this request.
  assert_eq!(selection.approval_id(),"9c4f1dc658029d4de17f8466073297e964e8feb130e0be44d8ade4cf50f24f95");
  request_journal::Dispatch::begin(&journal,&target.journal_identity(),"upgrade",&selection.canonical()).unwrap()
   .finish(&Err("unknown outcome".into())).unwrap();
  let history=request_journal::inspect(&journal).unwrap();
  let record_id=history["records"][0]["id"].as_str().unwrap();
  let entry=journal.join("nodenetwork-requests-v1").join(format!("{record_id}.json"));
  let original=std::fs::read(&entry).unwrap();
  let mut different=diagnostics.clone();
  different["result"]["installation"]["package_sha256"]=json!("b".repeat(64));
  let mut invalid=diagnostics.clone();
  invalid["result"]["installation"]["chain_id"]=json!(1266);
  let mut unsupported=report.clone();
  unsupported["result"]["operations"][0]["kind"]=json!("mutation");
  for (controller,reply,status,count) in [(report.clone(),Ok(diagnostics),"match",2),(report.clone(),Ok(different),"different",2),
   (report.clone(),Ok(invalid),"unavailable",2),(report,Err("private fixture".into()),"unavailable",2),
   (unsupported,Err("not admitted".into()),"unavailable",1)] {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(review_software_receipt(&target,record_id,&selection,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(match query.operation.as_str(){"target"=>Ok(controller.clone()),"diagnostics"=>reply.clone(),_=>panic!("unadmitted request")})
   })).unwrap();
   assert_eq!(result,json!({"schema":"nodenetwork-upgrade-receipt-review-v1","status":status}));
   let expected=["target","diagnostics"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}}));
   assert_eq!(calls,&expected[..count]);
   assert_eq!(std::fs::read(&entry).unwrap(),original);
   assert_eq!(request_journal::inspect(&journal).unwrap(),history);
  }
  assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"upgrade",&selection.canonical()).is_err());
  std::fs::remove_dir_all(journal).unwrap();
 }

 #[test]
 fn reviewed_upgrade_receipt_refuses_wrong_request_before_transport_and_retires_drift() {
  for changed_at in ["target","diagnostics"] {
   let (target,selection,journal,report,diagnostics)=upgrade_receipt_fixture();
   let dispatch=request_journal::Dispatch::begin(&journal,&target.journal_identity(),"upgrade",&selection.canonical()).unwrap();
   let history=request_journal::inspect(&journal).unwrap();
   let record_id=history["records"][0]["id"].as_str().unwrap();
   let mut wrong=selection.clone();
   wrong.parameters["release_id"]=json!("other-fixture-release");
   let denied=tauri::async_runtime::block_on(review_software_receipt(&target,record_id,&wrong,&journal,
    |_| -> std::future::Ready<Result<Value,String>> {panic!("wrong release must refuse before transport")}));
   assert!(denied.unwrap_err().contains("do not match this upgrade dispatch"));
   wrong.parameters["release_id"]=selection.parameters["release_id"].clone();
   wrong.parameters["manifest_sha256"]=json!("z".repeat(64));
   assert!(tauri::async_runtime::block_on(review_software_receipt(&target,record_id,&wrong,&journal,
    |_| -> std::future::Ready<Result<Value,String>> {panic!("invalid digest must refuse before transport")})).is_err());
   let foreign=Target{kind:"remote".into(),host:Some("another-fixture.invalid".into()),port:None,root:ROOT.into(),guest:None};
   assert!(tauri::async_runtime::block_on(review_software_receipt(&foreign,record_id,&selection,&journal,
    |_| -> std::future::Ready<Result<Value,String>> {panic!("wrong target must refuse before transport")})).is_err());
   let mut pending=Some(dispatch);
   let mut calls=Vec::new();
   let drift=tauri::async_runtime::block_on(review_software_receipt(&target,record_id,&selection,&journal,|query| {
    if query.operation==changed_at {pending.take().unwrap().finish(&Err("record progressed".into())).unwrap();}
    calls.push(query.operation.clone());
    std::future::ready(Ok(if query.operation=="target" {report.clone()} else {diagnostics.clone()}))
   }));
   assert!(drift.unwrap_err().contains("selected upgrade dispatch changed"));
   assert_eq!(calls,if changed_at=="target" {vec!["target"]} else {vec!["target","diagnostics"]});
   std::fs::remove_dir_all(journal).unwrap();
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

 fn reviewed_genesis_stage_receipt_fixture()->(Target,PathBuf,Value,Value,String) {
  let (target,_,prepared,_,_,journal)=genesis_stage_fixture();
  let (_,_,_,mut controller,_,_)=reviewed_install_fixture();
  controller["result"]["installed"]=json!(true);
  controller["result"]["operations"]=json!([{"operation":"genesis_binding_preflight","kind":"read","available":true,"blocker":null}]);
  let mut retained=genesis_binding_projection(false);
  retained["result"].as_object_mut().unwrap().remove("stage_receipt_verified");
  retained["result"]["stage_request_sha256"]=json!(prepared.request_sha256);
  (target,journal,controller,retained,prepared.request_sha256)
 }

 fn retained_binding(pin:&str)->Value {
  use sha2::{Digest,Sha256};
  let mut retained=genesis_binding_projection(true);
  retained["result"].as_object_mut().unwrap().remove("stage_receipt_verified");
  let request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":pin})};
  let enrollment=r#"{"fixture":"native-only enrollment"}"#;
  retained["result"]["genesis_sha256"]=json!(pin);
  retained["result"]["request_sha256"]=json!(request.approval_id());
  retained["result"]["enrollment_json"]=json!(enrollment);
  retained["result"]["enrollment_sha256"]=json!(format!("{:x}",Sha256::digest(enrollment.as_bytes())));
  retained
 }

 fn reviewed_identity_receipt_fixture()->(Target,PathBuf,Value,Request,Value) {
  let (target,journal,mut controller)=reviewed_formation_receipt_fixture();
  controller["result"]["operations"][0]["operation"]=json!("identity_status");
  let request=Request{version:1,operation:"identity_generate".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
  let pending=json!({"version":1,"ok":true,"result":{"pending":true,"network_id":"fixture-network",
   "chain_id":"18446744073709551615","genesis_sha256":"a".repeat(64),"address":"synv1".to_owned()+&"a".repeat(36),
   "genesis_authority_verified":true,"possession_verified":true,"membership_granted":false}});
  (target,journal,controller,request,pending)
 }

 #[test]
 fn reviewed_identity_receipt_compares_only_verified_genesis_input_and_preserves_exact_journal() {
  let (target,journal,controller,request,pending)=reviewed_identity_receipt_fixture();
  // Independently emitted by pinned controller.py::request_digest.
  assert_eq!(request.approval_id(),"f8749259ab9d8ff9aa8474f31f83305ca8efc250cc0905f5638701b12f3e3fd0");
  request_journal::Dispatch::begin(&journal,&target.journal_identity(),"identity_generate",&request.canonical()).unwrap()
   .finish(&Err("unknown outcome".into())).unwrap();
  let history=request_journal::inspect(&journal).unwrap();
  let id=history["records"][0]["id"].as_str().unwrap();
  let path=journal.join("nodenetwork-requests-v1").join(format!("{id}.json"));
  let original=std::fs::read(&path).unwrap();
  let mut different=pending.clone();
  different["result"]["genesis_sha256"]=json!("b".repeat(64));
  let mut extra=pending.clone();
  extra["detail"]=json!("private-identity-fixture");
  let mut unverified=pending.clone();
  unverified["result"]["possession_verified"]=json!(false);
  let mut wrong_version=pending.clone();
  wrong_version["version"]=json!(2);
  let absent=json!({"version":1,"ok":true,"result":{"pending":false}});
  let refused=json!({"version":1,"ok":false,"error":{"code":"reconciliation_required","message":"private-identity-fixture"}});
  let mut no_read=controller.clone();
  no_read["result"]["operations"][0]["kind"]=json!("mutation");
  for (admission,result,status,count) in [(controller.clone(),pending,"match",2),(controller.clone(),different,"different",2),
   (controller.clone(),absent,"absent",2),(controller.clone(),extra,"unsupported",2),(controller.clone(),unverified,"unsupported",2),
   (controller.clone(),wrong_version,"unsupported",2),(controller,refused,"unsupported",2),(no_read,Value::Null,"unsupported",1)] {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::Identity,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(match query.operation.as_str(){"target"=>admission.clone(),"identity_status"=>result.clone(),_=>panic!("unadmitted request")}))
   })).unwrap();
   assert_eq!(result,json!({"schema":"nodenetwork-identity-receipt-review-v1","status":status,
    "provenance":if ["match","different"].contains(&status) {"genesis_input"} else {"none"}}));
   let wire=["target","identity_status"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}}));
   assert_eq!(calls,&wire[..count]);
   assert_eq!(std::fs::read(&path).unwrap(),original);
   assert_eq!(request_journal::inspect(&journal).unwrap(),history);
  }
  assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"identity_generate",&request.canonical()).is_err());
  std::fs::remove_dir_all(journal).unwrap();
 }

 #[test]
 fn reviewed_identity_receipt_rejects_other_operations_and_retires_in_flight_journal_drift() {
  for drift in ["target","identity_status"] {
   let (target,journal,controller,request,pending)=reviewed_identity_receipt_fixture();
   let other=journal.join("other");
   request_journal::Dispatch::begin(&other,&target.journal_identity(),"genesis_bind",&request.canonical()).unwrap();
   let other_history=request_journal::inspect(&other).unwrap();
   let other_id=other_history["records"][0]["id"].as_str().unwrap();
   let rejected=tauri::async_runtime::block_on(review_custody_receipt(&target,other_id,&other,CustodyReceiptKind::Identity,
    |_| -> std::future::Ready<Result<Value,String>> {panic!("wrong operation must not reach transport")}));
   assert!(rejected.is_err());
   std::fs::remove_dir_all(other).unwrap();
   let dispatch=request_journal::Dispatch::begin(&journal,&target.journal_identity(),"identity_generate",&request.canonical()).unwrap();
   let history=request_journal::inspect(&journal).unwrap();
   let id=history["records"][0]["id"].as_str().unwrap();
   let mut live=Some(dispatch);
   let mut calls=Vec::new();
   let rejected=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::Identity,|query| {
    if query.operation==drift {live.take().unwrap().finish(&Err("record progressed".into())).unwrap();}
    calls.push(query.operation.clone());
    std::future::ready(Ok(if query.operation=="target" {controller.clone()} else {pending.clone()}))
   }));
   assert!(rejected.unwrap_err().contains("selected identity preparation dispatch changed"));
   assert_eq!(calls,if drift=="target" {vec!["target"]} else {vec!["target","identity_status"]});
   std::fs::remove_dir_all(journal).unwrap();
  }
 }

 #[test]
 fn reviewed_identity_receipt_scoped_provenance_is_redacted_and_never_settles_journal() {
  let (target,journal,controller,request,mut pending)=reviewed_identity_receipt_fixture();
  pending["result"]["schema"]=json!("nodenetwork-existing-identity-network-v1");
  pending["result"]["request_sha256"]=json!(request.approval_id());
  request_journal::Dispatch::begin(&journal,&target.journal_identity(),"identity_generate",&request.canonical()).unwrap()
   .finish(&Err("unknown outcome".into())).unwrap();
  let history=request_journal::inspect(&journal).unwrap();
  let id=history["records"][0]["id"].as_str().unwrap();
  let original=std::fs::read(journal.join("nodenetwork-requests-v1").join(format!("{id}.json"))).unwrap();
  let mut input_only=pending.clone();input_only["result"].as_object_mut().unwrap().remove("request_sha256");
  let mut malformed=pending.clone();malformed["result"]["request_sha256"]=json!("b".repeat(64));
  for (raw,status,provenance) in [(pending,"match","identity_request"),(input_only,"match","genesis_input"),(malformed,"unsupported","none")] {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::Identity,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(if query.operation=="target" {controller.clone()} else {raw.clone()}))
   })).unwrap();
   assert_eq!(result,json!({"schema":"nodenetwork-identity-receipt-review-v1","status":status,"provenance":provenance}));
   assert_eq!(calls,vec![json!({"version":1,"operation":"target","parameters":{}}),json!({"version":1,"operation":"identity_status","parameters":{}})]);
   assert_eq!(std::fs::read(journal.join("nodenetwork-requests-v1").join(format!("{id}.json"))).unwrap(),original);
   assert!(!result.to_string().contains(&request.approval_id()));
  }
  assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),"identity_generate",&request.canonical()).is_err());
  std::fs::remove_dir_all(journal).unwrap();
 }

 fn reviewed_formation_receipt_fixture()->(Target,PathBuf,Value) {
  let (target,_,journal,mut controller,_,_)=reviewed_install_fixture();
  controller["result"]["installed"]=json!(true);
  controller["result"]["operations"]=json!([{"operation":"formation_status","kind":"read","available":true,"blocker":null}]);
  (target,journal,controller)
 }

 fn retained_formation(pin:&str)->Value {
  let request=Request{version:1,operation:"formation_prepare".into(),parameters:json!({"formation_sha256":pin})};
  json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-formation-v1","network_id":"fixture-network",
   "chain_id":"18446744073709551615","formation_sha256":pin,"formation_id":"b".repeat(64),"pending":true,
   "address":"synv1".to_owned()+&"a".repeat(36),"possession_verified":true,"membership_granted":false,"request_sha256":request.approval_id()}})
 }

 #[test]
 fn reviewed_formation_receipt_compares_verified_pending_custody_without_touching_journal() {
  let (target,journal,controller)=reviewed_formation_receipt_fixture();
  let retained=retained_formation(&"a".repeat(64));
  let request_digest="3d1a736fbc86a3e25a10764739cb3b53e31e4d070c3dfe546b648e73c8b7979d";
  assert_eq!(retained["result"]["request_sha256"],request_digest);
  let dispatch=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"formation_prepare",request_digest.into()).unwrap();
  dispatch.finish(&Err("fixture uncertainty".into())).unwrap();
  let previous=request_journal::inspect(&journal).unwrap();
  let id=previous["records"][0]["id"].as_str().unwrap();
  let different=retained_formation(&"d".repeat(64));
  let absent=json!({"version":1,"ok":true,"result":{"pending":false}});
  let mut wrong_request=retained.clone();
  wrong_request["result"]["request_sha256"]=json!("c".repeat(64));
  let mut unauthorized=retained.clone();
  unauthorized["result"]["membership_granted"]=json!(true);
  let mut exposed=retained.clone();
  exposed["result"]["registration_json"]=json!("native-only fixture");
  let mut envelope=retained.clone();
  envelope["metadata"]=json!("native-only fixture");
  let partial=json!({"version":1,"ok":false,"error":{"code":"reconciliation_required","message":"fixture private owner details"}});
  for (raw,status) in [(Ok(retained),"match"),(Ok(different),"different"),(Ok(absent),"absent"),
   (Ok(wrong_request),"unsupported"),(Ok(unauthorized),"unsupported"),(Ok(exposed),"unsupported"),
   (Ok(envelope),"unsupported"),(Ok(partial),"unsupported"),(Err("fixture private transport details".into()),"unsupported")] {
   let mut calls=Vec::new();
   let result=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::Formation,|query| {
    calls.push(query.canonical());
    std::future::ready(if query.operation=="target" {Ok(controller.clone())} else {raw.clone()})
   })).unwrap();
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),json!({"version":1,"operation":"formation_status","parameters":{}})]);
   assert_eq!(result,json!({"schema":"nodenetwork-formation-receipt-review-v1","status":status}));
   assert_eq!(request_journal::inspect(&journal).unwrap(),previous);
  }
  assert!(request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"formation_prepare",request_digest.into()).is_err());
  std::fs::remove_dir_all(&journal).unwrap();
 }

 #[test]
 fn reviewed_formation_receipt_requires_current_scope_before_dispatch_and_publication() {
  for drift in ["target","formation_status"] {
   let (target,journal,controller)=reviewed_formation_receipt_fixture();
   let digest=retained_formation(&"a".repeat(64))["result"]["request_sha256"].as_str().unwrap().to_owned();
   let dispatch=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"formation_prepare",digest).unwrap();
   let history=request_journal::inspect(&journal).unwrap();
   let id=history["records"][0]["id"].as_str().unwrap();
   for wrong_kind in [CustodyReceiptKind::GenesisStaging,CustodyReceiptKind::GenesisBinding] {
    let denied=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,wrong_kind,
     |_| -> std::future::Ready<Result<Value,String>> {panic!("mismatched receipt operation must not reach the controller")}));
    assert!(denied.is_err());
   }
   let mut unsupported=controller.clone();
   unsupported["result"]["operations"][0]["operation"]=json!("genesis_binding_preflight");
   let result=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::Formation,|query| {
    assert_eq!(query.operation,"target");
    std::future::ready(Ok(unsupported.clone()))
   })).unwrap();
   assert_eq!(result["status"],"unsupported");
   let mut dispatch=Some(dispatch);
   let mut calls=Vec::new();
   let denied=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::Formation,|query| {
    calls.push(query.operation.clone());
    if query.operation==drift {dispatch.take().unwrap().finish(&Err("fixture record progressed".into())).unwrap();}
    std::future::ready(Ok(if query.operation=="target" {controller.clone()} else {retained_formation(&"a".repeat(64))}))
   }));
   assert!(denied.unwrap_err().contains("selected formation preparation dispatch changed"));
   assert_eq!(calls,if drift=="target" {vec!["target"]} else {vec!["target","formation_status"]});
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 #[test]
 fn reviewed_genesis_binding_receipt_compares_only_verified_retained_binding() {
  let (target,_,_,journal)=genesis_bind_scope_fixture();
  let (_,_,_,mut controller,_,_)=reviewed_install_fixture();
  controller["result"]["installed"]=json!(true);
  controller["result"]["operations"]=json!([{"operation":"genesis_binding_preflight","kind":"read","available":true,"blocker":null}]);
  let mut retained=retained_binding(&"a".repeat(64));
  let request_digest="0e8a5f309948535cbc5fa7fdb13f298d053a1d964d673646d247a1008649463e";
  assert_eq!(retained["result"]["request_sha256"],request_digest);
  retained["result"]["stage_request_sha256"]=json!("b".repeat(64));
  let dispatch=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_bind",request_digest.into()).unwrap();
  dispatch.finish(&Err("fixture uncertainty".into())).unwrap();
  let previous=request_journal::inspect(&journal).unwrap();
  let id=previous["records"][0]["id"].as_str().unwrap();
  let mut different=retained_binding(&"c".repeat(64));
  different["result"]["stage_request_sha256"]=json!(request_digest);
  let mut unbound=genesis_binding_projection(false);
  unbound["result"].as_object_mut().unwrap().remove("stage_receipt_verified");
  unbound["result"]["stage_request_sha256"]=json!(request_digest);
  let mut wrong_binding=retained.clone();
  wrong_binding["result"]["request_sha256"]=json!("d".repeat(64));
  let mut wrong_enrollment=retained.clone();
  wrong_enrollment["result"]["enrollment_sha256"]=json!("d".repeat(64));
  let mut wrong_custody=retained.clone();
  wrong_custody["result"]["bound"]=json!(false);
  for (raw,status) in [(Ok(retained),"match"),(Ok(different),"different"),(Ok(unbound),"absent"),
   (Ok(wrong_binding),"unsupported"),(Ok(wrong_enrollment),"unsupported"),(Ok(wrong_custody),"unsupported"),
   (Err("private transport error".into()),"unsupported")] {
   let mut calls=Vec::new();
   let response=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::GenesisBinding,|query| {
    calls.push(query.canonical());
    std::future::ready(if query.operation=="target" {Ok(controller.clone())} else {raw.clone()})
   })).unwrap();
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),
    json!({"version":1,"operation":"genesis_binding_preflight","parameters":{}})]);
   assert_eq!(response,json!({"schema":"nodenetwork-genesis-binding-receipt-review-v1","status":status}));
   assert_eq!(request_journal::inspect(&journal).unwrap(),previous);
  }
  assert!(request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_bind",request_digest.into()).is_err());
  std::fs::remove_dir_all(&journal).unwrap();
 }

 #[test]
 fn reviewed_genesis_binding_receipt_rejects_stage_and_retired_records_before_contact() {
  let (target,_,_,journal)=genesis_bind_scope_fixture();
  for (operation,settled) in [("genesis_stage",false),("genesis_bind",true)] {
   let dispatch=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),operation,"a".repeat(64)).unwrap();
   if settled {dispatch.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();}
   let history=request_journal::inspect(&journal).unwrap();
   let id=history["records"][0]["id"].as_str().unwrap();
   let response=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::GenesisBinding,
    |_| -> std::future::Ready<Result<Value,String>> {panic!("wrong operation or settled record must not contact controller")}));
   assert!(response.unwrap_err().contains("unresolved Genesis binding entry"));
   assert_eq!(request_journal::inspect(&journal).unwrap(),history);
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 #[test]
 fn reviewed_genesis_stage_receipt_compares_exact_native_journal_digest_without_writing() {
  let (target,journal,controller,retained,request_digest)=reviewed_genesis_stage_receipt_fixture();
  let dispatch=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_stage",request_digest.clone()).unwrap();
  dispatch.finish(&Err("fixture uncertainty".into())).unwrap();
  let previous=request_journal::inspect(&journal).unwrap();
  let id=previous["records"][0]["id"].as_str().unwrap();
  let mut different=retained.clone();
  different["result"]["stage_request_sha256"]=json!("b".repeat(64));
  let mut absent=retained.clone();
  absent["result"].as_object_mut().unwrap().remove("stage_request_sha256");
  let mut malformed=retained.clone();
  malformed["result"]["stage_request_sha256"]=json!("c".repeat(64)+"\n");
  let mut private=retained.clone();
  private["result"]["unexpected"]=json!("raw artifact");
  for (raw,status) in [(Ok(retained),"match"),(Ok(different),"different"),(Ok(absent),"absent"),
   (Ok(malformed),"unsupported"),(Ok(private),"unsupported"),(Err("private transport error".into()),"unsupported")] {
   let mut calls=Vec::new();
   let response=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::GenesisStaging,|query| {
    calls.push(query.canonical());
    std::future::ready(if query.operation=="target" {Ok(controller.clone())} else {raw.clone()})
   })).unwrap();
   assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}}),
    json!({"version":1,"operation":"genesis_binding_preflight","parameters":{}})]);
   assert_eq!(response,json!({"schema":"nodenetwork-genesis-stage-receipt-review-v1","status":status}));
   assert!(!response.to_string().contains(&request_digest));
   assert_eq!(request_journal::inspect(&journal).unwrap(),previous);
  }
  assert!(request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_stage",request_digest).is_err());
  std::fs::remove_dir_all(&journal).unwrap();
 }

 #[test]
 fn reviewed_genesis_stage_receipt_requires_the_exact_unresolved_entry_and_capability() {
  let (target,journal,controller,_,pin)=reviewed_genesis_stage_receipt_fixture();
  let other=Target{kind:target.kind.clone(),host:Some("other.invalid".into()),port:target.port,root:target.root.clone(),guest:target.guest.clone()};
  let stage=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_stage",pin.clone()).unwrap();
  let unrelated=request_journal::Dispatch::begin_digest(&journal,&other.journal_identity(),"genesis_bind",pin).unwrap();
  let history=request_journal::inspect(&journal).unwrap();
  let rows=history["records"].as_array().unwrap();
  let stage_id=rows.iter().find(|row|row["operation"]=="genesis_stage").unwrap()["id"].as_str().unwrap();
  let unrelated_id=rows.iter().find(|row|row["operation"]=="genesis_bind").unwrap()["id"].as_str().unwrap();
  for (test_target,id) in [(&target,"bad id"),(&target,unrelated_id),(&other,stage_id),(&other,unrelated_id)] {
   let response=tauri::async_runtime::block_on(review_custody_receipt(test_target,id,&journal,CustodyReceiptKind::GenesisStaging,
    |_| -> std::future::Ready<Result<Value,String>> {panic!("unmatched record must not contact controller")}));
   assert!(response.is_err());
  }
  let mut unavailable=controller;
  unavailable["result"]["operations"][0]["available"]=json!(false);
  let mut calls=Vec::new();
  let response=tauri::async_runtime::block_on(review_custody_receipt(&target,stage_id,&journal,CustodyReceiptKind::GenesisStaging,|query| {
   calls.push(query.canonical());
   std::future::ready(Ok(unavailable.clone()))
  })).unwrap();
  assert_eq!(response["status"],"unsupported");
  assert_eq!(calls,[json!({"version":1,"operation":"target","parameters":{}})]);
  assert_eq!(request_journal::inspect(&journal).unwrap(),history);
  stage.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  unrelated.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  let result=tauri::async_runtime::block_on(review_custody_receipt(&target,stage_id,&journal,CustodyReceiptKind::GenesisStaging,|_|std::future::ready(Err("unexpected".into()))));
  assert!(result.unwrap_err().contains("unresolved Genesis staging entry"));
  std::fs::remove_dir_all(&journal).unwrap();
 }

 #[test]
 fn reviewed_genesis_stage_receipt_rechecks_record_before_the_preflight_and_before_publication() {
  for drift in ["target","genesis_binding_preflight"] {
   let (target,journal,controller,retained,pin)=reviewed_genesis_stage_receipt_fixture();
   let dispatch=request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_stage",pin).unwrap();
   let history=request_journal::inspect(&journal).unwrap();
   let id=history["records"][0]["id"].as_str().unwrap();
   let mut dispatch=Some(dispatch);
   let mut calls=Vec::new();
   let response=tauri::async_runtime::block_on(review_custody_receipt(&target,id,&journal,CustodyReceiptKind::GenesisStaging,|query| {
    calls.push(query.operation.clone());
    if query.operation==drift {dispatch.take().unwrap().finish(&Err("record progressed".into())).unwrap();}
    std::future::ready(Ok(if query.operation=="target" {controller.clone()} else {retained.clone()}))
   }));
   assert!(response.unwrap_err().contains("selected Genesis staging dispatch changed"));
   assert_eq!(calls,if drift=="target" {vec!["target"]} else {vec!["target","genesis_binding_preflight"]});
   std::fs::remove_dir_all(&journal).unwrap();
  }
 }

 #[test]
 fn genesis_stage_command_stops_after_changed_native_policy_before_creating_journal() {
  let (target,review,prepared,formation,mut policy,journal)=genesis_stage_fixture();
  let capability=genesis_target_capability("genesis_stage");
  policy["result"]["authority_sha256"]=json!("e".repeat(64));
  let mut reads=Vec::new();
  let refused=tauri::async_runtime::block_on(dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|request| {
   reads.push(request.canonical());
   std::future::ready(Ok(match request.operation.as_str() {
    "target"=>capability.clone(),"formation_status"=>formation.clone(),"genesis_stage_preflight"=>policy.clone(),_=>panic!("unexpected read"),
   }))
  },|_|std::future::ready(Err("Unexpected staging transport".into()))));
  assert!(refused.unwrap_err().contains("differs from the reviewed address or input pins"));
  assert_eq!(reads,["target","formation_status","genesis_stage_preflight"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
  assert!(!journal.exists());
 }

 #[test]
 fn genesis_stage_command_rechecks_installed_qualifications_before_and_after_review() {
  for late in [false,true] {
   let (target,review,prepared,formation,policy,journal)=genesis_stage_fixture();
   let capability=genesis_target_capability("genesis_stage");
   let mut retired=capability.clone();
   retired["result"]["operations"][0]["available"]=json!(false);
   let mut reads=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|query| {
    reads.push(query.canonical());
    std::future::ready(Ok(match query.operation.as_str() {
     "target" if (reads.len()>1)==late=>retired.clone(),"target"=>capability.clone(),
     "formation_status"=>formation.clone(),"genesis_stage_preflight"=>policy.clone(),_=>panic!("unadmitted read"),
    }))
   },|_| -> std::future::Ready<Result<Value,String>> {panic!("staging must not dispatch after lost qualification")}));
   let expected=["target","formation_status","genesis_stage_preflight","target"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}}));
   assert_eq!(reads,&expected[..if late {4}else{1}]);
   assert!(outcome.unwrap_err().contains("qualified Genesis operation"));
   assert!(!journal.exists());
  }
 }

 #[test]
 fn genesis_stage_command_settles_exact_success_and_pregrant_refusal_only() {
  for (variant,observed) in [("success",Some(true)),("refusal",Some(false)),("extra-success",None),
   ("extra-error",None),("extra-refusal",None),("wrong-version",None),("unrecognized-refusal",None),("transport",None)] {
   let (target,review,prepared,formation,policy,journal)=genesis_stage_fixture();
   let capability=genesis_target_capability("genesis_stage");
   let digest=prepared.request_sha256.clone();
   let mut success=policy.clone();
   success["result"]["schema"]=json!("nodenetwork-genesis-stage-v1");
   success["result"]["request_sha256"]=json!(digest);
   success["result"]["genesis_authority_verified"]=json!(true);
   success["result"]["membership_verified"]=json!(true);
   success["result"]["staged"]=json!(true);
   let mut refusal=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Host authorization expired or differs"}});
   let reply=match variant {
    "success"=>Ok(success),"refusal"=>Ok(refusal),
    "extra-success"=>{success["detail"]=json!("private fixture");Ok(success)},
    "extra-error"=>{refusal["error"]["detail"]=json!("private fixture");Ok(refusal)},
    "extra-refusal"=>{refusal["detail"]=json!("private fixture");Ok(refusal)},
    "wrong-version"=>{refusal["version"]=json!(2);Ok(refusal)},
    "unrecognized-refusal"=>{refusal["error"]["message"]=json!("private fixture");Ok(refusal)},
    "transport"=>Err("private fixture".into()),_=>unreachable!(),
   };
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|query| {
    std::future::ready(Ok(match query.operation.as_str() {
     "target"=>capability.clone(),"formation_status"=>formation.clone(),"genesis_stage_preflight"=>policy.clone(),_=>panic!("unadmitted read"),
    }))
   },|_|std::future::ready(reply)));
   let history=request_journal::inspect(&journal).unwrap();
   let row=&history["records"][0];
   assert_eq!(row["response_ok"],json!(observed),"{variant}");
   assert_eq!(row["request_digest"],digest);
   match observed {
    Some(ok)=>assert_eq!(outcome.unwrap()["ok"],ok),
    None=>{
     assert_eq!(outcome.unwrap_err(),GENESIS_STAGE_UNCERTAIN);
     assert!(request_journal::Dispatch::begin_digest(&journal,&target.journal_identity(),"genesis_stage",digest).is_err());
    },
   }
   assert_eq!(row["state"],if observed.is_some(){"response_received"}else{"uncertain"});
   assert!(!history.to_string().contains("private fixture"));
   std::fs::remove_dir_all(journal).unwrap();
  }
 }

 #[test]
 fn genesis_stage_command_fences_scope_mismatch_and_sends_only_exact_native_wire() {
  let (target,review,prepared,formation,policy,journal)=genesis_stage_fixture();
  let capability=genesis_target_capability("genesis_stage");
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
  let mut reads=Vec::new();
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_stage(&target,&review,prepared,&journal,|request| {
   reads.push(request.canonical());
   std::future::ready(Ok(match request.operation.as_str() {
    "target"=>capability.clone(),"formation_status"=>formation.clone(),"genesis_stage_preflight"=>policy.clone(),_=>panic!("unexpected read"),
   }))
  },|wire|{
   assert_eq!(wire,exact);
   let object:Value=serde_json::from_str(&wire).unwrap();
   assert_eq!(object,json!({"version":1,"operation":"genesis_stage","parameters":{"artifacts":{
    "genesis.json":"{\"sample\":1}\r\n","authority.json":"{}","authority-root.pub":"AP+AAg=="}}}));
   std::future::ready(Ok(receipt))
  }));
  assert!(outcome.unwrap_err().contains("outcome is uncertain"));
  assert_eq!(reads,["target","formation_status","genesis_stage_preflight","target"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
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
  let capability=genesis_target_capability("genesis_bind");
  let mut calls=Vec::new();
  let mut drift=genesis_binding_projection(false);
  drift["result"]["address"]=json!("synv1".to_owned()+&"b".repeat(36));
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_binding(&target,&request,&review,&journal, |submitted| {
   calls.push(submitted.canonical());
   std::future::ready(Ok(if submitted.operation=="target" {capability.clone()} else {drift.clone()}))
  }));
  assert!(outcome.unwrap_err().contains("differs from the reviewed unbound Genesis scope"));
  assert_eq!(calls,["target","genesis_binding_preflight"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
  assert!(!journal.exists());
 }

 #[test]
 fn genesis_bind_command_rechecks_installed_qualifications_before_and_after_review() {
  for late in [false,true] {
   let (target,request,review,journal)=genesis_bind_scope_fixture();
   let capability=genesis_target_capability("genesis_bind");
   let mut retired=capability.clone();
   retired["result"]["operations"][1]["kind"]=json!("mutation");
   let mut calls=Vec::new();
   let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_binding(&target,&request,&review,&journal,|query| {
    calls.push(query.canonical());
    std::future::ready(Ok(match query.operation.as_str() {
     "target" if (calls.len()>1)==late=>retired.clone(),"target"=>capability.clone(),
     "genesis_binding_preflight"=>genesis_binding_projection(false),_=>panic!("binding must not dispatch after lost qualification"),
    }))
   }));
   let expected=["target","genesis_binding_preflight","target"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}}));
   assert_eq!(calls,&expected[..if late {3}else{1}]);
   assert!(outcome.unwrap_err().contains("qualified Genesis operation"));
   assert!(!journal.exists());
  }
 }

 #[test]
 fn genesis_bind_command_accepts_inherited_staging_and_fences_transport_failures() {
  for transport_failed in [false,true] {
   let (target,request,review,journal)=genesis_bind_scope_fixture();
   let capability=genesis_target_capability("genesis_bind");
   let result=tauri::async_runtime::block_on(dispatch_reviewed_genesis_binding(&target,&request,&review,&journal,|query| {
    std::future::ready(match query.operation.as_str() {
     "target"=>Ok(capability.clone()),"genesis_binding_preflight"=>Ok(genesis_binding_projection(false)),
     "genesis_bind" if transport_failed=>Err("private fixture".into()),
     "genesis_bind"=>Ok(genesis_binding_projection(true)),_=>panic!("unexpected read"),
    })
   }));
   let history=request_journal::inspect(&journal).unwrap();
   let row=&history["records"][0];
   assert_eq!(row["state"],if transport_failed {"uncertain"} else {"response_received"});
   assert_eq!(row["request_digest"],request.approval_id());
   if transport_failed {
    assert_eq!(result.unwrap_err(),node_controller::GENESIS_BIND_UNCERTAIN);
    assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),&request.operation,&request.canonical()).is_err());
   } else {
    let result=result.unwrap();
    assert_eq!(result["result"]["bound"],true);
    assert_eq!(result["result"]["stage_receipt_verified"],false);
   }
   assert!(!history.to_string().contains("private fixture"));
   std::fs::remove_dir_all(journal).unwrap();
  }
 }

 #[test]
 fn genesis_bind_command_preserves_exact_wire_and_journals_validly_typed_scope_drift_as_uncertain() {
  let (target,request,review,journal)=genesis_bind_scope_fixture();
  let capability=genesis_target_capability("genesis_bind");
  let mut calls=Vec::new();
  let mut drift=genesis_binding_projection(true);
  drift["result"]["chain_id"]=json!("1266");
  let outcome=tauri::async_runtime::block_on(dispatch_reviewed_genesis_binding(&target,&request,&review,&journal, |submitted| {
   calls.push(submitted.canonical());
   let report=match submitted.operation.as_str() {
    "target"=>capability.clone(),"genesis_binding_preflight"=>genesis_binding_projection(false),"genesis_bind"=>drift.clone(),_=>panic!("unexpected read"),
   };
   std::future::ready(Ok(report))
  }));
  assert!(outcome.unwrap_err().contains("outcome is uncertain"));
  assert_eq!(calls[..3],["target","genesis_binding_preflight","target"].map(|operation|json!({"version":1,"operation":operation,"parameters":{}})));
  assert_eq!(calls[3].to_string(),format!(r#"{{"operation":"genesis_bind","parameters":{{"genesis_sha256":"{}"}},"version":1}}"#,"a".repeat(64)));
  let history=request_journal::inspect(&journal).unwrap();
  assert_eq!(history["records"][0]["state"],"uncertain");
  assert_eq!(history["records"][0]["request_digest"],"0e8a5f309948535cbc5fa7fdb13f298d053a1d964d673646d247a1008649463e");
  assert!(request_journal::Dispatch::begin(&journal,&target.journal_identity(),&request.operation,&request.canonical()).is_err());
  assert!(!history.to_string().contains("fixture-formation"));
  std::fs::remove_dir_all(journal).unwrap();
 }
}
