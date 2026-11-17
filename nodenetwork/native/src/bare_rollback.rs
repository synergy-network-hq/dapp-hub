use crate::{commands,node_bootstrap,node_controller::{self,Target},request_journal};
use serde_json::{json,Value};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
fn checked(reply:&Value,release:&str,pin:&str,apply:bool)->Result<Value,String>{
 let v=&reply["result"];
 let schema=if apply{"nodenetwork-bare-bootstrap-rollback-v1"}else{"nodenetwork-bare-bootstrap-rollback-preflight-v1"};
 let digest=v["review_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 if reply["ok"]!=true||v["schema"]!=schema||v["release_id"]!=release||v["manifest_sha256"]!=pin||!digest||if apply{v["root_removed"]!=true||v["registrations_removed"]!=true||v["administrative_configuration_preserved"]!=true}else{v["root"]!="/opt/synergy"||v["software_installed"]!=false||v["controller_enrolled"]!=true||!v["root_guard_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}{return Err("Bare bootstrap state is not exactly verified; preserve it for reconciliation".into())}Ok(v.clone())
}
#[tauri::command]
pub async fn portal_nodenetwork_bare_rollback(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operator:String,release_id:String)->Result<Option<Value>,String>{
 commands::main_only(&window)?;
 let pin=node_bootstrap::bare_rollback_scope(&target,&release_id,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_BARE_ROLLBACK_MANIFEST_SHA256"),cfg!(debug_assertions))?;
 node_bootstrap::validate_operator(&operator)?;
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let preflight=node_bootstrap::execute_bare_rollback(target.clone(),&operator,&release_id,None,&control).await?;
 let verified=checked(&preflight,&release_id,&pin,false)?;
 let review=verified["review_sha256"].as_str().ok_or("Missing rollback review")?.to_owned();
 let message=format!("ISOLATED ENGINEERING ONLY\nTarget: {}\nAccount: {}\nOld release: {}\nOld master SHA256: {}\nExact bare-state review: {}\n\nRemove only this verified, completed bare controller bootstrap and its attributed registrations. No installed software, identity, custody, authorization, grants or node state may exist. The native master rechecks all state before deletion. No automatic retry is allowed.",target.label(),operator,release_id,pin,review);
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review bare bootstrap removal").buttons(MessageDialogButtons::OkCancelCustom("Remove exact bare bootstrap once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Rollback confirmation interrupted")?;
 if !consent{return Ok(None)}
 let base=app.path().app_local_data_dir().map_err(|_|"Portal state unavailable")?;
 let request=json!({"version":1,"operation":"bare_bootstrap_rollback","parameters":{"release_id":release_id,"manifest_sha256":pin,"review_sha256":review}});
 let dispatch=request_journal::Dispatch::begin(&base,&target.journal_identity(),"bare_bootstrap_rollback",&request)?;
 let mut result=node_bootstrap::execute_bare_rollback(target,&operator,&release_id,Some(&review),&control).await;
 if let Ok(reply)=&result{match checked(reply,&release_id,&pin,true){Ok(v) if v["review_sha256"]==review=>{},_=>result=Err("Rollback outcome not exactly confirmed; do not retry".into())}}
 dispatch.finish(&result)?;
 result.map(|v|Some(v["result"].clone()))
}
#[cfg(test)] mod tests{
 use super::*;
 #[test] fn rollback_scope_never_reuses_new_release_approval_or_other_targets(){
  let mut t=Target{kind:"remote".into(),host:Some("127.0.0.1".into()),port:Some(22280),root:"/opt/synergy".into(),guest:None};
  assert!(node_bootstrap::bare_rollback_scope(&t,"old",Some(&"a".repeat(64)),false).is_err());
  assert!(node_bootstrap::bare_rollback_scope(&t,"old",None,true).is_err());
  t.host=Some("other.example".into());assert!(node_bootstrap::bare_rollback_scope(&t,"old",Some(&"a".repeat(64)),true).is_err());
 }
 #[test] fn rollback_result_never_adopts_changed_or_partial_state(){
  let pin="a".repeat(64);let mut v=json!({"ok":true,"result":{"schema":"nodenetwork-bare-bootstrap-rollback-preflight-v1","release_id":"old","manifest_sha256":pin,"review_sha256":"b".repeat(64),"root":"/opt/synergy","software_installed":false,"controller_enrolled":true,"root_guard_sha256":"c".repeat(64)}});
  assert!(checked(&v,"old",&pin,false).is_ok());v["result"]["software_installed"]=json!(true);assert!(checked(&v,"old",&pin,false).is_err());v["result"]["software_installed"]=json!(false);assert!(checked(&v,"other",&pin,false).is_err());assert!(checked(&v,"old",&"c".repeat(64),false).is_err());assert!(checked(&v,"old",&pin,true).is_err());
 }
}
