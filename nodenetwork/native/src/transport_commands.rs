use crate::{commands,node_controller::{self,Request,Target},request_journal,transport_formation as transport};
use serde_json::{json,Value};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};

#[tauri::command]
pub async fn portal_nodenetwork_transport(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operation:String,review_sha256:Option<String>)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;
 if !matches!(operation.as_str(),"status"|"prepare"|"sign"|"export"){return Err("Unsupported native transport formation operation".into())}
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal app state unavailable")?;
 let reply=commands::controller(&app,target.clone(),Request{version:1,operation:"network_transport_status".into(),parameters:json!({})},&control).await?;
 if reply["ok"]!=true{return Err("Target refused transport status; inspect its signed formation and release first".into())}
 let current=transport::review(&reply["result"])?;
 if current["pending"]==true{
  for(op,field)in[("network_transport_prepare","request_sha256"),("network_transport_sign","sign_request_sha256")]{if let Some(pin)=current[field].as_str(){request_journal::reconcile_verified(&base,&target.journal_identity(),op,pin)?;}}
 }
 if operation=="status"{return Ok(Some(current))}
 if operation=="export"{
  if current["signed"]!=true||review_sha256.as_deref()!=current["review_sha256"].as_str(){return Err("Review the exact signed transport registry before exporting".into())}
  let reply=commands::controller(&app,target,Request{version:1,operation:"network_transport_export".into(),parameters:json!({})},&control).await?;
  if reply["ok"]!=true{return Err("Target refused authenticated public transport export".into())}
  let files=transport::export(&reply["result"],&current)?;let summary=transport::summary(&reply["result"]);
  let suffix=current["review_sha256"].as_str().unwrap()[..16].to_string();
  return tauri::async_runtime::spawn_blocking(move||{
   use std::io::Write;
   let Some(folder)=window.dialog().file().set_parent(&window).set_title("Choose destination for five public commissioning drafts").blocking_pick_folder()else{return Ok(None)};
   let parent=folder.into_path().map_err(|_|"Select a local public export directory")?;
   if parent.ancestors().any(|p|!p.symlink_metadata().is_ok_and(|m|m.is_dir())){return Err("Public export ancestry contains a link".into())}
   let root=parent.join(format!("nodenetwork-transport-{suffix}"));
   #[cfg(unix)]{use std::os::unix::fs::DirBuilderExt;std::fs::DirBuilder::new().mode(0o700).create(&root).map_err(|_|"Public export already exists; reconcile it or select a new destination")?;}
   #[cfg(not(unix))]std::fs::create_dir(&root).map_err(|_|"Public export destination already exists")?;
   struct Cleanup(std::path::PathBuf,bool);impl Drop for Cleanup{fn drop(&mut self){if !self.1{let _=std::fs::remove_dir_all(&self.0);}}}let mut cleanup=Cleanup(root.clone(),false);
   for(index,node)in files.into_iter().enumerate(){let directory=root.join(format!("validator-{}",index+1));for(name,bytes)in node{let path=directory.join(name);std::fs::create_dir_all(path.parent().unwrap()).map_err(|_|"Cannot create public draft directory")?;let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}let mut file=options.open(path).map_err(|_|"Cannot create exact public artifact")?;file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"Public artifact export interrupted")?;}}
   cleanup.1=true;let mut result=summary;result["exported_directory"]=json!(root.to_str().ok_or("Public export path is not UTF8")?);Ok(Some(result))
  }).await.map_err(|_|"Public transport export did not finish")?;
 }
 let request=if operation=="prepare"{
  let view=window.clone();let status=current.clone();
  let picked=tauri::async_runtime::spawn_blocking(move||{
   let Some(file)=view.dialog().file().set_parent(&view).set_title("Select the public transport formation request").add_filter("Public transport request",&["json"]).blocking_pick_file()else{return Ok(None)};
   transport::prepare(&file.into_path().map_err(|_|"Select a local public request")?,&status).map(Some)
  }).await.map_err(|_|"Public transport input review did not finish")??;
  let Some(request)=picked else{return Ok(None)};request
 }else{
  if current["signed"]!=false||review_sha256.as_deref()!=current["review_sha256"].as_str(){return Err("Exact unsigned transport review changed; inspect before signing".into())}
  Request{version:1,operation:"network_transport_sign".into(),parameters:json!({"review_sha256":review_sha256})}
 };
 request.validate()?;
 let details=if operation=="prepare"{json!({"formation_sha256":request.parameters["formation_sha256"],"genesis_review_sha256":request.parameters["genesis_review_sha256"],"provider_report_sha256":request.parameters["target_provider_report_sha256"],"endpoints":request.parameters["members"].as_array().unwrap().iter().map(|m|m["dial_address"].clone()).collect::<Vec<_>>()})}else{current};
 let message=format!("Target: {}\nOperation: {}\nExact request SHA-256: {}\nPublic review: {}\n\nThis is isolated engineering transport formation. Private APQE issuer custody stays on the selected host. Signing requires its distinct reviewed ML-DSA-87 issuer. It neither proves VPN mesh readiness nor admits or starts validators. Interrupted operations must be reconciled through Read transport status; no automatic replay occurs.",target.label(),request.operation,request.approval_id(),details);
 let confirmed=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Authorize exact transport formation").buttons(MessageDialogButtons::OkCancelCustom("Authorize once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Native transport confirmation did not finish")?;
 if !confirmed{return Ok(None)}
 commands::exact_continuation(&app,&target,&request,&control,None).await?;
 let dispatch=request_journal::Dispatch::begin(&base,&target.journal_identity(),&request.operation,&request.canonical())?;
 let result=commands::controller(&app,target,request,&control).await;dispatch.finish(&result)?;
 let reply=result?;if reply["ok"]!=true{return Err("Transport operation refused; inspect status before any further operation".into())}
 transport::review(&reply["result"]).map(Some)
}
