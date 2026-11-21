//! Ordinary single-authority engineering treasury; custody stays on its coordinator.
use crate::{commands,node_controller::{self,Request,Target},request_journal};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)))}
fn exact(v:&Value,fields:&[&str])->bool{v.as_object().is_some_and(|o|o.len()==fields.len()&&fields.iter().all(|k|o.contains_key(*k)))}
fn context(v:&Value)->Result<(),String>{
 if !pin(&v["formation_sha256"])||!v["network_id"].as_str().is_some_and(|s|s.len()>=2&&s.len()<=128&&s.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||b"_-".contains(&c)))||!v["chain_id"].as_str().is_some_and(|s|s.parse::<u64>().is_ok_and(|n|n>0&&n.to_string()==s)){return Err("Invalid authenticated treasury formation scope".into())}Ok(())
}
fn status(v:&Value)->Result<Value,String>{
 if exact(v,&["pending"])&&v["pending"]==false{return Ok(v.clone())}
 if !exact(v,&["schema","pending","address","network_id","chain_id","formation_sha256","request_sha256","effective_at_unix","authorization_sha256","possession_verified","allocation_nwei"])||v["schema"]!="nodenetwork-formation-treasury-v1"||v["pending"]!=true||v["possession_verified"]!=true||v["allocation_nwei"]!="5000000000000000"||!pin(&v["request_sha256"])||!pin(&v["authorization_sha256"])||!v["effective_at_unix"].as_u64().is_some_and(|n|n>0&&n<1<<53)||!v["address"].as_str().is_some_and(|s|s.starts_with("syna1")&&s.len()<=128&&s.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit())){return Err("Unsupported ordinary treasury custody receipt".into())}
 context(v)?;Ok(v.clone())
}
fn prepare_request(v:&Value)->Result<Request,String>{
 if !exact(v,&["schema","network_id","chain_id","formation_sha256","effective_at_unix"])||v["schema"]!="nodenetwork-formation-treasury-preflight-v1"||!v["effective_at_unix"].as_u64().is_some_and(|n|n>0&&n<1<<53){return Err("Unsupported treasury native preflight".into())}context(v)?;
 let request=Request{version:1,operation:"treasury_prepare".into(),parameters:json!({"formation_sha256":v["formation_sha256"],"effective_at_unix":v["effective_at_unix"]})};request.validate()?;Ok(request)
}
fn public_fields(v:&Value)->Result<(),String>{
 const FIELDS:&[&str]=&["schema_version","signature_domain","binding","binary_encoding","identity_id","identity_address","identity_root","authorization_policy","authorization_scopes","current_auth_key_hash","auth_key_history","supersession_history","effective_at","binding_payload_sha3_256","proofs","algorithm","public_key","public_key_sha3_256","policy_type","threshold","principals","principal_id","principal_type","identity_reference","status","purposes","chain_id","network_id","purpose","retired_at","reason","address","derivation_standard","identity_root","authorization_key_possession","signature"];
 match v{Value::Object(o)=>{if o.keys().any(|k|!FIELDS.contains(&k.as_str())){return Err("Unexpected field in public treasury authorization".into())}for child in o.values(){public_fields(child)?}},Value::Array(a)=>{if a.len()>32{return Err("Oversized public treasury authorization".into())}for child in a{public_fields(child)?}},_=>{}}Ok(())
}
fn public_export(v:&Value,review:&Value)->Result<Value,String>{
 let mut receipt=v.clone();let carrier=receipt.as_object_mut().ok_or("Invalid treasury export")?.remove("canary_testing_treasury").ok_or("Public treasury carrier missing")?;
 receipt["schema"]=json!("nodenetwork-formation-treasury-v1");
 if v["schema"]!="nodenetwork-formation-treasury-export-v1"||status(&receipt)?!=*review||!exact(&carrier,&["address","authorization"])||carrier["address"]!=review["address"]{return Err("Treasury export differs from verified custody receipt".into())}
 let authorization=&carrier["authorization"];
 if !exact(authorization,&["schema_version","signature_domain","binding"])||authorization["binding"]["identity_address"]!=review["address"]{return Err("Treasury public authorization identity differs".into())}
 let binding=&authorization["binding"];let scopes=binding["authorization_scopes"].as_array().ok_or("Public treasury authorization scope missing")?;
 if scopes.len()!=1||scopes[0]["network_id"]!=review["network_id"]||scopes[0]["chain_id"].as_u64()!=review["chain_id"].as_str().and_then(|s|s.parse().ok())||scopes[0]["signature_domain"]!=authorization["signature_domain"]||scopes[0]["purpose"]!="transaction-signing"||binding["identity_root"]["algorithm"]!="FN-DSA-1024"||binding["authorization_policy"]["policy_type"]!="single-key"||binding["authorization_policy"]["threshold"]!=1||!binding["authorization_policy"]["principals"].as_array().is_some_and(|p|p.len()==1&&p[0]["algorithm"]=="ML-DSA-87"){return Err("Public ordinary treasury role or network scope differs".into())}
 public_fields(authorization)?;
 let raw=serde_json::to_vec(authorization).map_err(|_|"Cannot encode public treasury authorization")?;
 if raw.len()>128*1024||format!("{:x}",Sha256::digest(&raw))!=review["authorization_sha256"].as_str().unwrap(){return Err("Public treasury authorization commitment differs".into())}Ok(v.clone())
}
#[tauri::command]
pub async fn portal_nodenetwork_treasury(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operation:String)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;
 if !cfg!(debug_assertions)||!matches!(operation.as_str(),"status"|"prepare"|"export"){return Err("Ordinary treasury formation is available only in the approved engineering native app".into())}
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal state unavailable")?;
 let read=|op:&str|Request{version:1,operation:op.into(),parameters:json!({})};
 let reply=commands::controller(&app,target.clone(),read("treasury_status"),&control).await?;
 if reply["ok"]!=true{return Err("Treasury status refused; reconcile the selected coordinator before proceeding".into())}
 let current=status(&reply["result"])?;
 if current["pending"]==true{request_journal::reconcile_verified(&base,&target.journal_identity(),"treasury_prepare",current["request_sha256"].as_str().unwrap())?;}
 if operation=="status"||operation=="prepare"&&current["pending"]==true{return Ok(Some(current))}
 if operation=="export"{
  if current["pending"]!=true{return Err("Read verified ordinary treasury custody before public export".into())}
  let reply=commands::controller(&app,target,read("treasury_export"),&control).await?;
  if reply["ok"]!=true{return Err("Coordinator refused verified public treasury export".into())}
  let result=public_export(&reply["result"],&current)?;
  let bytes=serde_json::to_vec_pretty(&json!({"canary_testing_treasury":result["canary_testing_treasury"]})).map_err(|_|"Cannot encode public recipe field")?;
  let address=current["address"].as_str().unwrap().to_owned();
  return tauri::async_runtime::spawn_blocking(move||{
   use std::io::Write;
   let Some(file)=window.dialog().file().set_parent(&window).set_title("Save ordinary treasury PUBLIC Genesis recipe field").set_file_name(format!("{address}-public-treasury.json")).add_filter("Public treasury JSON",&["json"]).blocking_save_file()else{return Ok(None)};
   let path=file.into_path().map_err(|_|"Select a local public export destination")?;
   if path.parent().is_none_or(|p|p.ancestors().any(|a|!a.symlink_metadata().is_ok_and(|m|m.is_dir()))){return Err("Public export ancestry contains a link".into())}
   let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
   let mut file=options.open(path).map_err(|_|"Public export exists or cannot be created; select a new file")?;file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"Public treasury export interrupted")?;Ok(Some(result))
  }).await.map_err(|_|"Public treasury export did not finish")?;
 }
 let reply=commands::controller(&app,target.clone(),read("treasury_preflight"),&control).await?;
 if reply["ok"]!=true{return Err("Coordinator refused authenticated treasury preflight".into())}let request=prepare_request(&reply["result"])?;
 let message=format!("ENGINEERING ORDINARY SINGLE-AUTHORITY TREASURY\nCoordinator: {}\nNetwork: {} / chain {}\nFormation: {}\nEffective time: {}\nExact request SHA-256: {}\n\nGenerate encrypted FN-DSA-1024 identity-root and ML-DSA-87 authorization custody once inside this coordinator's Synergy root. The public carrier enables the reviewed 5000000000000000 nWei Genesis test allocation. This is not a protected SynW account, spending approval or validator membership. Existing or uncertain custody must be reconciled, never regenerated.",target.label(),reply["result"]["network_id"],reply["result"]["chain_id"],request.parameters["formation_sha256"],request.parameters["effective_at_unix"],request.approval_id());
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review ordinary treasury custody creation").buttons(MessageDialogButtons::OkCancelCustom("Prepare encrypted ordinary treasury once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Treasury confirmation interrupted")?;
 if !consent{return Ok(None)}commands::exact_continuation(&app,&target,&request,&control,None).await?;
 let dispatch=request_journal::Dispatch::begin(&base,&target.journal_identity(),"treasury_prepare",&request.canonical())?;
 let result=commands::controller(&app,target,request,&control).await;dispatch.finish(&result)?;let reply=result?;
 if reply["ok"]!=true{return Err("Treasury preparation refused or uncertain; read status, never automatically retry".into())}status(&reply["result"]).map(Some)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn preflight_is_exact_and_no_renderer_keys_or_time_coercion(){let v=json!({"schema":"nodenetwork-formation-treasury-preflight-v1","network_id":"fresh-canary","chain_id":"99999","formation_sha256":"a".repeat(64),"effective_at_unix":100});let r=prepare_request(&v).unwrap();assert_eq!(r.parameters["effective_at_unix"],100);for changed in [json!({"secret":"forbidden"}),json!(true),json!(0)]{let mut bad=v.clone();bad["effective_at_unix"]=changed;assert!(prepare_request(&bad).is_err())}let mut bad=v;bad["path"]=json!("/private");assert!(prepare_request(&bad).is_err());}
 #[test]fn secret_fields_and_false_custody_receipts_refuse(){assert!(public_fields(&json!({"binding":{"private_key":"forbidden"}})).is_err());assert!(public_fields(&json!({"binding":{"proofs":{"identity_root":{"signature":"public"}}}})).is_ok());assert_eq!(status(&json!({"pending":false})).unwrap(),json!({"pending":false}));assert!(status(&json!({"pending":false,"custody":"hidden"})).is_err());}
 #[test]fn public_export_matches_exact_receipt_and_disclosure_firewall(){
  let carrier=json!({"schema_version":1,"signature_domain":"public-domain","binding":{"identity_address":"syna1public","identity_root":{"algorithm":"FN-DSA-1024"},"authorization_policy":{"policy_type":"single-key","threshold":1,"principals":[{"algorithm":"ML-DSA-87"}]},"authorization_scopes":[{"signature_domain":"public-domain","network_id":"fresh-canary","chain_id":99999,"purpose":"transaction-signing"}]}});
  let receipt=json!({"schema":"nodenetwork-formation-treasury-v1","pending":true,"address":"syna1public","network_id":"fresh-canary","chain_id":"99999","formation_sha256":"a".repeat(64),"request_sha256":"b".repeat(64),"effective_at_unix":100,"authorization_sha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&carrier).unwrap())),"possession_verified":true,"allocation_nwei":"5000000000000000"});
  let mut export=receipt.clone();export["schema"]=json!("nodenetwork-formation-treasury-export-v1");export["canary_testing_treasury"]=json!({"address":"syna1public","authorization":carrier});
  assert!(public_export(&export,&receipt).is_ok());
  for field in ["network_id","address","formation_sha256","request_sha256"]{let mut bad=export.clone();bad[field]=json!("changed");assert!(public_export(&bad,&receipt).is_err())}
  let mut bad=export.clone();bad["canary_testing_treasury"]["authorization"]["binding"]["authorization_scopes"][0]["network_id"]=json!("other");assert!(public_export(&bad,&receipt).is_err());
  let mut bad=export;bad["canary_testing_treasury"]["authorization"]["binding"]["unlock"]=json!("secret");assert!(public_export(&bad,&receipt).is_err());
 }

}
