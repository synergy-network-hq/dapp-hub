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
fn validate(values:&[Value],scopes:&[Value],at:u64)->Result<Value,String>{
 if values.len()!=5||scopes.len()!=5||scopes.iter().map(Value::to_string).collect::<BTreeSet<_>>().len()!=5{return Err("Exactly five independently targeted controllers required".into())}
 let fields=["schema","observed_at_unix","target","manifest_sha256","provider_report_sha256","vpn_provider_sha256","network_id","chain_id","formation_sha256","address","enrollment_sha256","public_file_sha256","commissioning_file_sha256","validator_addresses","registry_peer_ips","vpn_binding","peers"];
 let mut addresses=BTreeSet::new();let mut ips=BTreeSet::new();let mut keys=BTreeSet::new();let mut peer_ids=BTreeSet::new();
 for (v,scope) in values.iter().zip(scopes){
  if !exact(v,&fields)||v["schema"]!="nodenetwork-commissioning-observation-v1"||&v["target"]!=scope||!v["observed_at_unix"].as_u64().is_some_and(|time|time<=at.saturating_add(30)&&at.saturating_sub(time)<=300){return Err("Controller observation scope or freshness differs".into())}
  for field in ["manifest_sha256","provider_report_sha256","vpn_provider_sha256","formation_sha256","enrollment_sha256"]{if !pin(&v[field]){return Err("Incomplete authenticated commissioning commitments".into())}}
  if !token(&v["network_id"])||!v["chain_id"].as_str().is_some_and(|s|s.parse::<u64>().is_ok_and(|n|n>0&&n.to_string()==s))||!token(&v["address"])||!addresses.insert(v["address"].as_str().unwrap().to_string())||!pins(&v["public_file_sha256"],&PUBLIC)||!pins(&v["commissioning_file_sha256"],&crate::transport_formation::ARTIFACTS){return Err("Malformed or duplicate public validator identity".into())}
  for name in PUBLIC{if v["public_file_sha256"][name]!=v["commissioning_file_sha256"][format!("network/{name}")]{return Err("Commissioning artifact differs from authenticated public network".into())}}
  let b=&v["vpn_binding"];
  if !exact(b,&["account_id","peer_id","ip","wireguard_public_key","enrollment_sha256","server_binding_sha256"])||!token(&b["account_id"])||!token(&b["peer_id"])||!ip(&b["ip"])||!key(&b["wireguard_public_key"])||!pin(&b["enrollment_sha256"])||!pin(&b["server_binding_sha256"])||!ips.insert(b["ip"].to_string())||!keys.insert(b["wireguard_public_key"].to_string())||!peer_ids.insert(b["peer_id"].to_string()){return Err("VPN identity is absent, malformed or shared between validators".into())}
  for field in ["manifest_sha256","provider_report_sha256","vpn_provider_sha256","network_id","chain_id","formation_sha256","public_file_sha256","validator_addresses","registry_peer_ips"]{if v[field]!=values[0][field]{return Err("Fleet has mixed authenticated network, release, provider or roster".into())}}
  if b["account_id"]!=values[0]["vpn_binding"]["account_id"]{return Err("Fleet VPN provider accounts differ".into())}
 }
 let roster=values[0]["validator_addresses"].as_array().filter(|a|a.len()==5&&a.iter().all(token)).ok_or("Exactly five signed registry identities required")?;
 if roster.iter().filter_map(Value::as_str).collect::<Vec<_>>()!=addresses.iter().map(String::as_str).collect::<Vec<_>>(){return Err("Observed identities differ from the canonical signed roster".into())}
 let registry=&values[0]["registry_peer_ips"];if !registry.as_object().is_some_and(|m|m.len()==5&&m.keys().cloned().collect::<BTreeSet<_>>()==addresses){return Err("Registry endpoints do not bind the exact five validators".into())}
 for v in values{
  let own=v["address"].as_str().unwrap();if registry[own]!=v["vpn_binding"]["ip"]{return Err("Controller VPN IP differs from its signed registry endpoint".into())}
  let peers=v["peers"].as_object().filter(|p|p.len()==4).ok_or("Four directed peer observations required on each controller")?;
  for other in values.iter().filter(|o|o["address"]!=v["address"]){let address=other["address"].as_str().unwrap();let p=peers.get(address).ok_or("Missing directed VPN peer observation")?;
   if !exact(p,&["ip","wireguard_public_key","interface","reachable"])||p["interface"]!="wt0"||p["reachable"]!=true||p["ip"]!=other["vpn_binding"]["ip"]||p["wireguard_public_key"]!=other["vpn_binding"]["wireguard_public_key"]{return Err("Directed VPN probe or cross-observed peer identity is unverified".into())}
  }
 }
 let mut sorted=values.to_vec();sorted.sort_by(|a,b|a["address"].as_str().cmp(&b["address"].as_str()));let artifact=json!({"schema":"nodenetwork-commissioning-readiness-v1","observations":sorted});
 let bytes=artifact.to_string();if bytes.len()>LIMIT||!bytes.is_ascii(){return Err("Public readiness artifact exceeds canonical ASCII bound".into())}Ok(artifact)
}
fn current_scope(observation:&Value,status:&Value)->bool{
 observation["manifest_sha256"]==status["selection"]["manifest_sha256"]&&observation["formation_sha256"]==status["formation_sha256"]&&observation["network_id"]==status["selection"]["network_id"]&&observation["chain_id"].as_str().and_then(|s|s.parse::<u64>().ok())==status["selection"]["chain_id"].as_u64()&&status["selection"]["chain_id"].as_u64().is_some()
}
#[derive(Clone)]struct Collected{targets:Vec<Target>,scopes:Vec<Value>,observations:Vec<Value>,sha256:String}
static CURRENT:OnceLock<Mutex<Option<Collected>>>=OnceLock::new();
fn cache()->&'static Mutex<Option<Collected>>{CURRENT.get_or_init(||Mutex::new(None))}
fn summary(c:&Collected,artifact:&Value)->Value{json!({"schema":"nodenetwork-native-fleet-readiness-v1","review_sha256":c.sha256,"observations":artifact["observations"],"scope":"commissioning_and_prestart_vpn_only","runtime_participation_verified":false,"finality_verified":false})}
#[tauri::command]
pub async fn portal_nodenetwork_fleet_readiness(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,operation:String,targets:Option<Vec<Target>>,review_sha256:Option<String>)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;if !cfg!(debug_assertions){return Err("Fleet commissioning observation approval is engineering-only".into())}
 let base=app.path().app_local_data_dir().map_err(|_|"App state unavailable")?;let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 if operation=="reconcile"{
  if targets.is_some()||review_sha256.is_some(){return Err("Reconciliation accepts no renderer artifact or review".into())}
  let old=crate::authorization_lifecycle::reconcile_readiness(&base,&target,&control).await?;
  return Ok(Some(json!({"schema":"nodenetwork-native-fleet-readiness-reconciled-v1","pending":false,"original_stage_verified":old.is_some(),"review_sha256":old.as_ref().map(|v|v["artifact_sha256"].clone()),"freshness_verified":false,"commissioned":false})))
 }
 if operation=="collect"{
  if review_sha256.is_some(){return Err("Collection cannot adopt a renderer review".into())}
  let targets=targets.filter(|v|v.len()==5).ok_or("Select exactly five enrolled controller targets")?;let journals=targets.iter().map(Target::journal_identity).collect::<Vec<_>>();
  if journals.iter().map(Value::to_string).collect::<BTreeSet<_>>().len()!=5||!journals.contains(&target.journal_identity()){return Err("Select a unique fleet containing the commissioning target".into())}
  let mut observations=Vec::new();let mut scopes=Vec::new();
  for t in &targets{
   t.validate()?;let raw=crate::authorization_lifecycle::bare_initial(&base,t)?.ok_or("Controller lacks its independently approved original native authorization receipt")?;let doc=authorization::verify_initial(&raw,t)?;
   let status=commands::controller(&app,t.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},&control).await?;
   if status["ok"]!=true||status["result"]["initial_sha256"]!=hash(raw.as_bytes())||status["result"]["target"]!=doc["target"]{return Err("Controller authorization does not match the original independently pinned target".into())}
   let reply=commands::controller(&app,t.clone(),Request{version:1,operation:"commissioning_observation".into(),parameters:json!({})},&control).await?;
   if reply["ok"]!=true||!current_scope(&reply["result"],&status["result"]){return Err("Controller readiness refused or current master changed".into())}
   observations.push(reply["result"].clone());scopes.push(doc["target"].clone());
  }
  let artifact=validate(&observations,&scopes,now()?)?;let collected=Collected{targets,scopes,observations,sha256:hash(artifact.to_string().as_bytes())};let result=summary(&collected,&artifact);
  *cache().lock().map_err(|_|"Native readiness review unavailable")?=Some(collected);return Ok(Some(result))
 }
 if operation!="stage"||targets.is_some(){return Err("Unsupported native readiness operation or renderer artifact".into())}
 let current=cache().lock().map_err(|_|"Native readiness review unavailable")?.clone().filter(|c|Some(c.sha256.as_str())==review_sha256.as_deref()).ok_or("Collect the exact current native fleet observations before staging")?;
 if !current.targets.iter().any(|t|t.journal_identity()==target.journal_identity()){return Err("Commissioning target was not part of the authenticated fleet review".into())}
 let artifact=validate(&current.observations,&current.scopes,now()?)?;
 let review_nodes=current.observations.iter().map(|v|json!({"target":v["target"],"address":v["address"],"vpn_binding":v["vpn_binding"],"observed_at_unix":v["observed_at_unix"]})).collect::<Vec<_>>();
 let message=format!("ISOLATED ENGINEERING ONLY\nCommissioning target: {}\nExact five-controller review SHA256: {}\nPublic observations: {}\n\nApprove only this bounded commissioning and prestart VPN readiness snapshot. All twenty directed probes and cross-observed VPN peer identities were checked against independently authenticated controllers and the signed roster. This does not prove stake, APQE sessions, running PoSy or finality. The selected target independently revalidates the artifact and receives one commission request grant. No operation is automatically retried.",target.label(),current.sha256,json!({"network_id":artifact["observations"][0]["network_id"],"chain_id":artifact["observations"][0]["chain_id"],"public_file_sha256":artifact["observations"][0]["public_file_sha256"],"nodes":review_nodes}));
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review exact fleet commissioning snapshot").buttons(MessageDialogButtons::OkCancelCustom("Stage exact readiness once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Readiness review interrupted")?;if !consent{return Ok(None)}
 let artifact=validate(&current.observations,&current.scopes,now()?)?;
 {let mut stored=cache().lock().map_err(|_|"Readiness review unavailable")?;if stored.as_ref().is_none_or(|c|c.sha256!=current.sha256){return Err("Native readiness review changed while confirmation was open".into())}*stored=None;}
 crate::authorization_lifecycle::readiness_grant(&base,&target,&control,artifact.to_string().as_bytes()).await?;
 Ok(Some(json!({"schema":"nodenetwork-native-fleet-readiness-staged-v1","review_sha256":current.sha256,"readiness_staged":true,"commissioned":false,"runtime_participation_verified":false,"finality_verified":false})))
}

#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(Vec<Value>,Vec<Value>){
  use base64::Engine;
  let roster=(1..=5).map(|n|format!("validator-{n}")).collect::<Vec<_>>();let ips=roster.iter().enumerate().map(|(i,a)|(a.clone(),json!(format!("100.64.0.{}",i+1)))).collect::<serde_json::Map<_,_>>();
  let scopes=(1..=5).map(|n|json!({"kind":"remote","host":format!("host-{n}"),"port":22,"root":"/opt/synergy","host_key":format!("independently-approved-{n}")})).collect::<Vec<_>>();
  let public=PUBLIC.iter().map(|n|(n.to_string(),json!("a".repeat(64)))).collect::<serde_json::Map<_,_>>();let files=crate::transport_formation::ARTIFACTS.iter().map(|n|(n.to_string(),json!("a".repeat(64)))).collect::<serde_json::Map<_,_>>();
  let values=roster.iter().enumerate().map(|(i,a)|{
   let peers=roster.iter().enumerate().filter(|(j,_)|*j!=i).map(|(j,a)|(a.clone(),json!({"ip":ips[a],"wireguard_public_key":base64::engine::general_purpose::STANDARD.encode([j as u8+1;32]),"interface":"wt0","reachable":true}))).collect::<serde_json::Map<_,_>>();
   json!({"schema":"nodenetwork-commissioning-observation-v1","observed_at_unix":1000,"target":scopes[i],"manifest_sha256":"a".repeat(64),"provider_report_sha256":"a".repeat(64),"vpn_provider_sha256":"a".repeat(64),"network_id":"formation-test","chain_id":"999998","formation_sha256":"a".repeat(64),"address":a,"enrollment_sha256":"a".repeat(64),"public_file_sha256":public,"commissioning_file_sha256":files,"validator_addresses":roster,"registry_peer_ips":ips,"vpn_binding":{"account_id":"approved-account","peer_id":format!("peer-{i}"),"ip":ips[a],"wireguard_public_key":base64::engine::general_purpose::STANDARD.encode([i as u8+1;32]),"enrollment_sha256":"a".repeat(64),"server_binding_sha256":"a".repeat(64)},"peers":peers})
  }).collect();(values,scopes)
 }
 #[test]fn exact_five_target_snapshot_is_canonical_and_never_claims_runtime(){
  let(mut values,mut scopes)=fixture();let artifact=validate(&values,&scopes,1000).unwrap();assert_eq!(artifact["observations"].as_array().unwrap().len(),5);
  let bytes=artifact.to_string();assert!(bytes.starts_with("{\"observations\":"));assert!(bytes.is_ascii());assert!(bytes.len()<LIMIT);
  values.reverse();scopes.reverse();assert_eq!(validate(&values,&scopes,1000).unwrap(),artifact);
  assert!(validate(&values[..4],&scopes[..4],1000).is_err());
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
