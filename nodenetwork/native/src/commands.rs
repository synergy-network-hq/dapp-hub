use serde_json::Value;
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::{formation,node_network,node_controller,node_bootstrap,request_journal};
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
#[tauri::command]
pub async fn portal_nodenetwork_controller(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,request:node_controller::Request)->Result<Value,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 target.validate()?;
 if matches!(request.operation.as_str(),"genesis_stage"|"genesis_stage_preflight"){
  return Err("Use the native signed Genesis folder review.".into());
 }
 let mutation=request.validate()?;
 if mutation {
  let title=format!("Authorize NodeNetwork {}",request.operation);
  let message=format!("Target: {}\nRoot: /opt/Synergy\nOperation: {}\nParameters: {}\nExact request approval ID: {}\n\nThis action changes the selected validator. A separate matching host grant is required. Uninstall destroys the node, keys and signing-safety state. No action is retried automatically.",target.label(),request.operation,request.parameters,request.approval_id());
  let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title(title)
   .buttons(MessageDialogButtons::OkCancelCustom("Authorize once".into(),"Cancel".into())).blocking_show())
   .await.map_err(|_|"Operator confirmation did not finish.")?;
  if !confirmed {return Err("Operator canceled; no controller mutation was sent.".into());}
 }
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let operation=request.operation.clone();
 let target_identity=target.journal_identity();
 let dispatch=if mutation {Some(request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?,&target_identity,&operation,&request.canonical())?)} else {None};
 let result=node_controller::execute(target,request,&directory).await;
 if let Some(dispatch)=dispatch {dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;}
 let mut result=result?;
 if result["ok"]==true {
  if let Some((mutation,request_digest))=formation::reconcile_evidence(&operation,&result["result"])?{
   request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?,&target_identity,mutation,request_digest)?;
  }
  if operation=="genesis_binding_preflight" {
   if let Some(request_digest)=formation::stage_recovery(&result["result"])?{
    request_journal::reconcile_verified(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable.")?,&target_identity,"genesis_stage",request_digest)?;
   }
  }
 }
 if let Some(public)=result["result"].as_object_mut(){
  // Exact artifacts are saved only after a native export review.
  public.remove("registration_json");
  public.remove("enrollment_json");
 }
 Ok(result)
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
  let Some(key)=view.dialog().file().set_parent(&view).set_title("Select the operator SSH PUBLIC key (.pub), never a private key").add_filter("SSH public key",&["pub"]).blocking_pick_file() else{return Ok(None)};
  let key=key.into_path().map_err(|_|"Select a local public key file.")?;
  node_bootstrap::prepare(&root,&key,&fields).map(Some)
 }).await.map_err(|_|"Master bootstrap inspection did not finish.")??;
 let Some(prepared)=prepared else{return Ok(None)};
 let message=format!("Target: {}\nAdministrative account: {}\nRoot: /opt/Synergy\nRelease: {}\nManifest SHA-256: {}\nEmbedded bootstrap SHA-256: {}\nNetwork incarnation: {}\nChain: {}\nNode name: {}\nOperator public-key SHA-256: {}\n\nThis stages the verified software and installs a restricted host controller account, rooted SSH/sudo definitions and OS registration links. The target must be clean. No community enrollment, custody creation, consensus membership or activation is authorized. No passwords are requested or stored by Portal.",target.label(),operator,prepared.release,prepared.manifest_sha256,node_bootstrap::script_pin(),parameters["network_id"],parameters["chain_id"],parameters["node_name"],format!("{:x}",Sha256::digest(prepared.public_key.as_bytes())));
 let confirmed=tauri::async_runtime::spawn_blocking(move ||window.dialog().message(message).parent(&window).title("Authorize NodeNetwork target bootstrap")
  .buttons(MessageDialogButtons::OkCancelCustom("Bootstrap selected target once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Bootstrap confirmation did not finish.")?;
 if !confirmed{return Err("Operator canceled; no bootstrap was sent.".into());}
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let dispatch=request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no bootstrap was sent.")?,&target.journal_identity(),"bootstrap",&serde_json::json!({"version":1,"operation":"bootstrap","operator":operator,"parameters":parameters,"bootstrapPin":node_bootstrap::script_pin()}))?;
 let result=node_bootstrap::execute(target,operator,parameters,prepared,&directory).await;
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
 let reply=node_controller::execute(target,node_controller::Request{version:1,operation:operation.into(),parameters:serde_json::json!({})},&directory).await?;
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
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("Use the main Portal window for native services.".into()) } }

#[tauri::command]
pub async fn portal_nodenetwork_stage_signed_genesis(window:tauri::WebviewWindow,app:tauri::AppHandle,target:node_controller::Target,expected_address:String)->Result<Option<Value>,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 main_only(&window)?;
 target.validate()?;
 let directory=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home is unavailable.")?)?;
 let policy_reply=node_controller::execute(target.clone(),node_controller::Request{version:1,operation:"genesis_stage_preflight".into(),parameters:serde_json::json!({})},&directory).await?;
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
 let request=node_controller::Request{version:1,operation:"genesis_stage".into(),parameters:serde_json::json!({"artifacts":artifacts})};
 request.validate()?;
 let approval=request.approval_id();
 let message=format!("Target: {}\nPrepared validator: {}\n\nGenesis SHA-256: {}\nAuthority SHA-256: {}\nAuthority root SHA-256: {}\n\nExact request approval ID: {}\n\nOnly these three public files will be sent. The controller requires its own matching authorization and will verify the signed network and prepared identity before publishing them. This does not bind custody, prove stake, or start the validator.",target.label(),expected_address,policy["genesis_sha256"],policy["authority_sha256"],policy["authority_root_sha256"],approval);
 let confirmed=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Authorize exact signed Genesis staging").buttons(MessageDialogButtons::OkCancelCustom("Stage these public files once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Signed Genesis staging confirmation did not finish.")?;
 if !confirmed{return Ok(None);}
 let dispatch=request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; nothing was staged.")?,&target.journal_identity(),"genesis_stage",&request.canonical())?;
 let result=node_controller::execute(target,request,&directory).await.and_then(|reply|{
  if reply["ok"]==true{formation::stage_receipt(&reply["result"],&policy,&approval)?;}
  Ok(reply)
 });
 dispatch.finish(&result).map_err(|_|"Genesis staging outcome could not be saved to the local journal. Verify signed Genesis on the target before any further mutation.")?;
 result.map(Some)
}
