use crate::{commands,node_bootstrap,node_controller::{self,Target},request_journal};
use serde_json::{json,Value};
use tauri::Manager;
use sha2::{Digest,Sha256};
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
fn checked(reply:&Value,release:&str,pin:&str,authorization:Option<&str>,apply:bool)->Result<Value,String>{
 let v=&reply["result"];
 let authorization_matches=match v.get("authorization_sha256"){
  Some(Value::Null)=>authorization.is_none(),
  Some(Value::String(actual))=>authorization==Some(actual.as_str()),
  _=>false,
 };
 let schema=if apply{"nodenetwork-bare-bootstrap-rollback-v1"}else{"nodenetwork-bare-bootstrap-rollback-preflight-v1"};
 let digest=v["review_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 if !authorization_matches||reply["ok"]!=true||v["schema"]!=schema||v["release_id"]!=release||v["manifest_sha256"]!=pin||!digest||if apply{v["root_removed"]!=true||v["registrations_removed"]!=true||v["administrative_configuration_preserved"]!=true}else{v["root"]!="/opt/synergy"||v["software_installed"]!=false||v["controller_enrolled"]!=true||!v["root_guard_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}{return Err("Bare bootstrap state is not exactly verified; preserve it for reconciliation".into())}Ok(v.clone())
}
fn original_scope(doc:&Value,release:&str,pin:&str)->Result<(),String>{
 if doc["sequence"]!=1||doc["release_id"]!=release||doc["manifest_sha256"]!=pin{return Err("Original authorization differs from the independently approved old master or initial sequence".into())}Ok(())
}
pub(super) fn verified_original(raw:&str,target:&Target,release:&str,pin:&str)->Result<String,String>{
 if raw.is_empty()||raw.len()>65536{return Err("Original public authorization exceeds its bounded format".into())}
 let doc=crate::operator_authorization::verify_initial(raw,target)?;original_scope(&doc,release,pin)?;
 Ok(format!("{:x}",Sha256::digest(raw.as_bytes())))
}
fn read_original(path:&std::path::Path)->Result<String,String>{
 use std::io::Read;
 if path.file_name().and_then(|n|n.to_str())!=Some("authorization.json"){return Err("Select the original public authorization.json".into())}
 let metadata=std::fs::symlink_metadata(path).map_err(|_|"Original authorization unavailable")?;
 if !metadata.is_file()||metadata.len()>65536{return Err("Original authorization must be one bounded regular public file".into())}
 let mut bytes=Vec::new();std::fs::File::open(path).and_then(|f|f.take(65537).read_to_end(&mut bytes)).map_err(|_|"Cannot read original authorization")?;
 if bytes.len()>65536{return Err("Original authorization exceeds bound".into())}String::from_utf8(bytes).map_err(|_|"Original public authorization must be UTF8".into())
}
#[tauri::command]
pub async fn portal_nodenetwork_bare_rollback(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operator:String,release_id:String)->Result<Option<Value>,String>{
 commands::main_only(&window)?;
 let pin=node_bootstrap::bare_rollback_scope(&target,&release_id,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_BARE_ROLLBACK_MANIFEST_SHA256"),cfg!(debug_assertions))?;
 node_bootstrap::validate_operator(&operator)?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal state unavailable")?;
 let original=match crate::authorization_lifecycle::bare_initial(&base,&target)?{
  Some(raw)=>Some(raw),
  None=>{let view=window.clone();tauri::async_runtime::spawn_blocking(move||{
   let Some(file)=view.dialog().file().set_parent(&view).set_title("Original public authorization.json, if staged; Cancel only for a bootstrap with no authorization").add_filter("Public authorization",&["json"]).blocking_pick_file()else{return Ok(None)};
   read_original(&file.into_path().map_err(|_|"Select a local public authorization file")?).map(Some)
  }).await.map_err(|_|"Original authorization selection interrupted")??}
 };
 let authorization=original.as_deref().map(|raw|verified_original(raw,&target,&release_id,&pin)).transpose()?;
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let preflight=node_bootstrap::execute_bare_rollback(target.clone(),&operator,&release_id,None,original.as_deref(),&control).await?;
 let verified=checked(&preflight,&release_id,&pin,authorization.as_deref(),false)?;
 let review=verified["review_sha256"].as_str().ok_or("Missing rollback review")?.to_owned();
 let authorization_review=authorization.as_deref().map(|sha|format!("Remove still-unused initial formation authorization SHA256: {sha}, its exact original unconsumed grants and public formation context. No continuation or consumed grant is permitted.")).unwrap_or_else(||"No formation authorization or grants may exist.".into());
 let message=format!("ISOLATED ENGINEERING ONLY\nTarget: {}\nAccount: {}\nOld release: {}\nOld master SHA256: {}\nExact bare-state review: {}\n\nRemove only this verified, completed bare controller bootstrap and its attributed registrations. {} No installed software, identity, custody, VPN or node state may exist. The native master rechecks all state before deletion. No automatic retry is allowed.",target.label(),operator,release_id,pin,review,authorization_review);
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review bare bootstrap removal").buttons(MessageDialogButtons::OkCancelCustom("Remove exact bare bootstrap once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Rollback confirmation interrupted")?;
 if !consent{return Ok(None)}
 let request=json!({"version":1,"operation":"bare_bootstrap_rollback","parameters":{"release_id":release_id,"manifest_sha256":pin,"review_sha256":review,"authorization_sha256":authorization}});
 let dispatch=request_journal::Dispatch::begin(&base,&target.journal_identity(),"bare_bootstrap_rollback",&request)?;
 let mut result=node_bootstrap::execute_bare_rollback(target,&operator,&release_id,Some(&review),original.as_deref(),&control).await;
 if let Ok(reply)=&result{match checked(reply,&release_id,&pin,authorization.as_deref(),true){Ok(v) if v["review_sha256"]==review=>{},_=>result=Err("Rollback outcome not exactly confirmed; do not retry".into())}}
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
  let pin="a".repeat(64);let mut v=json!({"ok":true,"result":{"schema":"nodenetwork-bare-bootstrap-rollback-preflight-v1","release_id":"old","manifest_sha256":pin,"review_sha256":"b".repeat(64),"root":"/opt/synergy","software_installed":false,"controller_enrolled":true,"root_guard_sha256":"c".repeat(64),"authorization_sha256":null}});
  assert!(checked(&v,"old",&pin,None,false).is_ok());v["result"]["software_installed"]=json!(true);assert!(checked(&v,"old",&pin,None,false).is_err());v["result"]["software_installed"]=json!(false);assert!(checked(&v,"other",&pin,None,false).is_err());assert!(checked(&v,"old",&"c".repeat(64),None,false).is_err());assert!(checked(&v,"old",&pin,None,true).is_err());
 }
 #[test]fn unused_initial_authorization_is_exact_in_review_and_apply(){
  let pin="a".repeat(64);let auth="d".repeat(64);
  let mut reply=json!({"ok":true,"result":{"schema":"nodenetwork-bare-bootstrap-rollback-preflight-v1","release_id":"old","manifest_sha256":pin,"review_sha256":"b".repeat(64),"root":"/opt/synergy","software_installed":false,"controller_enrolled":true,"root_guard_sha256":"c".repeat(64),"authorization_sha256":auth}});
  assert!(checked(&reply,"old",&pin,Some(&auth),false).is_ok());
  assert!(checked(&reply,"old",&pin,None,false).is_err());assert!(checked(&reply,"old",&pin,Some(&"e".repeat(64)),false).is_err());
  reply["result"].as_object_mut().unwrap().remove("authorization_sha256");assert!(checked(&reply,"old",&pin,None,false).is_err());
  reply["result"]=json!({"schema":"nodenetwork-bare-bootstrap-rollback-v1","release_id":"old","manifest_sha256":pin,"review_sha256":"b".repeat(64),"authorization_sha256":auth,"root_removed":true,"registrations_removed":true,"administrative_configuration_preserved":true});
  assert!(checked(&reply,"old",&pin,Some(&auth),true).is_ok());reply["result"]["authorization_sha256"]=Value::Null;assert!(checked(&reply,"old",&pin,Some(&auth),true).is_err());
 }
 #[test]fn original_public_authorization_cannot_change_old_release_or_initial_sequence(){
  let pin="a".repeat(64);let doc=json!({"sequence":1,"release_id":"old","manifest_sha256":pin});assert!(original_scope(&doc,"old",&pin).is_ok());
  for(key,value)in[("sequence",json!(2)),("release_id",json!("new")),("manifest_sha256",json!("b".repeat(64)))]{let mut bad=doc.clone();bad[key]=value;assert!(original_scope(&bad,"old",&pin).is_err());}
 }

}
