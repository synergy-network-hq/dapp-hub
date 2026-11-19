//! Read-only legacy scope observation. This is never retirement authorization.
use crate::{gateway_admission::{exact,pin},node_bootstrap,node_controller::{self,Target}};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::Path,process::Stdio,sync::atomic::{AtomicU64,Ordering},time::{Duration,SystemTime,UNIX_EPOCH}};
use tokio::io::{AsyncReadExt,AsyncWriteExt};

// SHA256 of independently verified canonical 32-lowercase-hex machine ID.
const MACHINE:&str="8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d";
const REFUSED:&str="Legacy gateway handoff observation unavailable; no resources or authority were changed";
const REQUIRED:&[&str]=&["explicit_retirement_approval_required","legacy_inventory_requires_attribution","metrics_resolution_required"];
const BLOCKERS:&[&str]=&["explicit_retirement_approval_required","foreign_resources","inventory_bound_exceeded","legacy_attribution_failed","legacy_inventory_requires_attribution","metrics_resolution_required","protected_attribution_failed"];
const UNITS:&[&str]=&["synergy-chain1266-role@rpc-gateway.service","synergy-canary-rpc-relay.service","synergy-vpn.service"];

fn target_scope(target:&Target,operator:&str)->Result<Value,String>{
 target.validate()?;
 if !cfg!(debug_assertions)||target.kind!="remote"||target.host.as_deref()!=Some("167.86.83.83")||target.port.unwrap_or(22)!=22||target.guest.is_some()||operator!="root"{return Err("Select the independently pinned legacy gateway and its existing root account for this engineering read only".into())}
 Ok(json!({"kind":"remote","host":"167.86.83.83","port":22,"root":"/opt/synergy"}))
}
fn commitment(v:&Value)->Value{
 let mut out=serde_json::Map::new();for key in ["target","machine_id_sha256","preserved","metrics","legacy","candidate_units","blockers"]{out.insert(key.into(),v[key].clone());}Value::Object(out)
}
fn decode(reply:&Value,wire:&Value)->Result<Value,String>{
 let v=&reply["result"];
 if !exact(reply,&["version","ok","result"])||reply["version"]!=1||reply["ok"]!=true
  ||!exact(v,&["schema","challenge","target","machine_id_sha256","plan_sha256","preserved","metrics","legacy","candidate_units","blockers","mutation_performed","removal_authorized","automatic_retry"])
  ||v["schema"]!="nodenetwork-legacy-gateway-handoff-plan-v1"||v["challenge"]!=wire["challenge"]||!pin(&v["challenge"])||v["target"]!=wire["context"]["target"]||v["machine_id_sha256"]!=MACHINE||v["machine_id_sha256"]!=wire["context"]["machine_id_sha256"]||!pin(&v["plan_sha256"])
  ||["mutation_performed","removal_authorized","automatic_retry"].iter().any(|k|v[*k]!=false){return Err(REFUSED.into())}
 let p=&v["preserved"];let m=&v["metrics"];let l=&v["legacy"];
 let public_files=["nginx_rpc","nginx_origin_only","nginx_origin_aop","nginx_source_map","tls_public_certificate","tunnel_unit"];
 let legacy_pins=["chain1266_executable_sha256","canary_executable_sha256","canary_unit_sha256","vpn_unit_sha256","lower_root_entries_sha256","upper_root_entries_sha256"];
 if !exact(p,&["files","tunnel_active","rpc_listener_owned","ws_listener_owned"])||!exact(&p["files"],&public_files)||public_files.iter().any(|k|!pin(&p["files"][*k]))
  ||["tunnel_active","rpc_listener_owned","ws_listener_owned"].iter().any(|k|!p[*k].is_boolean())
  ||!exact(m,&["unit_sha256","service_active","listener_owned","consumer_ip","resolution"])||!pin(&m["unit_sha256"])||!m["service_active"].is_boolean()||!m["listener_owned"].is_boolean()||m["consumer_ip"]!="209.145.50.9"||m["resolution"]!="unresolved"
  ||!exact(l,&["chain1266_executable_sha256","canary_executable_sha256","canary_unit_sha256","vpn_unit_sha256","canary_active","vpn_active","lower_root_entries_sha256","upper_root_entries_sha256"])||legacy_pins.iter().any(|k|!pin(&l[*k]))||!l["canary_active"].is_boolean()||!l["vpn_active"].is_boolean()||v["candidate_units"]!=json!(UNITS){return Err(REFUSED.into())}
 let blockers=v["blockers"].as_array().ok_or(REFUSED)?;
 let names=blockers.iter().map(Value::as_str).collect::<Option<Vec<_>>>().ok_or(REFUSED)?;
 if names.len()>BLOCKERS.len()||!names.windows(2).all(|w|w[0]<w[1])||names.iter().any(|s|!BLOCKERS.contains(s))||REQUIRED.iter().any(|s|!names.contains(s))
  ||(["tunnel_active","rpc_listener_owned","ws_listener_owned"].iter().any(|k|p[*k]==false)&&!names.contains(&"protected_attribution_failed"))
  ||(m["listener_owned"]==true&&m["service_active"]!=true)||(m["listener_owned"]==false&&!names.contains(&"legacy_attribution_failed")){return Err(REFUSED.into())}
 let hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&commitment(v)).map_err(|_|REFUSED)?));
 if v["plan_sha256"]!=hash{return Err(REFUSED.into())}Ok(v.clone())
}

pub(super) async fn inspect(target:&Target,operator:&str,control:&Path)->Result<Value,String>{
 let scope=target_scope(target,operator)?;
 let _serial=node_controller::SERIAL.lock().await;
 let known_hosts=node_controller::bootstrap_host_pin(target,control)?;
 let identity=node_bootstrap::controller_operator_identity(target,control)?.ok_or("Select the existing operator public identity for this exact target first")?;
 let selected=node_bootstrap::selected_operator_key(&identity)?;
 node_controller::close_connection_checked(target,control,operator).await?;
 static NEXT:AtomicU64=AtomicU64::new(0);
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Local clock unavailable")?;
 let challenge=format!("{:x}",Sha256::digest(format!("legacy-gateway-plan:{scope}:{}:{}:{}",now.as_nanos(),std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed))));
 let wire=json!({"context":{"target":scope,"machine_id_sha256":MACHINE,"expires_at":now.as_secs()+120},"challenge":challenge});
 let command=node_bootstrap::gateway_handoff_command()?;
 let mut cmd=node_controller::remote_command_with_identity(target,control,operator,&command,Some(&known_hosts),Some(&identity))?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=cmd.spawn().map_err(|_|REFUSED)?;
 let result=async{
  let mut input=child.stdin.take().ok_or(REFUSED)?;
  input.write_all(&serde_json::to_vec(&wire).map_err(|_|REFUSED)?).await.map_err(|_|REFUSED)?;input.shutdown().await.map_err(|_|REFUSED)?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or(REFUSED)?.take(16385).read_to_end(&mut bytes).await.map_err(|_|REFUSED)?;
  if bytes.len()>16384||!child.wait().await.map_err(|_|REFUSED)?.success(){return Err(REFUSED.into())}
  let reply=serde_json::from_slice(&bytes).map_err(|_|REFUSED)?;let result=decode(&reply,&wire)?;
  let after=node_bootstrap::controller_operator_identity(target,control)?.ok_or(REFUSED)?;
  if after!=identity||node_bootstrap::selected_operator_key(&after)?!=selected||node_controller::bootstrap_host_pin(target,control)?!=known_hosts{return Err(REFUSED.into())}Ok(result)
 };
 let result=tokio::time::timeout(Duration::from_secs(90),result).await.map_err(|_|REFUSED.to_string()).and_then(|v|v);
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}

#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(Value,Value){let p="a".repeat(64);let target=json!({"kind":"remote","host":"167.86.83.83","port":22,"root":"/opt/synergy"});let wire=json!({"context":{"target":target,"machine_id_sha256":MACHINE},"challenge":p});let mut v=json!({"schema":"nodenetwork-legacy-gateway-handoff-plan-v1","challenge":p,"target":target,"machine_id_sha256":MACHINE,"plan_sha256":p,"preserved":{"files":{},"tunnel_active":true,"rpc_listener_owned":true,"ws_listener_owned":true},"metrics":{"unit_sha256":p,"service_active":true,"listener_owned":true,"consumer_ip":"209.145.50.9","resolution":"unresolved"},"legacy":{"canary_active":true,"vpn_active":true},"candidate_units":UNITS,"blockers":REQUIRED,"mutation_performed":false,"removal_authorized":false,"automatic_retry":false});for k in ["nginx_rpc","nginx_origin_only","nginx_origin_aop","nginx_source_map","tls_public_certificate","tunnel_unit"]{v["preserved"]["files"][k]=json!(p)}for k in ["chain1266_executable_sha256","canary_executable_sha256","canary_unit_sha256","vpn_unit_sha256","lower_root_entries_sha256","upper_root_entries_sha256"]{v["legacy"][k]=json!(p)}rehash(&mut v);(json!({"version":1,"ok":true,"result":v}),wire)}
 fn rehash(v:&mut Value){v["plan_sha256"]=json!(format!("{:x}",Sha256::digest(serde_json::to_vec(&commitment(v)).unwrap())))}
 #[test]fn legacy_gateway_plan_closed_and_never_authorizes_retirement(){let(r,w)=fixture();assert!(decode(&r,&w).is_ok());assert_eq!(r["result"]["plan_sha256"],"1f3ae46cd9aaf5be6f1ed6900586b0c7c57195f1e4353971d1841f243a712798");let mut inactive=r.clone();inactive["result"]["legacy"]["canary_active"]=json!(false);rehash(&mut inactive["result"]);assert!(decode(&inactive,&w).is_ok());for key in ["mutation_performed","removal_authorized","automatic_retry"]{let mut b=r.clone();b["result"][key]=json!(true);assert!(decode(&b,&w).is_err())}for key in ["challenge","machine_id_sha256","plan_sha256"]{let mut b=r.clone();b["result"][key]=json!("b".repeat(64));assert!(decode(&b,&w).is_err())}let mut b=r.clone();b["result"]["private"]=json!("secret");assert!(decode(&b,&w).is_err());let mut b=r.clone();b["result"]["blockers"]=json!([]);rehash(&mut b["result"]);assert!(decode(&b,&w).is_err());let mut b=r;b["result"]["preserved"]["rpc_listener_owned"]=json!(false);rehash(&mut b["result"]);assert!(decode(&b,&w).is_err());}
 #[test]fn legacy_gateway_plan_rejects_foreign_target_and_mutated_public_scope(){let(r,w)=fixture();for path in ["preserved","metrics","legacy"]{let mut b=r.clone();b["result"][path]["extra"]=json!("private");rehash(&mut b["result"]);assert!(decode(&b,&w).is_err())}let mut b=r.clone();b["result"]["target"]["host"]=json!("other.invalid");rehash(&mut b["result"]);assert!(decode(&b,&w).is_err());let target=Target{kind:"remote".into(),host:Some("167.86.83.83".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};assert!(target_scope(&target,"root").is_ok());assert!(target_scope(&target,"admin").is_err());let mut foreign=target;foreign.host=Some("other.invalid".into());assert!(target_scope(&foreign,"root").is_err());}
 #[test]fn legacy_gateway_plan_command_is_fixed_and_bounded(){let command=node_bootstrap::gateway_handoff_command().unwrap();assert!(command.starts_with("/usr/bin/sudo -n /usr/bin/python3 -I -B -c "));assert!(command.ends_with(" --gateway-handoff-plan"));assert!(command.len()<96*1024+1024);assert!(!command.contains("167.86.83.83"));}

}
