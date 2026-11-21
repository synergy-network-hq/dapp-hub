//! Closed relay observations. Service state never establishes gateway reachability or consensus.
use serde_json::{json,Value};
const ERROR:&str="The selected controller returned unsupported gateway relay health evidence.";
fn exact(v:&Value,keys:&[&str])->bool{v.as_object().is_some_and(|m|m.len()==keys.len()&&keys.iter().all(|k|m.contains_key(*k)))}
fn u53(v:&Value)->bool{v.as_u64().is_some_and(|v|v<=9_007_199_254_740_991)}
pub(super) fn review(v:&Value)->Result<Value,&'static str>{
 if !exact(v,&["schema","observed_at_ms","role","relay","vpn","admission_custody_verified","consensus_participant","configured_loopback","production_qualified"])
  ||v["schema"]!="nodenetwork-gateway-health-v1"||v["role"]!="rpc_gateway"||!u53(&v["observed_at_ms"])||v["observed_at_ms"]==0
  ||v["admission_custody_verified"]!=true||v["consensus_participant"]!=false||v["configured_loopback"]!=true||v["production_qualified"]!=false{return Err(ERROR)}
 let relay=&v["relay"];let vpn=&v["vpn"];
 if !exact(relay,&["unit","state","pid"])||relay["unit"]!="synergy-canary-rpc-relay.service"
  ||!matches!(relay["state"].as_str(),Some("unregistered"|"active"|"inactive"|"failed"|"activating"|"deactivating"|"reloading"|"maintenance"|"refreshing"))
  ||if relay["state"]=="unregistered"{!relay["pid"].is_null()}else{!u53(&relay["pid"])}
  ||!exact(vpn,&["registered","enrollment_recorded","server_bound","connected"])
  ||!["registered","enrollment_recorded","server_bound","connected"].iter().all(|k|vpn[*k].is_boolean())
  ||(vpn["connected"]==true&&["registered","enrollment_recorded"].iter().any(|k|vpn[*k]!=true)){return Err(ERROR)}
 Ok(v.clone())
}
pub(super) fn reply(v:&Value)->Result<Value,&'static str>{if !exact(v,&["version","ok","result"])||v["version"]!=1||v["ok"]!=true{return Err(ERROR)}Ok(json!({"version":1,"ok":true,"result":review(&v["result"])?}))}
#[cfg(test)]mod tests{use super::*;fn fixture()->Value{json!({"schema":"nodenetwork-gateway-health-v1","observed_at_ms":1795070000000u64,"role":"rpc_gateway","relay":{"unit":"synergy-canary-rpc-relay.service","state":"inactive","pid":0},"vpn":{"registered":true,"enrollment_recorded":true,"server_bound":true,"connected":false},"admission_custody_verified":true,"consensus_participant":false,"configured_loopback":true,"production_qualified":false})}
 #[test]fn gateway_health_closed_relay_state_no_consensus_inference(){let v=fixture();assert_eq!(review(&v).unwrap(),v);let mut unbound=v.clone();unbound["vpn"]["connected"]=json!(true);unbound["vpn"]["server_bound"]=json!(false);assert!(review(&unbound).is_ok());let mut unknown=v.clone();unknown["relay"]=json!({"unit":"synergy-canary-rpc-relay.service","state":"unregistered","pid":null});assert!(review(&unknown).is_ok());for(path,value)in [("/role",json!("validator")),("/relay/unit",json!("synergy-node.service")),("/relay/state",json!("healthy")),("/relay/pid",json!(-1)),("/observed_at_ms",json!(9007199254740992u64)),("/consensus_participant",json!(true)),("/production_qualified",json!(true)),("/vpn/connected",json!("true"))]{let mut bad=v.clone();*bad.pointer_mut(path).unwrap()=value;assert!(review(&bad).is_err(),"{path}")}let mut bad=v;bad["extra"]=json!("raw");assert!(review(&bad).is_err())}
}
