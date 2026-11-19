//! Current installed-network observations. Public RPC results are not new trust roots.
use crate::{authorization_lifecycle,commands,node_bootstrap,node_controller::{self,Target}};
use serde_json::{json,Value};
use std::{path::Path,process::Stdio,time::Duration};
use tauri::Manager;
use tokio::io::{AsyncReadExt,AsyncWriteExt};
const HELPER:&str=include_str!("consensus_observation.py");
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));
fn exact(v:&Value,keys:&[&str])->bool{v.as_object().is_some_and(|o|o.len()==keys.len()&&keys.iter().all(|k|o.contains_key(*k)))}
fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}
fn number(v:&Value)->bool{v.as_u64().is_some_and(|n|n<1<<53)}
fn text(v:&Value)->bool{v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_graphic()))}
fn transaction_selector(v:&Value)->bool{
 exact(v,&["transaction_id","sender","receiver","height"])&&pin(&v["transaction_id"])&&number(&v["height"])&&v["height"]!=0&&["sender","receiver"].iter().all(|k|v[*k].as_str().is_some_and(|s|s.starts_with("syna1")&&(15..=128).contains(&s.len())&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit())))
}
fn transaction_evidence(e:&Value,selector:&Value,finalized:&Value)->Result<Value,String>{
 let fail=||"Unsupported same-block transaction observation".to_string();
 if !transaction_selector(selector)||!exact(e,&["schema","transaction","accounts"])||e["schema"]!="nodenetwork-transaction-observation-v1"{return Err(fail())}
 let t=&e["transaction"];let a=&e["accounts"];
 if t.is_null(){if !a.is_null(){return Err(fail())}}
 else{
  if !exact(t,&["transaction_id","block_height","block_hash","finality_certificate_id","status"])||t["transaction_id"]!=selector["transaction_id"]||t["block_height"]!=selector["height"]||t["block_height"].as_u64()>finalized.as_u64()||!pin(&t["block_hash"])||!pin(&t["finality_certificate_id"])||!matches!(t["status"].as_str(),Some("applied"|"reverted")){return Err(fail())}
  if t["status"]=="reverted"{if !a.is_null(){return Err(fail())}}
  else if !a.is_null(){
   if !exact(a,&["sender","receiver"]){return Err(fail())}
   for role in ["sender","receiver"]{let v=&a[role];if !exact(v,&["address","balance_nwei","nonce","finalized_height","finalized_block_hash","state_root"])||v["address"]!=selector[role]||v["balance_nwei"].as_str().is_none_or(|s|!s.parse::<u128>().is_ok_and(|n|n.to_string()==s))||!number(&v["nonce"])||v["finalized_height"]!=selector["height"]||v["finalized_block_hash"]!=t["block_hash"]||!pin(&v["state_root"]){return Err(fail())}}
   if a["sender"]["state_root"]!=a["receiver"]["state_root"]{return Err(fail())}
  }
 }
 Ok(json!({"kind":"transaction","selector":selector,"transaction":t,"accounts":a}))
}
fn query(operation:&str,value:&Value)->Result<(),String>{
 if operation=="transaction"&&transaction_selector(value)||matches!(operation,"telemetry")&&value.is_null()||matches!(operation,"finality"|"epoch")&&number(value)&&value.as_u64()!=Some(0){Ok(())}else{Err("Unsupported fixed consensus observation".into())}
}
fn project(v:&Value,context:&Value,operation:&str,selector:&Value)->Result<Value,String>{
 let fail=||"Unsupported current-network consensus observation".to_string();
 if !exact(v,&["schema","scope","operation","selector","telemetry","evidence"])||v["schema"]!="nodenetwork-consensus-observation-v1"||v["operation"]!=operation||v["selector"]!=*selector{return Err(fail())}
 let s=&v["scope"];let t=&v["telemetry"];
 if !exact(s,&["network_id","chain_id","genesis_hash","formation_sha256","manifest_sha256"])||s["network_id"]!=context["selection"]["network_id"]||s["chain_id"].as_str()!=context["selection"]["chain_id"].as_u64().map(|n|n.to_string()).as_deref()||s["formation_sha256"]!=context["formation_sha256"]||s["manifest_sha256"]!=context["selection"]["manifest_sha256"]||!pin(&s["genesis_hash"])||t["network_identity"]!=s["network_id"]||t["genesis_hash"]!=s["genesis_hash"]||t["chain_id"].as_u64().map(|n|n.to_string()).as_deref()!=s["chain_id"].as_str()||t["schema_version"]!=1||!number(&t["process_id"])||t["process_id"]==0||!number(&t["observed_at_unix_ms"])||!number(&t["finalized_height"])||!(t["epoch"].is_null()||number(&t["epoch"]))||!(t["epoch_context_root"].is_null()||pin(&t["epoch_context_root"])){return Err(fail())}
 let c=&t["common_finalized_commitment"];
 if !c.is_null()&&(!exact(c,&["height","block_id","state_root","finality_certificate_id","protected_execution_root"])||!number(&c["height"])||c["height"].as_u64()>t["finalized_height"].as_u64()||!["block_id","state_root","finality_certificate_id","protected_execution_root"].iter().all(|k|pin(&c[*k]))){return Err(fail())}
 let transport=&t["transport"];let peers=transport["peers"].as_array().ok_or_else(fail)?;
 if !exact(transport,&["authenticated_peer_count","apqe_session_count","peers","production_qualified"])||transport["production_qualified"]!=false||peers.len()>256||transport["authenticated_peer_count"].as_u64()!=Some(peers.len()as u64)||transport["apqe_session_count"].as_u64().is_none_or(|n|n>peers.len()as u64){return Err(fail())}
 let mut ids=std::collections::BTreeSet::new();
 for p in peers{if !exact(p,&["peer_id","session_id","profile","engineering_only"])||!text(&p["peer_id"])||!p["session_id"].is_u64()||!p["engineering_only"].is_boolean()||!(p["profile"].is_null()||p["profile"]=="PQ-VSESSION-01-candidate-v1")||!ids.insert(p["peer_id"].as_str().unwrap()){return Err(fail())}}
 let transport=json!({"authenticated_peer_count":peers.len(),"apqe_session_count":transport["apqe_session_count"],"production_qualified":false,"peers":peers.iter().map(|p|json!({"peer_id":p["peer_id"],"session_id":p["session_id"].as_u64().unwrap().to_string(),"profile":p["profile"],"engineering_only":p["engineering_only"]})).collect::<Vec<_>>()});
 let e=&v["evidence"];
 let evidence=if operation=="telemetry"{if !e.is_null(){return Err(fail())}Value::Null}else if operation=="transaction"{transaction_evidence(e,selector,&t["finalized_height"])?}else if e.is_null(){Value::Null}else if operation=="epoch"{
  if !exact(e,&["chain_id","network_id","epoch","epoch_context_root","kind","sha256","artifact_json"])||e["chain_id"]!=t["chain_id"]||e["network_id"]!=s["network_id"]||e["epoch"]!=*selector||!pin(&e["epoch_context_root"])||!pin(&e["sha256"])||!text(&e["kind"]){return Err(fail())}
  let raw=e["artifact_json"].as_str().ok_or_else(fail)?;use sha2::{Digest,Sha256};if raw.len()>4*1024*1024||format!("{:x}",Sha256::digest(raw.as_bytes()))!=e["sha256"]{return Err(fail())}
  json!({"kind":"epoch","selector":selector,"sha256":e["sha256"],"epoch_context_root":e["epoch_context_root"],"bytes":raw.len()})
 }else{
  if !exact(e,&["schema","height","sha256","bytes_base64","pages","verification"])||e["schema"]!="nodenetwork-finality-document-v1"||e["height"]!=*selector||!pin(&e["sha256"])||selector.as_u64()>t["finalized_height"].as_u64()||c.is_null()||c["height"]!=*selector{return Err(fail())}
  use base64::Engine;let raw=e["bytes_base64"].as_str().ok_or_else(fail)?;
  if raw.len()>1_398_104{return Err(fail())}
  let bytes=base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_|fail())?;
  if bytes.is_empty()||bytes.len()>1024*1024||base64::engine::general_purpose::STANDARD.encode(&bytes)!=raw||e["pages"].as_u64()!=Some(bytes.len().div_ceil(65536) as u64){return Err(fail())}
  use sha2::{Digest,Sha256};if format!("{:x}",Sha256::digest(&bytes))!=e["sha256"]{return Err(fail())}
  let verified=&e["verification"];
  if !exact(verified,&["version","verified","chain_id","network_id","genesis_hash","finalized"])||verified["version"]!=1||verified["verified"]!=true||verified["chain_id"]!=t["chain_id"]||verified["network_id"]!=s["network_id"]||verified["genesis_hash"]!=s["genesis_hash"]||!exact(&verified["finalized"],&["height","block_id","finality_certificate_id","protected_execution_root"])||["height","block_id","finality_certificate_id","protected_execution_root"].iter().any(|k|verified["finalized"][*k]!=c[*k]){return Err(fail())}
  json!({"kind":"finality","selector":selector,"sha256":e["sha256"],"bytes":bytes.len(),"complete":true,"certificate_verified":true})
 };
 Ok(json!({"schema":"nodenetwork-consensus-view-v1","scope":s,"process_id":t["process_id"],"observed_at_unix_ms":t["observed_at_unix_ms"],"epoch":t["epoch"],"epoch_context_root":t["epoch_context_root"],"finalized_height":t["finalized_height"],"commitment":c,"transport":transport,"evidence":evidence}))
}
async fn observe(target:&Target,operator:&str,control:&Path,known:Option<&Path>,context:&Value,operation:&str,value:&Value)->Result<Value,String>{
 let script=format!("__name__='consensus_observation'\n{BOOTSTRAP}\n{HELPER}\ntry:\n raw=sys.stdin.buffer.read(65537);require(len(raw)<=65536,'Input bound');result=consensus_observation(json.loads(raw));print(json.dumps(result,separators=(',',':')))\nexcept Exception:\n print('{{\"error\":\"consensus_observation_refused\"}}')\n");
 let encoded=node_bootstrap::bootstrap_script(&script)?;
 let quoted=format!("'{}'",encoded.replace('\'',"'\\''"));
 let remote=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {quoted}");
 let _serial=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;node_controller::close_connection_checked(target,control,operator).await?;
 let mut command=node_controller::remote_command(target,control,operator,&remote,known)?;
 command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=command.spawn().map_err(|_|"Consensus observation transport unavailable")?;
 let task=async{
  let mut input=child.stdin.take().ok_or("Observation input unavailable")?;input.write_all(&serde_json::to_vec(&json!({"context":context,"query":{"operation":operation,"value":value}})).map_err(|_|"Observation input invalid")?).await.map_err(|_|"Observation input interrupted")?;input.shutdown().await.map_err(|_|"Observation input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Observation output unavailable")?.take(6*1024*1024+1).read_to_end(&mut bytes).await.map_err(|_|"Observation output interrupted")?;
  if bytes.len()>6*1024*1024||!child.wait().await.map_err(|_|"Observation exit unavailable")?.success(){return Err("Bounded consensus observation unavailable".to_string())}
  let v:Value=serde_json::from_slice(&bytes).map_err(|_|"Consensus observation response invalid")?;project(&v,context,operation,value)
 };
 let result=tokio::time::timeout(Duration::from_secs(90),task).await.map_err(|_|"Consensus observation timed out".to_string()).and_then(|r|r);
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}
#[tauri::command]
pub async fn portal_nodenetwork_consensus(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operation:String,value:Value)->Result<Value,String>{
 commands::main_only(&window)?;target.validate()?;query(&operation,&value)?;
 if !cfg!(debug_assertions){return Err("Current-network observations require the approved engineering extension".into())}
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let base=app.path().app_local_data_dir().map_err(|_|"Portal state unavailable")?;
 let(operator,context,known,_)=authorization_lifecycle::update_context(&base,&target,&control).await?;
 observe(&target,&operator,&control,known.as_deref(),&context,&operation,&value).await
}
#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(Value,Value){let h="a".repeat(64);let s=json!({"network_id":"fresh","chain_id":"99999","genesis_hash":h,"formation_sha256":h,"manifest_sha256":h});let context=json!({"selection":{"network_id":"fresh","chain_id":99999,"manifest_sha256":h},"formation_sha256":h});let v=json!({"schema":"nodenetwork-consensus-observation-v1","scope":s,"operation":"telemetry","selector":null,"telemetry":{"schema_version":1,"network_identity":"fresh","chain_id":99999,"genesis_hash":h,"process_id":123,"observed_at_unix_ms":1795000000000u64,"finalized_height":0,"epoch":1,"epoch_context_root":h,"common_finalized_commitment":null,"transport":{"authenticated_peer_count":1,"apqe_session_count":1,"production_qualified":false,"peers":[{"peer_id":"validator02","session_id":u64::MAX,"profile":"PQ-VSESSION-01-candidate-v1","engineering_only":true}]}},"evidence":null});(v,context)}
 #[test]fn transaction_observation_is_same_block_public_only_and_null_is_not_absence(){
 let h="a".repeat(64);let q=json!({"transaction_id":h,"sender":"syna1publicsender","receiver":"syna1publicreceiver","height":1661});assert!(query("transaction",&q).is_ok());let e=json!({"schema":"nodenetwork-transaction-observation-v1","transaction":null,"accounts":null});assert!(transaction_evidence(&e,&q,&json!(1661)).unwrap()["transaction"].is_null());
 let mut e=e;e["transaction"]=json!({"transaction_id":h,"block_height":1661,"block_hash":h,"finality_certificate_id":h,"status":"applied"});e["accounts"]=json!({"sender":{"address":"syna1publicsender","balance_nwei":"4999998999160000","nonce":1,"finalized_height":1661,"finalized_block_hash":h,"state_root":h},"receiver":{"address":"syna1publicreceiver","balance_nwei":"1000000000","nonce":0,"finalized_height":1661,"finalized_block_hash":h,"state_root":h}});assert!(transaction_evidence(&e,&q,&json!(1661)).is_ok());
 let mut pruned=e.clone();pruned["accounts"]=Value::Null;assert!(transaction_evidence(&pruned,&q,&json!(2000)).is_ok());for accounts in [json!({}),json!({"sender":null,"receiver":e["accounts"]["receiver"]})]{let mut bad=e.clone();bad["accounts"]=accounts;assert!(transaction_evidence(&bad,&q,&json!(2000)).is_err())}
 for(role,key,val)in[("receiver","finalized_height",json!(1662)),("receiver","finalized_block_hash",json!("b".repeat(64))),("receiver","state_root",json!("b".repeat(64))),("sender","address",json!("syna1foreignsender")),("sender","balance_nwei",json!("01")),("sender","nonce",json!(9007199254740992u64)),("receiver","raw",json!("ciphertext"))]{let mut bad=e.clone();bad["accounts"][role][key]=val;assert!(transaction_evidence(&bad,&q,&json!(1661)).is_err(),"{key}")}
 for(key,val)in[("transaction_id",json!("b".repeat(64))),("block_height",json!(1662)),("status",json!("queued")),("raw",json!("ciphertext"))]{let mut bad=e.clone();bad["transaction"][key]=val;assert!(transaction_evidence(&bad,&q,&json!(1661)).is_err())}
 assert!(transaction_evidence(&e,&q,&json!(1660)).is_err());let mut bad=q.clone();bad["url"]=json!("http://foreign");assert!(query("transaction",&bad).is_err());e["transaction"]["status"]=json!("reverted");assert!(transaction_evidence(&e,&q,&json!(1661)).is_err());e["accounts"]=Value::Null;assert!(transaction_evidence(&e,&q,&json!(1661)).is_ok());
 }
 #[test]fn consensus_observation_projects_real_absence_and_rejects_foreign_identity(){let(v,c)=fixture();let view=project(&v,&c,"telemetry",&Value::Null).unwrap();assert_eq!(view["finalized_height"],0);assert!(view["commitment"].is_null());assert_eq!(view["transport"]["peers"][0]["session_id"],u64::MAX.to_string());assert!(view.get("quorum").is_none());for(key,bad)in[("genesis_hash",json!("b".repeat(64))),("network_identity",json!("foreign")),("chain_id",json!(1266)),("process_id",json!(0))]{let mut changed=v.clone();changed["telemetry"][key]=bad;assert!(project(&changed,&c,"telemetry",&Value::Null).is_err())}let mut changed=v;changed["scope"]["manifest_sha256"]=json!("b".repeat(64));assert!(project(&changed,&c,"telemetry",&Value::Null).is_err())}
 #[test]fn consensus_observation_has_no_arbitrary_rpc_or_unproven_evidence(){for(op,value)in[("submit",Value::Null),("epoch",json!(true)),("finality",json!(0)),("telemetry",json!({"url":"http://foreign"}))]{assert!(query(op,&value).is_err())}let(mut v,c)=fixture();v["evidence"]=json!({"verified":true});assert!(project(&v,&c,"telemetry",&Value::Null).is_err());v["evidence"]=Value::Null;v["telemetry"]["transport"]["authenticated_peer_count"]=json!(5);assert!(project(&v,&c,"telemetry",&Value::Null).is_err())}
 #[test]fn finality_projects_only_the_selected_commitment_and_checks_complete_document_digest(){
  use base64::Engine;use sha2::{Digest,Sha256};
  let(mut v,context)=fixture();let h="a".repeat(64);let bytes=b"public finality document";
  v["operation"]=json!("finality");v["selector"]=json!(100);v["telemetry"]["finalized_height"]=json!(112);
  v["telemetry"]["common_finalized_commitment"]=json!({"height":100,"block_id":h,"state_root":h,"finality_certificate_id":h,"protected_execution_root":h});
  v["evidence"]=json!({"schema":"nodenetwork-finality-document-v1","height":100,"bytes_base64":base64::engine::general_purpose::STANDARD.encode(bytes),"sha256":format!("{:x}",Sha256::digest(bytes)),"pages":1,"verification":{"version":1,"verified":true,"chain_id":99999,"network_id":"fresh","genesis_hash":h,"finalized":{"height":100,"block_id":h,"finality_certificate_id":h,"protected_execution_root":h}}});
  let result=project(&v,&context,"finality",&json!(100)).unwrap();assert_eq!(result["commitment"]["height"],100);assert_eq!(result["finalized_height"],112);assert_eq!(result["evidence"]["complete"],true);
  for height in [json!(112),Value::Null]{let mut bad=v.clone();bad["telemetry"]["common_finalized_commitment"]["height"]=height;assert!(project(&bad,&context,"finality",&json!(100)).is_err())}
  for(path,value)in[("/evidence/pages",json!(2)),("/evidence/verification/verified",json!(false)),("/evidence/verification/network_id",json!("foreign")),("/evidence/verification/genesis_hash",json!("b".repeat(64))),("/evidence/verification/finalized/height",json!(101)),("/evidence/verification/finalized/protected_execution_root",json!("b".repeat(64)))]{let mut bad=v.clone();*bad.pointer_mut(path).unwrap()=value;assert!(project(&bad,&context,"finality",&json!(100)).is_err(),"{path}")}
  let mut bad=v.clone();bad["telemetry"]["common_finalized_commitment"]=Value::Null;assert!(project(&bad,&context,"finality",&json!(100)).is_err());
  let mut bad=v;bad["evidence"]["sha256"]=json!(h);assert!(project(&bad,&context,"finality",&json!(100)).is_err());
 }
}
