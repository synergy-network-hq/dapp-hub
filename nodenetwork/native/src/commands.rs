use serde_json::Value;
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::{node_network,node_controller,node_bootstrap,request_journal};
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
 let dispatch=if mutation {Some(request_journal::Dispatch::begin(&app.path().app_local_data_dir().map_err(|_|"Portal local data directory is unavailable; no mutation was sent.")?,&target.journal_identity(),&request.operation,&request.canonical())?)} else {None};
 let result=node_controller::execute(target,request,&directory).await;
 if let Some(dispatch)=dispatch {dispatch.finish(&result).map_err(|_|"Controller outcome could not be saved to the local journal. Inspect the target before further changes; no automatic retry occurred.")?;}
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
fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("Use the main Portal window for native services.".into()) } }
