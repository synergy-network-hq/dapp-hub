//! Native-only, point-in-time commissioning observations. No consensus authority.
use crate::{commands,node_controller::{self,Target,Request},operator_authorization as authorization};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeSet,sync::{Mutex,OnceLock},time::{SystemTime,UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
const LIMIT:usize=128*1024;
const PUBLIC:[&str;6]=["genesis.json","authority.json","authority-root.pub","network-manifest.json","transport-registry.json","transport-root.pub"];
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}
fn exact(v:&Value,keys:&[&str])->bool{v.as_object().is_some_and(|o|o.len()==keys.len()&&keys.iter().all(|k|o.contains_key(*k)))}
fn pins(v:&Value,keys:&[&str])->bool{exact(v,keys)&&v.as_object().unwrap().values().all(pin)}
fn now()->Result<u64,String>{SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_secs()).map_err(|_|"Clock unavailable".into())}
fn token(v:&Value)->bool{v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=256&&s.is_ascii()&&!s.bytes().any(|b|b.is_ascii_control()))}
fn ip(v:&Value)->bool{v.as_str().is_some_and(|s|s.parse::<std::net::IpAddr>().is_ok_and(|ip|!ip.is_unspecified()&&!ip.is_multicast()))}
fn key(v:&Value)->bool{
 use base64::Engine;v.as_str().is_some_and(|s|base64::engine::general_purpose::STANDARD.decode(s).is_ok_and(|b|b.len()==32&&base64::engine::general_purpose::STANDARD.encode(b)==s))
}
fn validate_snapshot(values:&[Value],scopes:&[Value],at:u64,scope_only:bool)->Result<Value,String>{
 if !(4..=5).contains(&values.len())||scopes.len()!=values.len()||scopes.iter().map(Value::to_string).collect::<BTreeSet<_>>().len()!=values.len(){return Err("Select four or five independently targeted controllers; signed-roster quorum is checked separately".into())}
 let fields=["schema","observed_at_unix","target","manifest_sha256","provider_report_sha256","vpn_provider_sha256","network_id","chain_id","formation_sha256","address","enrollment_sha256","public_file_sha256","commissioning_file_sha256","validator_addresses","registry_peer_ips","vpn_binding","peers","online_addresses","frozen_voting_weights","observation_kind"];
 let mut addresses=BTreeSet::new();let mut ips=BTreeSet::new();let mut keys=BTreeSet::new();let mut peer_ids=BTreeSet::new();let mut enrollments=BTreeSet::new();
 for (v,scope) in values.iter().zip(scopes){
  if !exact(v,&fields)||v["schema"]!="nodenetwork-commissioning-observation-v2"||&v["target"]!=scope||!v["observed_at_unix"].as_u64().is_some_and(|time|time<=at.saturating_add(30)&&at.saturating_sub(time)<=300){return Err("Controller observation scope or freshness differs".into())}
  for field in ["manifest_sha256","provider_report_sha256","vpn_provider_sha256","formation_sha256","enrollment_sha256"]{if !pin(&v[field]){return Err("Incomplete authenticated commissioning commitments".into())}}
  if !token(&v["network_id"])||!v["chain_id"].as_str().is_some_and(|s|s.parse::<u64>().is_ok_and(|n|n>0&&n.to_string()==s))||!token(&v["address"])||!addresses.insert(v["address"].as_str().unwrap().to_string())||!pins(&v["public_file_sha256"],&PUBLIC)||!pins(&v["commissioning_file_sha256"],&crate::transport_formation::ARTIFACTS){return Err("Malformed or duplicate public validator identity".into())}
  for name in PUBLIC{if v["public_file_sha256"][name]!=v["commissioning_file_sha256"][format!("network/{name}")]{return Err("Commissioning artifact differs from authenticated public network".into())}}
  let b=&v["vpn_binding"];
  if !exact(b,&["account_id","peer_id","ip","wireguard_public_key","enrollment_sha256","server_binding_sha256"])||!token(&b["account_id"])||!token(&b["peer_id"])||!ip(&b["ip"])||!key(&b["wireguard_public_key"])||!pin(&b["enrollment_sha256"])||!enrollments.insert(v["enrollment_sha256"].to_string())||!pin(&b["server_binding_sha256"])||!ips.insert(b["ip"].to_string())||!keys.insert(b["wireguard_public_key"].to_string())||!peer_ids.insert(b["peer_id"].to_string()){return Err("VPN identity is absent, malformed or shared between validators".into())}
  for field in ["manifest_sha256","provider_report_sha256","vpn_provider_sha256","network_id","chain_id","formation_sha256","public_file_sha256","validator_addresses","registry_peer_ips","frozen_voting_weights"]{if v[field]!=values[0][field]{return Err("Fleet has mixed authenticated network, release, provider or roster".into())}}
  if b["account_id"]!=values[0]["vpn_binding"]["account_id"]{return Err("Fleet VPN provider accounts differ".into())}
 }
 let roster=values[0]["validator_addresses"].as_array().filter(|a|a.len()==5&&a.iter().all(token)).ok_or("Exactly five signed registry identities required")?;
 let roster_set=roster.iter().filter_map(Value::as_str).map(str::to_string).collect::<BTreeSet<_>>();
 if roster_set.len()!=5||roster.iter().filter_map(Value::as_str).collect::<Vec<_>>()!=roster_set.iter().map(String::as_str).collect::<Vec<_>>()||!addresses.is_subset(&roster_set){return Err("Observed identities differ from the canonical signed roster".into())}
 let weights=values[0]["frozen_voting_weights"].as_object().filter(|m|m.keys().cloned().collect::<BTreeSet<_>>()==roster_set).ok_or("Exact full signed-roster voting weights required")?;
 let(mut total,mut selected)=(0u128,0u128);
 for(address,value)in weights{let raw=value.as_str().ok_or("Canonical signed voting weight required")?;let weight=raw.parse::<u128>().ok().filter(|w|*w>0&&w.to_string()==raw).ok_or("Canonical positive signed voting weight required")?;
  total=total.checked_add(weight).ok_or("Signed voting weight overflow")?;if addresses.contains(address){selected=selected.checked_add(weight).ok_or("Selected voting weight overflow")?;}
 }
 // Match the production verifier's checked strict dual >2/3 rule, including overflow refusal.
 if addresses.len()*3<=roster_set.len()*2||selected.checked_mul(3).zip(total.checked_mul(2)).is_none_or(|(yes,all)|yes<=all){return Err("Selected controllers do not satisfy strict signed-roster count and voting-weight quorum".into())}
 let online=if scope_only{json!([])}else{json!(addresses)};
 for v in values{if v["online_addresses"]!=online||v["observation_kind"]!=if scope_only{"metadata_only"}else{"prestart_vpn"}{return Err("Controllers did not observe the exact selected online subset".into())}}
 let registry=&values[0]["registry_peer_ips"];if !registry.as_object().is_some_and(|m|m.len()==5&&m.keys().cloned().collect::<BTreeSet<_>>()==roster_set&&m.values().all(ip)){return Err("Registry endpoints do not bind the exact five validators".into())}
 for v in values{
  let own=v["address"].as_str().unwrap();if registry[own]!=v["vpn_binding"]["ip"]{return Err("Controller VPN IP differs from its signed registry endpoint".into())}
  let peers=v["peers"].as_object().filter(|p|p.len()==if scope_only{0}else{values.len()-1}).ok_or("Exact directed peer observations required on each selected controller")?;
  if scope_only{continue;}
  for other in values.iter().filter(|o|o["address"]!=v["address"]){let address=other["address"].as_str().unwrap();let p=peers.get(address).ok_or("Missing directed VPN peer observation")?;
   if !exact(p,&["ip","wireguard_public_key","interface","reachable"])||p["interface"]!="wt0"||p["reachable"]!=true||p["ip"]!=other["vpn_binding"]["ip"]||p["wireguard_public_key"]!=other["vpn_binding"]["wireguard_public_key"]{return Err("Directed VPN probe or cross-observed peer identity is unverified".into())}
  }
 }
 let mut sorted=values.to_vec();sorted.sort_by(|a,b|a["address"].as_str().cmp(&b["address"].as_str()));let artifact=json!({"schema":"nodenetwork-commissioning-readiness-v2","online_addresses":addresses,"excluded_addresses":roster_set.difference(&addresses).collect::<Vec<_>>(),"observations":sorted});
 let bytes=artifact.to_string();if bytes.len()>LIMIT||!bytes.is_ascii(){return Err("Public readiness artifact exceeds canonical ASCII bound".into())}Ok(artifact)
}
fn validate(values:&[Value],scopes:&[Value],at:u64)->Result<Value,String>{validate_snapshot(values,scopes,at,false)}
fn current_scope(observation:&Value,status:&Value)->bool{
 observation["manifest_sha256"]==status["selection"]["manifest_sha256"]&&observation["formation_sha256"]==status["formation_sha256"]&&observation["network_id"]==status["selection"]["network_id"]&&observation["chain_id"].as_str().and_then(|s|s.parse::<u64>().ok())==status["selection"]["chain_id"].as_u64()&&status["selection"]["chain_id"].as_u64().is_some()
}
fn collection_refusal(target:&Target,phase:&str,reply:Option<&Value>)->String{
 let phase=match phase{"authorization"=>"authorization read",_=>"commissioning observation"};
 let code=reply.and_then(|v|v["error"]["code"].as_str()).filter(|c|matches!(*c,"authorization_required"|"invalid_request"|"operation_refused"|"qualification_required"|"reconciliation_required"|"unsupported_target"|"vpn_readiness_required"|"vpn_reconciliation_required")).unwrap_or("observation_unavailable");
 let reason=reply.and_then(|v|v["error"]["message"].as_str()).filter(|m|matches!(*m,
 "Current native VPN must match the recorded, independently server-bound validator peer"|
 "Commissioning observations require a stopped uncommissioned validator"|
 "Existing local custody must be bound to authenticated Genesis"|
 "Exact approved public commissioning inputs required"|
 "Exact immutable public commissioning approval required"|
 "Partial commissioning must reconcile before observation"|
 "Original public commissioning approval changed"|
 "Installed public commissioning input changed"|
 "Installed readiness provenance absent"|
 "Installed commissioning policy changed after readiness"|
 "Installed APQE custody possession differs from selected network"|
 "Installed network selection differs"|"Five signed transport members required"|
 "Signed transport roster differs"|"Distinct signed VPN endpoints required"|
 "Signed transport enrollment differs from local custody"|"Current VPN binding required"|
 "Live VPN identity differs from signed endpoint"|"Independent VPN provider approval required"|
 "Bounded native VPN peer inventory required"|"Exact connected VPN peer identity required"|
 "Peer route must use wt0"|"Controller validation or lifecycle operation failed"));
 let base=format!("Fleet {phase} refused for {} ({code}). No readiness was collected.",target.label());
 match reason{Some(reason)if base.len()+reason.len()+1<=512=>format!("{base} {reason}"),_=>base}
}
#[derive(Clone)]struct Collected{targets:Vec<Target>,scopes:Vec<Value>,observations:Vec<Value>,sha256:String}
static CURRENT:OnceLock<Mutex<Option<Collected>>>=OnceLock::new();
fn cache()->&'static Mutex<Option<Collected>>{CURRENT.get_or_init(||Mutex::new(None))}
fn summary(c:&Collected,artifact:&Value)->Value{json!({"schema":"nodenetwork-native-fleet-readiness-v2","review_sha256":c.sha256,"observations":artifact["observations"],"online_addresses":artifact["online_addresses"],"excluded_addresses":artifact["excluded_addresses"],"scope":"commissioning_and_prestart_vpn_only","runtime_participation_verified":false,"finality_verified":false})}
#[tauri::command]
pub async fn portal_nodenetwork_fleet_readiness(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operation:String,targets:Option<Vec<Target>>,review_sha256:Option<String>)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;if !cfg!(debug_assertions){return Err("Fleet commissioning observation approval is engineering-only".into())}
 let base=app.path().app_local_data_dir().map_err(|_|"App state unavailable")?;let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 if operation=="verify_commission_not_applied"{
  if targets.is_some()||review_sha256.is_some(){return Err("Commission proof accepts no renderer request or artifact".into())}
  let(_,review,_,_)=crate::authorization_lifecycle::commission_recovery(&base,&target,&control).await?;
  let message=format!("ISOLATED ENGINEERING ONLY\nTarget: {}\nOriginal commission record: {}\nExact request: {}\nCurrent authorization: {}\n\nVerify only that this original commission was NOT applied. The pinned read-only proof must establish the original unused grant, no commission audit or published/partial state, unchanged signed inputs and custody, and a stopped validator. Native reconciliation also binds the prior successful readiness stage and original authorization encoding. Applied, partial or unknown outcomes remain fenced. If proven, retain a public receipt and mark this exact local outcome false. No authorization is issued, no operation is retried and no service starts. Fresh readiness and a separate commission confirmation are required later.",target.label(),review["original"]["id"],review["context"]["request_sha256"],review["context"]["authorization"]["sha256"]);
  let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Verify original commission not applied").buttons(MessageDialogButtons::OkCancelCustom("Verify nonapplication only".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Commission nonapplication review interrupted")?;if !consent{return Ok(None)}
  let _transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
  let(operator,current,pin,ticket)=crate::authorization_lifecycle::commission_recovery(&base,&target,&control).await?;
  for key in ["initial_sha256","authorization","formation_sha256","target","selection","genesis_pins","request_sha256"]{if current["context"][key]!=review["context"][key]{return Err("Commission scope changed during review; original outcome remains fenced".into())}}
  if current["original"]!=review["original"]||current["document_template"]!=review["document_template"]{return Err("Original commission dispatch changed during review".into())}
  let proof=crate::node_bootstrap::prove_commission_not_applied(&target,&operator,&control,pin.as_deref(),&current).await?;
  crate::authorization_lifecycle::retire_commission(&base,&target,&current,&proof,ticket)?;
  return Ok(Some(json!({"schema":"nodenetwork-native-commission-not-applied-v1","not_applied":true,"commissioned":false,"record_id":current["original"]["id"],"request_sha256":current["context"]["request_sha256"],"readiness_sha256":proof["readiness_sha256"],"automatic_retry":false})))
 }
 if operation=="verify_not_applied"{
  if targets.is_some()||review_sha256.is_some(){return Err("Nonapplication review accepts no renderer artifact".into())}
  let(_,review,_,_)=crate::authorization_lifecycle::readiness_recovery(&base,&target,&control).await?;
  let message=format!("ISOLATED ENGINEERING ONLY\nTarget: {}\nOriginal readiness authorization: {}\nOriginal dispatch: {}\n\nRead-only verification must prove that this exact original readiness authorization was NOT applied, its predecessor and signed public inputs remain unchanged, and no commissioning grant, audit, artifact or partial exchange exists. If proven, preserve the original public document in a nonapplication receipt and mark only its local journal outcome false. No grant is issued, no readiness is restaged and no validator starts. A fresh collection and separate confirmation are required for any future staging.",target.label(),review["context"]["pending_sha256"],review["context"]["dispatch_sha256"]);
  let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Verify readiness stage not applied").buttons(MessageDialogButtons::OkCancelCustom("Verify nonapplication only".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Readiness nonapplication review interrupted")?;if !consent{return Ok(None)}
  let _transaction=crate::authorization_lifecycle::continuation_lock(&base,&target)?;
  let(operator,current,pin,ticket)=crate::authorization_lifecycle::readiness_recovery(&base,&target,&control).await?;
  for key in ["initial_sha256","authorization","formation_sha256","target","selection","genesis_pins","pending_sha256","artifact_sha256","dispatch_sha256"]{if current["context"][key]!=review["context"][key]{return Err("Readiness scope changed during nonapplication review".into())}}
  if current["intent"]!=review["intent"]||current["pending_json"]!=review["pending_json"]{return Err("Original readiness intent changed during review".into())}
  let proof=crate::node_bootstrap::prove_readiness_not_applied(&target,&operator,&control,pin.as_deref(),&current).await?;
  crate::authorization_lifecycle::retire_readiness(&base,&target,&current,&proof,ticket)?;
  return Ok(Some(json!({"schema":"nodenetwork-native-readiness-not-applied-v1","not_applied":true,"readiness_staged":false,"dispatch_sha256":current["context"]["dispatch_sha256"],"authorization_sha256":current["context"]["pending_sha256"],"automatic_retry":false})))
 }
 if operation=="reconcile"{
  if targets.is_some()||review_sha256.is_some(){return Err("Reconciliation accepts no renderer artifact or review".into())}
  let old=crate::authorization_lifecycle::reconcile_readiness(&base,&target,&control).await?;
  return Ok(Some(json!({"schema":"nodenetwork-native-fleet-readiness-reconciled-v1","pending":false,"original_stage_verified":old.is_some(),"review_sha256":old.as_ref().map(|v|v["artifact_sha256"].clone()),"freshness_verified":false,"commissioned":false})))
 }
 if operation=="collect"{
  if review_sha256.is_some(){return Err("Collection cannot adopt a renderer review".into())}
  let targets=targets.filter(|v|(4..=5).contains(&v.len())).ok_or("Select four or five enrolled controllers; native signed-roster quorum remains required")?;let journals=targets.iter().map(Target::journal_identity).collect::<Vec<_>>();
  if journals.iter().map(Value::to_string).collect::<BTreeSet<_>>().len()!=targets.len()||!journals.contains(&target.journal_identity()){return Err("Select a unique fleet containing the commissioning target".into())}
  let mut observations=Vec::new();let mut scopes=Vec::new();
  let mut parameters=json!({"online_addresses":[]});
  for pass in 0..2{
  observations.clear();scopes.clear();
  for t in &targets{
   t.validate()?;let raw=crate::authorization_lifecycle::bare_initial(&base,t)?.ok_or("Controller lacks its independently approved original native authorization receipt")?;let doc=authorization::verify_initial(&raw,t)?;
   let status=commands::controller(&app,t.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},&control).await.map_err(|_|collection_refusal(t,"authorization",None))?;
   if status["ok"]!=true{return Err(collection_refusal(t,"authorization",Some(&status)))}
   if status["result"]["initial_sha256"]!=hash(raw.as_bytes())||status["result"]["target"]!=doc["target"]{return Err("Controller authorization does not match the original independently pinned target".into())}
   let reply=commands::controller(&app,t.clone(),Request{version:1,operation:"commissioning_observation".into(),parameters:parameters.clone()},&control).await.map_err(|_|collection_refusal(t,"observation",None))?;
   if reply["ok"]!=true{return Err(collection_refusal(t,"observation",Some(&reply)))}
   if !current_scope(&reply["result"],&status["result"]){return Err(format!("Fleet commissioning observation scope changed for {}. No readiness was collected.",t.label()))}
   observations.push(reply["result"].clone());scopes.push(doc["target"].clone());
  }
  if pass==0{let discovered=validate_snapshot(&observations,&scopes,now()?,true)?;parameters=json!({"online_addresses":discovered["online_addresses"]});}
  }
  let artifact=validate(&observations,&scopes,now()?)?;let collected=Collected{targets,scopes,observations,sha256:hash(artifact.to_string().as_bytes())};let result=summary(&collected,&artifact);
  *cache().lock().map_err(|_|"Native readiness review unavailable")?=Some(collected);return Ok(Some(result))
 }
 if operation!="stage"||targets.is_some(){return Err("Unsupported native readiness operation or renderer artifact".into())}
 let current=cache().lock().map_err(|_|"Native readiness review unavailable")?.clone().filter(|c|Some(c.sha256.as_str())==review_sha256.as_deref()).ok_or("Collect the exact current native fleet observations before staging")?;
 if !current.targets.iter().any(|t|t.journal_identity()==target.journal_identity()){return Err("Commissioning target was not part of the authenticated fleet review".into())}
 let artifact=validate(&current.observations,&current.scopes,now()?)?;
 let review_nodes=current.observations.iter().map(|v|json!({"target":v["target"],"address":v["address"],"vpn_binding":v["vpn_binding"],"observed_at_unix":v["observed_at_unix"]})).collect::<Vec<_>>();
 let message=format!("ISOLATED ENGINEERING ONLY\nCommissioning target: {}\nExact selected-controller review SHA256: {}\nPublic observations: {}\n\nApprove only this bounded commissioning and prestart VPN readiness snapshot. All directed probes within the selected subset and cross-observed VPN peer identities were checked against independently authenticated controllers and the unchanged full signed roster. Strict roster count and voting-weight quorum were verified; excluded identities remain unobserved, not removed. This does not prove stake, APQE sessions, running PoSy or finality. The selected target independently revalidates the artifact and receives one commission request grant. No operation is automatically retried.",target.label(),current.sha256,json!({"network_id":artifact["observations"][0]["network_id"],"chain_id":artifact["observations"][0]["chain_id"],"public_file_sha256":artifact["observations"][0]["public_file_sha256"],"online_addresses":artifact["online_addresses"],"excluded_addresses":artifact["excluded_addresses"],"nodes":review_nodes}));
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review exact fleet commissioning snapshot").buttons(MessageDialogButtons::OkCancelCustom("Stage exact readiness once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Readiness review interrupted")?;if !consent{return Ok(None)}
 let artifact=validate(&current.observations,&current.scopes,now()?)?;
 {let mut stored=cache().lock().map_err(|_|"Readiness review unavailable")?;if stored.as_ref().is_none_or(|c|c.sha256!=current.sha256){return Err("Native readiness review changed while confirmation was open".into())}*stored=None;}
 crate::authorization_lifecycle::readiness_grant(&base,&target,&control,artifact.to_string().as_bytes()).await?;
 Ok(Some(json!({"schema":"nodenetwork-native-fleet-readiness-staged-v1","review_sha256":current.sha256,"readiness_staged":true,"commissioned":false,"runtime_participation_verified":false,"finality_verified":false})))
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn fleet_collection_refusals_expose_only_fixed_phase_target_and_known_code(){
 let target=Target{kind:"remote".into(),host:Some("pinned.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};
 let known=collection_refusal(&target,"observation",Some(&json!({"error":{"code":"vpn_readiness_required","message":"private raw output"}})));
 assert!(known.contains("pinned.example"));assert!(known.contains("commissioning observation"));assert!(known.contains("vpn_readiness_required"));assert!(!known.contains("private"));
 let fixed=collection_refusal(&target,"observation",Some(&json!({"error":{"code":"operation_refused","message":"Exact connected VPN peer identity required"}})));assert!(fixed.contains("Exact connected VPN peer identity required"));
 for code in ["unknown_secret","raw\nlog",&"x".repeat(600)]{let value=collection_refusal(&target,"authorization",Some(&json!({"error":{"code":code,"message":"private"}})));assert!(value.contains("observation_unavailable"));assert!(!value.contains(code));assert!(!value.contains("private"));}
 }
 fn fixture()->(Vec<Value>,Vec<Value>){
  use base64::Engine;
  let roster=(1..=5).map(|n|format!("validator-{n}")).collect::<Vec<_>>();let ips=roster.iter().enumerate().map(|(i,a)|(a.clone(),json!(format!("100.64.0.{}",i+1)))).collect::<serde_json::Map<_,_>>();
  let scopes=(1..=5).map(|n|json!({"kind":"remote","host":format!("host-{n}"),"port":22,"root":"/opt/synergy","host_key":format!("independently-approved-{n}")})).collect::<Vec<_>>();
  let public=PUBLIC.iter().map(|n|(n.to_string(),json!("a".repeat(64)))).collect::<serde_json::Map<_,_>>();let files=crate::transport_formation::ARTIFACTS.iter().map(|n|(n.to_string(),json!("a".repeat(64)))).collect::<serde_json::Map<_,_>>();
  let values=roster.iter().enumerate().map(|(i,a)|{
   let peers=roster.iter().enumerate().filter(|(j,_)|*j!=i).map(|(j,a)|(a.clone(),json!({"ip":ips[a],"wireguard_public_key":base64::engine::general_purpose::STANDARD.encode([j as u8+1;32]),"interface":"wt0","reachable":true}))).collect::<serde_json::Map<_,_>>();
   json!({"schema":"nodenetwork-commissioning-observation-v2","observed_at_unix":1000,"target":scopes[i],"manifest_sha256":"a".repeat(64),"provider_report_sha256":"a".repeat(64),"vpn_provider_sha256":"a".repeat(64),"network_id":"formation-test","chain_id":"999998","formation_sha256":"a".repeat(64),"address":a,"enrollment_sha256":format!("{:064x}",i+1),"public_file_sha256":public,"commissioning_file_sha256":files,"validator_addresses":roster,"online_addresses":roster,"observation_kind":"prestart_vpn","frozen_voting_weights":roster.iter().map(|a|(a.clone(),json!("100"))).collect::<serde_json::Map<_,_>>(),"registry_peer_ips":ips,"vpn_binding":{"account_id":"approved-account","peer_id":format!("peer-{i}"),"ip":ips[a],"wireguard_public_key":base64::engine::general_purpose::STANDARD.encode([i as u8+1;32]),"enrollment_sha256":format!("{:064x}",i+101),"server_binding_sha256":"a".repeat(64)},"peers":peers})
  }).collect();(values,scopes)
 }
 #[test]fn exact_five_target_snapshot_is_canonical_and_never_claims_runtime(){
  let(mut values,mut scopes)=fixture();let artifact=validate(&values,&scopes,1000).unwrap();assert_eq!(artifact["observations"].as_array().unwrap().len(),5);
  let bytes=artifact.to_string();assert!(bytes.starts_with("{\"excluded_addresses\":"));assert!(bytes.is_ascii());assert!(bytes.len()<LIMIT);
  values.reverse();scopes.reverse();assert_eq!(validate(&values,&scopes,1000).unwrap(),artifact);
  assert!(validate(&values[..4],&scopes[..4],1000).is_err());
 }
 fn four()->(Vec<Value>,Vec<Value>){let(mut values,mut scopes)=fixture();values.pop();scopes.pop();let online=values.iter().map(|v|v["address"].clone()).collect::<Vec<_>>();for v in &mut values{v["online_addresses"]=json!(online);v["peers"].as_object_mut().unwrap().remove("validator-5");}(values,scopes)}
 #[test]fn four_of_five_preserves_signed_roster_and_requires_all_twelve_peer_identities(){
  let(values,scopes)=four();let artifact=validate(&values,&scopes,1000).unwrap();assert_eq!(artifact["excluded_addresses"],json!(["validator-5"]));assert_eq!(artifact["online_addresses"].as_array().unwrap().len(),4);
  assert_eq!(artifact["observations"].as_array().unwrap().iter().map(|v|v["peers"].as_object().unwrap().len()).sum::<usize>(),12);
  assert_eq!(values[0]["validator_addresses"].as_array().unwrap().len(),5);
  assert_ne!(values[0]["enrollment_sha256"],values[0]["vpn_binding"]["enrollment_sha256"]); // APQE custody and VPN receipt are different hash domains.
  for i in 0..4{for peer in values[i]["peers"].as_object().unwrap().keys(){let mut bad=values.clone();bad[i]["peers"][peer]["reachable"]=json!(false);assert!(validate(&bad,&scopes,1000).is_err());}}
  let mut discovery=values.clone();for v in &mut discovery{v["online_addresses"]=json!([]);v["observation_kind"]=json!("metadata_only");v["peers"]=json!({});}
  assert!(validate_snapshot(&discovery,&scopes,1000,true).is_ok());assert!(validate(&discovery,&scopes,1000).is_err());
  let mut bad=values.clone();bad[0]["online_addresses"]=json!(["validator-1","validator-2","validator-3","validator-5"]);assert!(validate(&bad,&scopes,1000).is_err());
  assert!(validate(&values[..3],&scopes[..3],1000).is_err());
 }
 #[test]fn online_count_cannot_replace_full_signed_weight_quorum_or_overflow_checks(){
  let(values,scopes)=four();
  for weight in ["200","300","400","01","0","-1","340282366920938463463374607431768211455"]{let mut bad=values.clone();for v in &mut bad{v["frozen_voting_weights"]["validator-5"]=json!(weight);}assert!(validate(&bad,&scopes,1000).is_err(),"{weight}");}
  let mut boundary=values.clone();for v in &mut boundary{v["frozen_voting_weights"]["validator-5"]=json!("199");}assert!(validate(&boundary,&scopes,1000).is_ok());
  let mut huge=values.clone();for v in &mut huge{for weight in v["frozen_voting_weights"].as_object_mut().unwrap().values_mut(){*weight=json!("50000000000000000000000000000000000000");}}assert!(validate(&huge,&scopes,1000).is_err());
  let mut bad=values.clone();bad[0]["frozen_voting_weights"]["validator-1"]=json!("101");assert!(validate(&bad,&scopes,1000).is_err());
  let mut bad=values;for v in &mut bad{v["frozen_voting_weights"].as_object_mut().unwrap().remove("validator-5");}assert!(validate(&bad,&scopes,1000).is_err());
 }
 #[test]fn subset_request_is_closed_sorted_unique_and_cannot_carry_weights(){
  for parameters in [json!({"online_addresses":[]}),json!({"online_addresses":["a","b","c","d"]})]{assert!(!Request{version:1,operation:"commissioning_observation".into(),parameters}.validate().unwrap());}
  for parameters in [json!({"online_addresses":["b","a"]}),json!({"online_addresses":["a","a"]}),json!({"online_addresses":["a"],"weights":{}}),json!({"online_addresses":"all"})]{assert!(Request{version:1,operation:"commissioning_observation".into(),parameters}.validate().is_err());}
 }
 #[test]fn substituted_host_roster_release_provider_and_private_fields_fail_closed(){
  let(values,scopes)=fixture();
  for(key,value)in[("manifest_sha256",json!("b".repeat(64))),("provider_report_sha256",json!("b".repeat(64))),("vpn_provider_sha256",json!("b".repeat(64))),("network_id",json!("another-network")),("address",json!("validator-2")),("private_key",json!("must-not-leak"))]{let mut bad=values.clone();bad[0][key]=value;assert!(validate(&bad,&scopes,1000).is_err(),"{key}");}
  let mut bad=values.clone();bad[0]["target"]["guest"]=json!({"guest_id":"substituted"});assert!(validate(&bad,&scopes,1000).is_err());
  let mut bad=values.clone();bad[0]["validator_addresses"]=json!(["validator-1","validator-2","validator-3","validator-4","outsider"]);assert!(validate(&bad,&scopes,1000).is_err());
 }
 #[test]fn ping_alone_cannot_substitute_vpn_peer_identity_or_missing_direction(){
  let(values,scopes)=fixture();
  for(key,value)in[("wireguard_public_key",values[2]["vpn_binding"]["wireguard_public_key"].clone()),("ip",json!("100.64.0.99")),("reachable",json!(false)),("interface",json!("eth0"))]{let mut bad=values.clone();bad[0]["peers"]["validator-2"][key]=value;assert!(validate(&bad,&scopes,1000).is_err(),"{key}");}
  let mut bad=values.clone();bad[0]["peers"].as_object_mut().unwrap().remove("validator-2");assert!(validate(&bad,&scopes,1000).is_err());
  for key in ["peer_id","wireguard_public_key","ip"]{let mut bad=values.clone();bad[0]["vpn_binding"][key]=values[1]["vpn_binding"][key].clone();assert!(validate(&bad,&scopes,1000).is_err());}
 }
 #[test]fn observation_must_match_current_authorized_release_network_and_formation(){
  let(values,_)=fixture();let v=&values[0];let status=json!({"selection":{"manifest_sha256":v["manifest_sha256"],"network_id":v["network_id"],"chain_id":999998},"formation_sha256":v["formation_sha256"]});assert!(current_scope(v,&status));
  for field in ["manifest_sha256","network_id","chain_id"]{let mut bad=status.clone();bad["selection"][field]=Value::Null;assert!(!current_scope(v,&bad));}let mut bad=status;bad["formation_sha256"]=Value::Null;assert!(!current_scope(v,&bad));
 }
 #[test]fn observation_age_and_clock_skew_are_bounded_at_review_and_submission(){
  let(values,scopes)=fixture();assert!(validate(&values,&scopes,1300).is_ok());assert!(validate(&values,&scopes,1301).is_err());assert!(validate(&values,&scopes,970).is_ok());assert!(validate(&values,&scopes,969).is_err());
 }
}
