//! Engineering ordinary test transfers. Quotes and one-use ciphertext stay native.
use crate::{commands,node_controller::{self,Request,Target},request_journal};
use serde_json::{json,Value};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
static QUOTE:Mutex<Option<(Value,Request)>>=Mutex::new(None);
fn exact(v:&Value,names:&[&str])->bool{v.as_object().is_some_and(|o|o.len()==names.len()&&names.iter().all(|n|o.contains_key(*n)))}
fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}
fn nonce(v:&Value)->bool{v.as_u64().is_some_and(|n|n<u64::MAX)}
fn decimal(v:&Value,positive:bool)->bool{v.as_str().is_some_and(|s|s.parse::<u128>().is_ok_and(|n|n.to_string()==s&&(!positive||n>0)))}
fn transfer(p:&Value)->bool{p["receiver"].as_str().is_some_and(|s|s.starts_with("syna1")&&(15..=128).contains(&s.len())&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()))&&decimal(&p["amount_nwei"],true)}
pub(super) fn validate(request:&Request)->Result<bool,String>{
 let p=&request.parameters;
 let valid=match request.operation.as_str(){
  "treasury_send_preflight"=>exact(p,&["receiver","amount_nwei"])&&transfer(p),
  "treasury_send_prepare"=>exact(p,&["formation_sha256","genesis_sha256","processing_context_json","processing_context_sha256","receiver","amount_nwei","nonce","observed_balance_nwei","timestamp_unix"])&&transfer(p)&&pin(&p["formation_sha256"])&&pin(&p["genesis_sha256"])&&pin(&p["processing_context_sha256"])&&nonce(&p["nonce"])&&decimal(&p["observed_balance_nwei"],false)&&p["timestamp_unix"].as_u64().is_some_and(|n|n>0&&n<1<<53)&&p["processing_context_json"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=1024*1024&&{use sha2::{Digest,Sha256};format!("{:x}",Sha256::digest(s.as_bytes()))==p["processing_context_sha256"].as_str().unwrap()}),
  "treasury_send_status"=>exact(p,&["nonce"])&&nonce(&p["nonce"]),
  "treasury_send_submit"=>exact(p,&["nonce","request_sha256"])&&nonce(&p["nonce"])&&pin(&p["request_sha256"]),
  _=>false,
 };if !valid{return Err("Invalid bounded ordinary treasury send request".into())}Ok(matches!(request.operation.as_str(),"treasury_send_prepare"|"treasury_send_submit"))
}
fn prepared(v:&Value)->Result<Value,String>{
 if !exact(v,&["schema","request_sha256","formation_sha256","genesis_sha256","transaction_id","receipt_id","admission_sha256","sender","receiver","amount_nwei","nonce","fee_nwei","state","automatic_retry"])||v["schema"]!="nodenetwork-formation-treasury-send-v1"||!["prepared","dispatch_unknown"].iter().any(|s|v["state"]==*s)||v["automatic_retry"]!=false||v["fee_nwei"]!="840000"||!transfer(v)||!nonce(&v["nonce"])||!["request_sha256","formation_sha256","genesis_sha256","transaction_id","admission_sha256"].iter().all(|n|pin(&v[*n]))||!v["receipt_id"].as_str().is_some_and(|s|s.len()==128&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))||!v["sender"].as_str().is_some_and(|s|s.starts_with("syna1")&&s.len()<=128){return Err("Unsupported ordinary treasury send receipt".into())}Ok(v.clone())
}
fn observed(v:&Value)->Result<Value,String>{
 if !exact(v,&["schema","prepared","finalized_observation","account_observations","automatic_retry"])||v["schema"]!="nodenetwork-treasury-send-status-v1"||v["automatic_retry"]!=false{return Err("Unsupported treasury send observation".into())}prepared(&v["prepared"])?;
 let f=&v["finalized_observation"];
 if !f.is_null()&&(!exact(f,&["transaction_id","block_height","block_hash","finality_certificate_id","status"])||f["transaction_id"]!=v["prepared"]["transaction_id"]||!pin(&f["block_hash"])||!f["block_height"].as_u64().is_some_and(|n|n>0)||!pin(&f["finality_certificate_id"])||!(f["status"]=="applied"||f["status"]=="reverted")){return Err("Malformed finalized treasury observation".into())}
 account_observations(&v["account_observations"],&v["prepared"],f)?;Ok(v.clone())
}
fn account_observations(a:&Value,p:&Value,f:&Value)->Result<(),String>{
 let invalid=||"Malformed same-block treasury account observations".to_string();
 if f.is_null()||f["status"]!="applied"{return if a.is_null(){Ok(())}else{Err(invalid())}}
 if !exact(a,&["schema","sender","receiver"])||a["schema"]!="nodenetwork-treasury-accounts-v1"{return Err(invalid())}
 for role in ["sender","receiver"]{let view=&a[role];
  if !exact(view,&["address","balance_nwei","nonce","finalized_height","finalized_block_hash","state_root"])||view["address"]!=p[role]||!decimal(&view["balance_nwei"],false)||!nonce(&view["nonce"])||view["finalized_height"]!=f["block_height"]||view["finalized_block_hash"]!=f["block_hash"]||!pin(&view["state_root"]){return Err(invalid())}
 }
 if a["sender"]["state_root"]!=a["receiver"]["state_root"]||a["sender"]["nonce"].as_u64().unwrap()<=p["nonce"].as_u64().unwrap(){return Err(invalid())}Ok(())
}
fn finalized_submit(v:&Value)->Result<Option<Request>,String>{
 observed(v)?;
 if v["finalized_observation"].is_null(){return Ok(None)}
 Ok(Some(Request{version:1,operation:"treasury_send_submit".into(),parameters:json!({"nonce":v["prepared"]["nonce"],"request_sha256":v["prepared"]["request_sha256"]})}))
}
fn quote(v:&Value)->Result<(Request,Value),String>{
 if !exact(v,&["schema","sender","network_id","chain_id","finalized_height","request","authority_coverage","fee_nwei"])||v["schema"]!="nodenetwork-treasury-send-preflight-v1"||!matches!(v["authority_coverage"].as_str(),Some("signed-formation-e1-only"|"signed-formation-autonomous-lineage-v1"))||v["fee_nwei"]!="840000"||!v["sender"].as_str().is_some_and(|s|s.starts_with("syna1")&&s.len()<=128)||!v["network_id"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128)||!v["chain_id"].as_str().is_some_and(|s|s.parse::<u64>().is_ok_and(|n|n>0&&n.to_string()==s))||!v["finalized_height"].as_u64().is_some_and(|n|n>0){return Err("Unsupported authenticated treasury quote".into())}
 let request:Request=serde_json::from_value(v["request"].clone()).map_err(|_|"Malformed immutable treasury intent")?;
 if request.operation!="treasury_send_prepare"{return Err("Wrong quote operation".into())}validate(&request)?;
 let p=&request.parameters;let summary=json!({"schema":"nodenetwork-native-treasury-quote-v1","quote_sha256":request.approval_id(),"sender":v["sender"],"network_id":v["network_id"],"chain_id":v["chain_id"],"finalized_height":v["finalized_height"],"receiver":p["receiver"],"amount_nwei":p["amount_nwei"],"nonce":p["nonce"],"observed_balance_nwei":p["observed_balance_nwei"],"fee_nwei":"840000","formation_sha256":p["formation_sha256"],"genesis_sha256":p["genesis_sha256"],"authority_coverage":v["authority_coverage"]});Ok((request,summary))
}
fn fresh_quote_at(request:&Request,now:u64)->Result<(),String>{
 if request.parameters["timestamp_unix"].as_u64().and_then(|t|now.checked_sub(t)).is_none_or(|age|age>=120){return Err("Treasury quote expired or clock differs. Read a fresh authenticated quote and review it promptly; no preparation was dispatched".into())}Ok(())
}
async fn reviewed_grant_at<T,F:std::future::Future<Output=Result<T,String>>>(request:&Request,prepare:bool,now:u64,grant:impl FnOnce()->F)->Result<T,String>{
 if prepare{fresh_quote_at(request,now)?;}grant().await
}
fn require_fresh_quote(request:&Request)->Result<(),String>{
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Treasury quote clock unavailable")?.as_secs();
 let result=fresh_quote_at(request,now);if result.is_err(){*QUOTE.lock().map_err(|_|"Treasury quote lock unavailable")?=None;}result
}
async fn call(app:&tauri::AppHandle,target:Target,request:Request,control:&std::path::Path)->Result<Value,String>{let reply=commands::controller(app,target,request,control).await?;if reply["version"]!=1||reply["ok"]!=true{return Err("Treasury controller refused; inspect the immutable intent before another action".into())}Ok(reply["result"].clone())}
#[tauri::command]
pub async fn portal_nodenetwork_treasury_send(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operation:String,parameters:Value)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;
 if !cfg!(debug_assertions){return Err("Ordinary test treasury sending requires the approved engineering app".into())}
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;let base=app.path().app_local_data_dir().map_err(|_|"Portal state unavailable")?;
 if operation=="verify_not_applied"{
  if !exact(&parameters,&["nonce"])||!nonce(&parameters["nonce"]){return Err("Enter the original bounded intent nonce".into())}
  let n=parameters["nonce"].as_u64().unwrap();let(_,review,_)=crate::authorization_lifecycle::treasury_phase_context(&base,&target,&control,n).await?;
  let message=format!("Verify original treasury preparation not applied\nTarget: {}\nOriginal request: {}\nDeclared nonce: {}\n\nProve the exact original grant is unconsumed and no reservation or preparation side effects exist. A verified negative result closes only this original uncertain journal entry as NOT APPLIED. It does not prepare, issue a grant, or submit; the unused grant is preserved. If it has not expired, wait for expiry before a fresh quote and separate confirmation.",target.label(),review["context"]["request_sha256"],n);
  let yes=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Verify treasury nonapplication only").buttons(MessageDialogButtons::OkCancel).blocking_show()).await.map_err(|_|"Treasury phase confirmation interrupted")?;if !yes{return Ok(None)}
  let _transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
  let(operator,current,pin)=crate::authorization_lifecycle::treasury_phase_context(&base,&target,&control,n).await?;
  if review["original"]!=current["original"]||["initial_sha256","authorization","formation_sha256","target","selection","genesis_pins","request_sha256","nonce"].iter().any(|k|review["context"][*k]!=current["context"][*k]){return Err("Original treasury scope changed; preserve uncertainty".into())}
  let ticket=crate::request_journal::treasury_not_applied_ticket(&base,&target.journal_identity())?;
  if ticket.original()!=&current["original"]{return Err("Original treasury record changed before proof".into())}
  let phase=crate::node_bootstrap::prove_treasury_not_applied(&target,&operator,&control,pin.as_deref(),&current).await?;
  if crate::request_journal::treasury_phase_original(&base,&target.journal_identity())?!=current["original"]{return Err("Original treasury journal changed during inspection".into())}
  crate::authorization_lifecycle::retire_treasury_prepare(&base,&target,&current,&phase,ticket)?;
  return Ok(Some(json!({"schema":"nodenetwork-native-treasury-not-applied-v1","record_id":current["original"]["id"],"request_sha256":phase["request_sha256"],"nonce":n,"not_applied":true,"prepared":false,"automatic_retry":false})))
 }
 if operation=="phase"{
  if !exact(&parameters,&["nonce"])||!nonce(&parameters["nonce"]){return Err("Enter the original bounded intent nonce".into())}
  let n=parameters["nonce"].as_u64().unwrap();let(_,review,_)=crate::authorization_lifecycle::treasury_phase_context(&base,&target,&control,n).await?;
  let message=format!("Read-only treasury phase inspection\nTarget: {}\nOriginal request: {}\nDeclared nonce: {}\n\nInspect only the original grant/audit and fixed reservation file hashes. This cannot establish preparation success or nonapplication, clear uncertainty, issue a grant, or retry a transfer.",target.label(),review["context"]["request_sha256"],n);
  let yes=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Inspect original treasury phase only").buttons(MessageDialogButtons::OkCancel).blocking_show()).await.map_err(|_|"Treasury phase confirmation interrupted")?;if !yes{return Ok(None)}
  let _transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
  let(operator,current,pin)=crate::authorization_lifecycle::treasury_phase_context(&base,&target,&control,n).await?;
  if review["original"]!=current["original"]||["initial_sha256","authorization","formation_sha256","target","selection","genesis_pins","request_sha256","nonce"].iter().any(|k|review["context"][*k]!=current["context"][*k]){return Err("Original treasury scope changed; preserve uncertainty".into())}
  let mut phase=crate::node_bootstrap::inspect_treasury_phase(&target,&operator,&control,pin.as_deref(),&current).await?;
  if crate::request_journal::treasury_phase_original(&base,&target.journal_identity())?!=current["original"]{return Err("Original treasury journal changed during inspection".into())}
  phase.as_object_mut().unwrap().remove("challenge");return Ok(Some(phase))
 }
 if operation=="quote"{
  let request=Request{version:1,operation:"treasury_send_preflight".into(),parameters};validate(&request)?;
  let (request,summary)=quote(&call(&app,target.clone(),request,&control).await?)?;
  *QUOTE.lock().map_err(|_|"Treasury quote lock unavailable")?=Some((target.journal_identity(),request));return Ok(Some(summary))
 }
 if operation=="status"{
  let request=Request{version:1,operation:"treasury_send_status".into(),parameters};validate(&request)?;
  let value=observed(&call(&app,target.clone(),request,&control).await?)?;
  request_journal::reconcile_verified(&base,&target.journal_identity(),"treasury_send_prepare",value["prepared"]["request_sha256"].as_str().unwrap())?;
  if let Some(submit)=finalized_submit(&value)?{request_journal::reconcile_verified(&base,&target.journal_identity(),"treasury_send_submit",&submit.approval_id())?;}
  return Ok(Some(value))
 }
 let (request,review)=if operation=="prepare"{
  if !exact(&parameters,&["quote_sha256"])||!pin(&parameters["quote_sha256"]){return Err("Review the exact native quote".into())}
  let guard=QUOTE.lock().map_err(|_|"Treasury quote lock unavailable")?;let (identity,request)=guard.as_ref().ok_or("Read a fresh native treasury quote first")?;
  if *identity!=target.journal_identity()||request.approval_id()!=parameters["quote_sha256"]{return Err("Treasury quote belongs to another target or intent".into())}
  let request=Request{version:request.version,operation:request.operation.clone(),parameters:request.parameters.clone()};let review=request.parameters.clone();(request,review)
 }else if operation=="submit"{
  let request=Request{version:1,operation:"treasury_send_status".into(),parameters};validate(&request)?;
  let status=observed(&call(&app,target.clone(),request,&control).await?)?;let review=status["prepared"].clone();if review["state"]!="prepared"||!status["finalized_observation"].is_null(){return Err("This intent is already dispatched or finalized; automatic resubmission is forbidden".into())}
  (Request{version:1,operation:"treasury_send_submit".into(),parameters:json!({"nonce":review["nonce"],"request_sha256":review["request_sha256"]})},review)
 }else{return Err("Unsupported treasury send operation".into())};
 if operation=="prepare"{require_fresh_quote(&request)?;}
 let message=format!("NON-INCENTIVIZED ENGINEERING ORDINARY TEST TRANSFER\nTarget: {}\nRecipient: {}\nAmount: {} nWei\nFee: 840000 nWei\nNonce: {}\nExact request: {}\n\n{}\nThis is an ordinary syna transfer, not a protected SynW action. Keys stay in coordinator custody. No automatic retry or duplicate submission is permitted. Balance/nonce are finalized local RPC observations; keytool authenticates the exact signed formation and, when needed, autonomous epoch lineage and registry independently.",target.label(),review["receiver"],review["amount_nwei"],review["nonce"],request.approval_id(),if operation=="prepare"{"Prepare and encrypt this exact immutable intent. This does not broadcast."}else{"Consume the one-use encrypted dispatch now. A lost reply remains uncertain; reconcile by immutable transaction ID."});
 let title=if operation=="prepare"{"Review encrypted treasury preparation"}else{"Review one-use test transfer dispatch"};
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title(title).buttons(MessageDialogButtons::OkCancel).blocking_show()).await.map_err(|_|"Treasury confirmation interrupted")?;if !consent{return Ok(None)}
 let transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
 request_journal::require_resumable_scope(&base,&target.journal_identity())?;
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Treasury quote clock unavailable")?.as_secs();
 let granted=reviewed_grant_at(&request,operation=="prepare",now,||crate::authorization_lifecycle::grant_locked(&base,&target,&request,&control,None,&transaction)).await;
 if granted.is_err()&&operation=="prepare"&&fresh_quote_at(&request,now).is_err(){*QUOTE.lock().map_err(|_|"Treasury quote lock unavailable")?=None;}granted?;
 // Once authorization succeeds, always retain normal dispatch evidence. Core rechecks
 // quote expiry before consuming the grant; a slow grant exchange stays recoverable.
 let dispatch=request_journal::Dispatch::begin(&base,&target.journal_identity(),&request.operation,&request.canonical())?;
 let result=call(&app,target,request,&control).await.and_then(|v|if operation=="prepare"{prepared(&v)}else{observed(&v)});
 let journal=result.as_ref().map(|v|json!({"version":1,"ok":true,"result":v})).map_err(Clone::clone);dispatch.finish(&journal)?;
 if operation=="prepare"{*QUOTE.lock().map_err(|_|"Treasury quote lock unavailable")?=None;}
 result.map(Some)
}
#[cfg(test)]mod tests{use super::*;
 #[tokio::test]async fn treasury_quote_pregrant_expiry_never_authorizes_but_slow_grant_returns_to_dispatch(){
 let r=Request{version:1,operation:"treasury_send_prepare".into(),parameters:json!({"timestamp_unix":1000})};let calls=std::cell::Cell::new(0);
 assert!(reviewed_grant_at(&r,true,1120,||{calls.set(calls.get()+1);std::future::ready(Ok(()))}).await.is_err());assert_eq!(calls.get(),0);
 // The grant may finish after the quote's TTL. There is no post-grant abort:
 // caller must journal/dispatch and let Core's preauthorize guard reject safely.
 assert_eq!(reviewed_grant_at(&r,true,1119,||{calls.set(calls.get()+1);std::future::ready(Ok(1300u64))}).await.unwrap(),1300);assert_eq!(calls.get(),1);
 }
 #[test]fn treasury_quote_expires_before_authorization_or_dispatch_and_rejects_future_time(){
 let r=Request{version:1,operation:"treasury_send_prepare".into(),parameters:json!({"timestamp_unix":1000})};assert!(fresh_quote_at(&r,1000).is_ok());assert!(fresh_quote_at(&r,1119).is_ok());for now in [999,1120,1300]{assert!(fresh_quote_at(&r,now).unwrap_err().contains("no preparation was dispatched"))}
 }
 #[test]fn exact_send_parameters_never_accept_url_keys_or_nonce_coercion(){let r=Request{version:1,operation:"treasury_send_submit".into(),parameters:json!({"nonce":0,"request_sha256":"a".repeat(64)})};assert!(validate(&r).unwrap());for bad in [json!({"nonce":"0","request_sha256":"a".repeat(64)}),json!({"nonce":0,"request_sha256":"a".repeat(64),"url":"http://foreign"}),json!({"nonce":u64::MAX,"request_sha256":"a".repeat(64)})]{assert!(validate(&Request{version:1,operation:r.operation.clone(),parameters:bad}).is_err())}}
 #[test]fn submit_reconciles_only_exact_finalized_transaction_not_queued(){
 let prepared=json!({"schema":"nodenetwork-formation-treasury-send-v1","request_sha256":"a".repeat(64),"formation_sha256":"b".repeat(64),"genesis_sha256":"c".repeat(64),"transaction_id":"d".repeat(64),"receipt_id":"e".repeat(128),"admission_sha256":"f".repeat(64),"sender":"syna1publicsender","receiver":"syna1publicreceiver","amount_nwei":"1","nonce":3,"fee_nwei":"840000","state":"dispatch_unknown","automatic_retry":false});
 let mut v=json!({"schema":"nodenetwork-treasury-send-status-v1","prepared":prepared,"finalized_observation":null,"account_observations":null,"automatic_retry":false});assert!(finalized_submit(&v).unwrap().is_none());
 v["finalized_observation"]=json!({"transaction_id":"d".repeat(64),"block_height":6,"block_hash":"1".repeat(64),"finality_certificate_id":"2".repeat(64),"status":"applied"});v["account_observations"]=json!({"schema":"nodenetwork-treasury-accounts-v1","sender":{"address":"syna1publicsender","balance_nwei":"100","nonce":4,"finalized_height":6,"finalized_block_hash":"1".repeat(64),"state_root":"3".repeat(64)},"receiver":{"address":"syna1publicreceiver","balance_nwei":"1","nonce":0,"finalized_height":6,"finalized_block_hash":"1".repeat(64),"state_root":"3".repeat(64)}});let request=finalized_submit(&v).unwrap().unwrap();assert_eq!(request.parameters,json!({"nonce":3,"request_sha256":"a".repeat(64)}));
 for(role,field,value)in[("receiver","finalized_height",json!(7)),("receiver","finalized_block_hash",json!("9".repeat(64))),("receiver","state_root",json!("9".repeat(64))),("sender","nonce",json!(3)),("sender","nonce",json!("4")),("receiver","balance_nwei",json!("01"))]{let mut bad=v.clone();bad["account_observations"][role][field]=value;assert!(finalized_submit(&bad).is_err())}
 for(field,value)in[("transaction_id",json!("0".repeat(64))),("status",json!("queued")),("finality_certificate_id",json!("invalid"))]{let mut bad=v.clone();bad["finalized_observation"][field]=value;assert!(finalized_submit(&bad).is_err())}
 }
 #[test]fn autonomous_quote_retains_exact_intent_and_only_native_coverage(){
 let text="{}";use sha2::{Digest,Sha256};
 let request=json!({"version":1,"operation":"treasury_send_prepare","parameters":{"formation_sha256":"a".repeat(64),"genesis_sha256":"b".repeat(64),"processing_context_json":text,"processing_context_sha256":format!("{:x}",Sha256::digest(text.as_bytes())),"receiver":"syna1publicreceiver","amount_nwei":"1","nonce":0,"observed_balance_nwei":"5000000000000000","timestamp_unix":1700000000}});
 let mut v=json!({"schema":"nodenetwork-treasury-send-preflight-v1","sender":"syna1publicsender","network_id":"fresh","chain_id":"99999","finalized_height":1003,"request":request,"authority_coverage":"signed-formation-autonomous-lineage-v1","fee_nwei":"840000"});
 let (r,summary)=quote(&v).unwrap();assert_eq!(json!({"version":r.version,"operation":r.operation,"parameters":r.parameters}),request);assert_eq!(summary["authority_coverage"],v["authority_coverage"]);
 v["authority_coverage"]=json!("caller-approved");assert!(quote(&v).is_err());
 }
 #[test]fn malformed_or_secret_status_never_closes_journal(){assert!(observed(&json!({"schema":"nodenetwork-treasury-send-status-v1","prepared":{},"finalized_observation":null,"account_observations":null,"automatic_retry":false})).is_err());let mut v=json!({"schema":"nodenetwork-formation-treasury-send-v1","request_sha256":"a".repeat(64),"formation_sha256":"b".repeat(64),"genesis_sha256":"c".repeat(64),"transaction_id":"d".repeat(64),"receipt_id":"e".repeat(128),"admission_sha256":"f".repeat(64),"sender":"syna1publicsender","receiver":"syna1publicreceiver","amount_nwei":"1","nonce":0,"fee_nwei":"840000","state":"dispatch_unknown","automatic_retry":false});assert!(prepared(&v).is_ok());v["admission"]=json!({});assert!(prepared(&v).is_err())}
}
