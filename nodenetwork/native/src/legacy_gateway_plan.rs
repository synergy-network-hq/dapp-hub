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
const BLOCKERS:&[&str]=&["explicit_retirement_approval_required","foreign_resources","inventory_bound_exceeded","legacy_attribution_failed","legacy_inventory_requires_attribution","metrics_resolution_required","protected_attribution_failed","legacy_peer_retirement_required"];
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
 let old_only=v["schema"]=="nodenetwork-legacy-canary-retirement-plan-v1";
 if !exact(reply,&["version","ok","result"])||reply["version"]!=1||reply["ok"]!=true
  ||!exact(v,&["schema","challenge","target","machine_id_sha256","plan_sha256","preserved","metrics","legacy","candidate_units","blockers","mutation_performed","removal_authorized","automatic_retry"])
  ||(!old_only&&v["schema"]!="nodenetwork-legacy-gateway-handoff-plan-v1")||v["challenge"]!=wire["challenge"]||!pin(&v["challenge"])||v["target"]!=wire["context"]["target"]||v["machine_id_sha256"]!=MACHINE||v["machine_id_sha256"]!=wire["context"]["machine_id_sha256"]||!pin(&v["plan_sha256"])
  ||["mutation_performed","removal_authorized","automatic_retry"].iter().any(|k|v[*k]!=false){return Err(REFUSED.into())}
 let p=&v["preserved"];let m=&v["metrics"];let l=&v["legacy"];
 let mut public_files=vec!["nginx_rpc","nginx_origin_only","nginx_origin_aop","nginx_source_map","tls_public_certificate","tunnel_unit"];
 if old_only{public_files.push("canary_frontend");}
 let mut legacy_pins=vec!["canary_executable_sha256","canary_unit_sha256","vpn_unit_sha256","lower_root_entries_sha256","upper_root_entries_sha256"];
 if !old_only{legacy_pins.push("chain1266_executable_sha256");}
 let mut legacy_fields=legacy_pins.clone();legacy_fields.extend(["canary_active","vpn_active"]);
 let mut preserved_fields=vec!["files","tunnel_active","rpc_listener_owned","ws_listener_owned"];
 if old_only{legacy_fields.extend(["old_network","vpn_binding","canary_pid","vpn_pid"]);preserved_fields.extend(["rpc_tunnel_pid","metrics_pid"]);}
 if !exact(p,&preserved_fields)||!exact(&p["files"],&public_files)||public_files.iter().any(|k|!pin(&p["files"][*k]))
  ||["tunnel_active","rpc_listener_owned","ws_listener_owned"].iter().any(|k|!p[*k].is_boolean())
  ||!exact(m,&["unit_sha256","service_active","listener_owned","consumer_ip","resolution"])||!pin(&m["unit_sha256"])||!m["service_active"].is_boolean()||!m["listener_owned"].is_boolean()||m["consumer_ip"]!="209.145.50.9"||m["resolution"]!="unresolved"
  ||!exact(l,&legacy_fields)||legacy_pins.iter().any(|k|!pin(&l[*k]))||!l["canary_active"].is_boolean()||!l["vpn_active"].is_boolean()||v["candidate_units"]!=json!(if old_only{&UNITS[1..]}else{UNITS}){return Err(REFUSED.into())}
 if old_only{validate_old_scope(v)?;}
 let required=if old_only{&["explicit_retirement_approval_required","legacy_inventory_requires_attribution","legacy_peer_retirement_required"][..]}else{REQUIRED};
 let blockers=v["blockers"].as_array().ok_or(REFUSED)?;
 let names=blockers.iter().map(Value::as_str).collect::<Option<Vec<_>>>().ok_or(REFUSED)?;
 if names.len()>BLOCKERS.len()||!names.windows(2).all(|w|w[0]<w[1])||names.iter().any(|s|!BLOCKERS.contains(s))||required.iter().any(|s|!names.contains(s))
  ||(["tunnel_active","rpc_listener_owned","ws_listener_owned"].iter().any(|k|p[*k]==false)&&!names.contains(&"protected_attribution_failed"))
  ||(m["listener_owned"]==true&&m["service_active"]!=true)||(m["listener_owned"]==false&&!names.contains(&"legacy_attribution_failed")){return Err(REFUSED.into())}
 let hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&commitment(v)).map_err(|_|REFUSED)?));
 if v["plan_sha256"]!=hash{return Err(REFUSED.into())}Ok(v.clone())
}

fn validate_old_scope(v:&Value)->Result<(),String>{
 let l=&v["legacy"];let n=&l["old_network"];let b=&l["vpn_binding"];
 let valid_pid=|value:&Value|value.as_u64().is_some_and(|n|n<=9_007_199_254_740_991);
 if !exact(n,&["network_id","chain_id","genesis_sha256","node_config_sha256","relay_config_sha256"])
  ||n["network_id"]!="posy-apqe-canary-process-49028"||n["chain_id"]!=99999
  ||n["genesis_sha256"]!="d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7"
  ||!pin(&n["node_config_sha256"])||!pin(&n["relay_config_sha256"])
  ||!exact(b,&["enrollment_sha256","binding_sha256","peer_id","peer_name","hostname","ip","wireguard_public_key","management_origin","retirement_verified"])
  ||b["enrollment_sha256"]!="f27a0e0031ba00f2a234e77e55449ca5f4b9a15dec7e2c8da3da5bde6ea37573"
  ||b["binding_sha256"]!="1629d857606c040ecbd7ed9d5dc692ac697dda3b129cc1f8b2bb9834e594d5f2"
  ||b["peer_id"]!="dboqb9if611ohpqo0e1g"||b["peer_name"]!="synergy-canary-rpc-99999"||b["hostname"]!="vmi3381382"
  ||b["ip"]!="10.69.51.205"||b["wireguard_public_key"]!="EhHDd/L7fXX+c8x2nyJx8wWUwGRij3AmioVZKiH4/2M="
  ||b["management_origin"]!="https://vpn-coordinator.synergy-network.io"||b["retirement_verified"]!=false
  ||[&l["canary_pid"],&l["vpn_pid"],&v["preserved"]["rpc_tunnel_pid"],&v["preserved"]["metrics_pid"]].iter().any(|x|!valid_pid(x))
  ||(l["canary_pid"]!=0)!=(l["canary_active"]==true)||(l["vpn_pid"]!=0)!=(l["vpn_active"]==true)
  ||(v["preserved"]["metrics_pid"]!=0)!=(v["metrics"]["service_active"]==true)
  ||(v["preserved"]["tunnel_active"]==true&&v["preserved"]["rpc_tunnel_pid"]==0){return Err(REFUSED.into())}
 Ok(())
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
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|REFUSED)?;
  if reply["result"]["schema"]!="nodenetwork-legacy-canary-retirement-plan-v1"{return Err(REFUSED.into())}
  let result=decode(&reply,&wire)?;
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
 #[test]fn legacy_gateway_plan_command_is_fixed_and_bounded(){let command=node_bootstrap::gateway_handoff_command().unwrap();assert!(command.starts_with("/usr/bin/sudo -n /usr/bin/python3 -I -B -c "));assert!(command.ends_with(" --legacy-canary-retirement-plan"));assert!(command.len()<96*1024+1024);assert!(!command.contains("167.86.83.83"));}

 fn retirement_fixture()->(Value,Value){
  let(mut r,w)=fixture();let v=&mut r["result"];v["schema"]=json!("nodenetwork-legacy-canary-retirement-plan-v1");
  v["candidate_units"]=json!(&UNITS[1..]);v["blockers"]=json!(["explicit_retirement_approval_required","legacy_inventory_requires_attribution","legacy_peer_retirement_required"]);
  v["legacy"].as_object_mut().unwrap().remove("chain1266_executable_sha256");
  v["preserved"]["files"]["canary_frontend"]=json!("a".repeat(64));v["preserved"]["rpc_tunnel_pid"]=json!(10);v["preserved"]["metrics_pid"]=json!(11);
  v["legacy"]["canary_pid"]=json!(12);v["legacy"]["vpn_pid"]=json!(13);
  v["legacy"]["old_network"]=json!({"network_id":"posy-apqe-canary-process-49028","chain_id":99999,"genesis_sha256":"d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7","node_config_sha256":"a".repeat(64),"relay_config_sha256":"b".repeat(64)});
  v["legacy"]["vpn_binding"]=json!({"enrollment_sha256":"f27a0e0031ba00f2a234e77e55449ca5f4b9a15dec7e2c8da3da5bde6ea37573","binding_sha256":"1629d857606c040ecbd7ed9d5dc692ac697dda3b129cc1f8b2bb9834e594d5f2","peer_id":"dboqb9if611ohpqo0e1g","peer_name":"synergy-canary-rpc-99999","hostname":"vmi3381382","ip":"10.69.51.205","wireguard_public_key":"EhHDd/L7fXX+c8x2nyJx8wWUwGRij3AmioVZKiH4/2M=","management_origin":"https://vpn-coordinator.synergy-network.io","retirement_verified":false});
  rehash(v);(r,w)
 }
 #[test]fn legacy_gateway_plan_old_only_preserves_1266_and_never_proves_peer_retirement(){let(r,w)=retirement_fixture();assert!(decode(&r,&w).is_ok());assert!(r["result"]["legacy"].get("chain1266_executable_sha256").is_none());for key in ["peer_id","retirement_verified"]{let mut wrong=r.clone();wrong["result"]["legacy"]["vpn_binding"][key]=json!(true);rehash(&mut wrong["result"]);assert!(decode(&wrong,&w).is_err())}}
 #[test]fn legacy_gateway_plan_old_only_rejects_current_chain_changed_process_or_unbound_closure(){let(r,w)=retirement_fixture();for (path,value) in [(vec!["legacy","old_network","network_id"],json!("synergy-posy-canary-20261117")),(vec!["legacy","old_network","genesis_sha256"],json!("e".repeat(64))),(vec!["legacy","canary_pid"],json!(0)),(vec!["preserved","metrics_pid"],json!(-1)),(vec!["preserved","files","canary_frontend"],json!(null))]{let mut wrong=r.clone();let mut field=&mut wrong["result"];for k in path{field=&mut field[k];}*field=value;rehash(&mut wrong["result"]);assert!(decode(&wrong,&w).is_err())}let mut changed=r;changed["result"]["legacy"]["old_network"]["node_config_sha256"]=json!("b".repeat(64));assert!(decode(&changed,&w).is_err());}

}
