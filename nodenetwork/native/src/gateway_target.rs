//! Exact engineering gateway target operations; never accepts copied custody.
use crate::{gateway_admission::{digest,exact,pin},node_controller::Request};
use serde_json::{json,Value};

const FIELDS:&[&str]=&["schema","available","blocker","state","network_id","chain_id","genesis_sha256","generation_request_sha256","gateway_address","enrollment_sha256","commission_request_sha256","admission_sha256","configuration_sha256","transport_custody_verified","services_started","public_listener","production_qualified","automatic_retry"];
fn network(v:&Value)->bool{v.as_str().is_some_and(super::node_controller::validator_network_id)}
fn chain(v:&Value)->bool{v.as_str().is_some_and(super::node_controller::validator_chain_id)}
fn address(v:&Value)->bool{v.as_str().is_some_and(|s|s.starts_with("synv5")&&s.len()>5&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()))}
fn bounded(v:&Value,max:usize)->Result<&str,String>{v.as_str().filter(|s|!s.is_empty()&&s.len()<=max&&!s.contains('\0')).ok_or_else(||"Select bounded public gateway JSON, never paths or custody".into())}
fn commission_parameters(p:&Value)->Result<(),String>{
 if !exact(p,&["admission_json","admission_sha256","configuration_json","configuration_sha256"]){return Err("Gateway commission accepts only exact public admission and configuration".into())}
 let admission=bounded(&p["admission_json"],128*1024)?;
 let configuration=bounded(&p["configuration_json"],64*1024)?;
 if p["admission_sha256"]!=digest(admission.as_bytes())||p["configuration_sha256"]!=digest(configuration.as_bytes()){
  return Err("Gateway public input differs from its exact UTF-8 digest".into())
 }
 let a:Value=serde_json::from_str(admission).map_err(|_|"Malformed public gateway admission")?;
 let c:Value=serde_json::from_str(configuration).map_err(|_|"Malformed public gateway configuration")?;
 if !a.is_object()||!exact(&c,&["node_configuration","relay_specification"])||!c["node_configuration"].is_object()||!exact(&c["relay_specification"],&["listen_address","role"]){
  return Err("Use only the existing gateway node configuration and canonical relay specification".into())
 }Ok(())
}
pub(super) fn validate(request:&Request)->Result<bool,String>{
 let p=&request.parameters;
 let mutation=match request.operation.as_str(){
  "gateway_install"|"gateway_install_preflight"=>{
   let mut legacy=request.clone();legacy.operation="install_preflight".into();legacy.validate()?;
   request.operation=="gateway_install"
  },
  "gateway_target_status"|"gateway_target_preflight"|"gateway_target_export"|"gateway_target_configuration" if exact(p,&[])=>false,
  "gateway_target_reconcile" if exact(p,&["request_sha256"])&&pin(&p["request_sha256"])=>false,
  "gateway_install_status" if exact(p,&["request_sha256"])&&pin(&p["request_sha256"])=>false,
  "gateway_target_generate" if exact(p,&["genesis_sha256"])&&pin(&p["genesis_sha256"])=>true,
  "gateway_target_commission"|"gateway_target_commission_preflight"=>{commission_parameters(p)?;request.operation=="gateway_target_commission"},
  _=>return Err("Unsupported gateway target operation; copied keys, unlocks and arbitrary commands are forbidden".into()),
 };
 if mutation&&!cfg!(debug_assertions){return Err("Gateway target provisioning is isolated engineering only".into())}Ok(mutation)
}
pub(super) fn review(value:&Value,export:bool)->Result<Value,String>{
 let fail=||"Unsupported gateway target observation; no custody, service or request outcome was inferred".to_string();
 let mut fields=FIELDS.to_vec();if export{fields.push("enrollment_json")}
 if !exact(value,&fields)||value["schema"]!="nodenetwork-gateway-target-v1"||!value["available"].is_boolean()||!value["transport_custody_verified"].is_boolean()
  ||["services_started","public_listener","production_qualified","automatic_retry"].iter().any(|k|value[*k]!=false){return Err(fail())}
 let state=value["state"].as_str().ok_or_else(fail)?;
 if value["available"]==true{
  if !value["blocker"].is_null()||!matches!(state,"ready"|"identity_ready"|"commissioned"){return Err(fail())}
 }else if !matches!(state,"absent"|"uncertain")||!["owner_unavailable","origin_required","reconciliation_required"].iter().any(|s|value["blocker"]==*s){return Err(fail())}
 if matches!(state,"ready"|"identity_ready"|"commissioned"){
  if !network(&value["network_id"])||!chain(&value["chain_id"])||!pin(&value["genesis_sha256"]){return Err(fail())}
 }else if ["network_id","chain_id","genesis_sha256"].iter().any(|k|!value[*k].is_null()){return Err(fail())}
 if matches!(state,"identity_ready"|"commissioned"){
  if !pin(&value["generation_request_sha256"])||!address(&value["gateway_address"])||!pin(&value["enrollment_sha256"]){return Err(fail())}
 }else if ["generation_request_sha256","gateway_address","enrollment_sha256"].iter().any(|k|!value[*k].is_null()){return Err(fail())}
 if state=="commissioned"{
  if !["commission_request_sha256","admission_sha256","configuration_sha256"].iter().all(|k|pin(&value[*k]))||value["transport_custody_verified"]!=true{return Err(fail())}
 }else if ["commission_request_sha256","admission_sha256","configuration_sha256"].iter().any(|k|!value[*k].is_null())||value["transport_custody_verified"]!=false{return Err(fail())}
 if export&&(!matches!(state,"identity_ready"|"commissioned")||digest(bounded(&value["enrollment_json"],128*1024)?.as_bytes())!=value["enrollment_sha256"]){return Err(fail())}Ok(value.clone())
}
pub(super) fn profile_configuration(value: &Value) -> Result<Value, String> {
 let fail = || "Unsupported authenticated gateway profile observation".to_string();
 if !exact(value, &["schema", "profile", "profile_sha256", "configuration_json", "installed"])
  || value["schema"] != "nodenetwork-gateway-profile-configuration-v1"
  || !pin(&value["profile_sha256"]) || !value["installed"].is_boolean()
  || value["profile"]["schema"] != "synergy-network-provisioning-v1"
  || value["profile"]["role"] != "rpc_gateway"
  || !network(&value["profile"]["network_id"])
  || value["profile"]["chain_id"].as_u64().is_none_or(|id| id == 0)
  || !pin(&value["profile"]["genesis_hash"]) {
  return Err(fail());
 }
 let configuration = bounded(&value["configuration_json"], 64 * 1024)?;
 let configuration: Value = serde_json::from_str(configuration).map_err(|_| fail())?;
 if !exact(&configuration, &["node_configuration", "relay_specification"])
  || !["network_id", "chain_id", "node_name", "role"].iter()
    .all(|key| configuration["node_configuration"][*key] == value["profile"][*key])
  || configuration["relay_specification"]["role"]["kind"] != "gateway"
  || !address(&configuration["relay_specification"]["role"]["gateway_address"]) {
  return Err(fail());
 }
 Ok(value.clone())
}
pub(super) fn commission_preflight(request:&Request,value:&Value)->Result<Value,String>{
 let mut commission=request.clone();commission.operation="gateway_target_commission".into();validate(&commission)?;
 if !exact(value,&["schema","ready","request_sha256","network_id","chain_id","genesis_sha256","gateway_address","enrollment_sha256","admission_sha256","configuration_sha256","transport_custody_verified","mutation_performed","services_started","public_listener","production_qualified"])
  ||value["schema"]!="nodenetwork-gateway-target-commission-preflight-v1"||value["ready"]!=true||value["request_sha256"]!=commission.approval_id()
  ||!network(&value["network_id"])||!chain(&value["chain_id"])||!address(&value["gateway_address"])||!pin(&value["genesis_sha256"])||!pin(&value["enrollment_sha256"])
  ||["admission_sha256","configuration_sha256"].iter().any(|k|value[*k]!=commission.parameters[*k])||value["transport_custody_verified"]!=true
  ||["mutation_performed","services_started","public_listener","production_qualified"].iter().any(|k|value[*k]!=false){return Err("Native gateway commission preflight did not verify the exact public inputs and local custody".into())}
 Ok(value.clone())
}
pub(super) fn query(request:&Request)->Request{
 Request{version:1,operation:match request.operation.as_str(){"gateway_install"=>"gateway_install_preflight","gateway_target_commission"=>"gateway_target_commission_preflight",_=>"gateway_target_preflight"}.into(),parameters:if request.operation=="gateway_target_generate"{json!({})}else{request.parameters.clone()}}
}
pub(super) fn installation_status(request:&Request,value:&Value)->Result<Value,String>{
 let failure="Gateway installation did not positively verify that exact original request; its fence remains";
 if request.operation!="gateway_install_status"||!exact(value,&["schema","request_sha256","request","installation","origin_verified","install_audit_verified","grant_absent","services_started"])
  ||value["schema"]!="nodenetwork-gateway-install-status-v1"||value["request_sha256"]!=request.parameters["request_sha256"]
  ||["origin_verified","install_audit_verified","grant_absent"].iter().any(|k|value[*k]!=true)||value["services_started"]!=false{return Err(failure.into())}
 let original:Request=serde_json::from_value(value["request"].clone()).map_err(|_|failure)?;
 if original.operation!="gateway_install"||original.validate()!=Ok(true)||original.approval_id()!=request.parameters["request_sha256"]{return Err(failure.into())}
 let installed=crate::node_controller::gateway_install_reply(&original,&json!({"version":1,"ok":true,"result":value["installation"]})).map_err(|_|failure)?;
 let mut projected=value.clone();projected["installation"]=installed["result"].clone();Ok(projected)
}
pub(super) fn reviewed_mutation(request:&Request,reply:&Value)->Result<Value,String>{
 if reply["version"]!=1||reply["ok"]!=true||!exact(reply,&["version","ok","result"]){return Err("Gateway target native preflight refused; no grant was staged".into())}
 match request.operation.as_str(){
  "gateway_install"=>{crate::node_controller::install_preflight_reply(request,reply).map_err(String::from)?;Ok(reply["result"].clone())},
  "gateway_target_commission"=>commission_preflight(request,&reply["result"]),
  "gateway_target_generate"=>{
   let value=review(&reply["result"],false)?;
   if value["state"]!="ready"||value["available"]!=true||value["genesis_sha256"]!=request.parameters["genesis_sha256"]{return Err("The native verified gateway origin changed or custody already exists; no grant was staged".into())}Ok(value)
  },
  _=>Err("Unsupported gateway target mutation review".into()),
 }
}
pub(super) fn acknowledgement(request:&Request,reply:&Value)->Result<Value,String>{
 if reply["version"]!=1||reply["ok"]!=true||!exact(reply,&["version","ok","result"]){return Err("Gateway target outcome uncertain; reconcile the original request before another change".into())}
 if request.operation=="gateway_install"{return crate::node_controller::gateway_install_reply(request,reply).map_err(String::from)}
 let value=review(&reply["result"],false)?;
 let matched=match request.operation.as_str(){
  "gateway_target_generate"=>value["state"]=="identity_ready"&&value["generation_request_sha256"]==request.approval_id()&&value["genesis_sha256"]==request.parameters["genesis_sha256"],
  "gateway_target_commission"=>value["state"]=="commissioned"&&value["commission_request_sha256"]==request.approval_id()&&["admission_sha256","configuration_sha256"].iter().all(|k|value[*k]==request.parameters[*k]),
  _=>false,
 };
 if !matched{return Err("Gateway target acknowledgement differs from the exact original request".into())}Ok(reply.clone())
}
pub(super) fn reconciliation(request:&Request,value:&Value)->Result<&'static str,String>{
 let value=review(value,false)?;
 if matches!(value["state"].as_str(),Some("identity_ready"|"commissioned"))&&value["generation_request_sha256"]==request.parameters["request_sha256"]{return Ok("gateway_target_generate")}
 if value["state"]=="commissioned"&&value["commission_request_sha256"]==request.parameters["request_sha256"]{return Ok("gateway_target_commission")}
 Err("Gateway target did not positively verify that exact original dispatch; its fence remains".into())
}

#[cfg(test)]mod tests{
 use super::*;
 fn status(state:&str)->Value{
  let mut v=json!({"schema":"nodenetwork-gateway-target-v1","available":true,"blocker":null,"state":state,"network_id":"synergy-posy-canary-test","chain_id":"99999","genesis_sha256":"a".repeat(64),"generation_request_sha256":null,"gateway_address":null,"enrollment_sha256":null,"commission_request_sha256":null,"admission_sha256":null,"configuration_sha256":null,"transport_custody_verified":false,"services_started":false,"public_listener":false,"production_qualified":false,"automatic_retry":false});
  if matches!(state,"identity_ready"|"commissioned"){v["generation_request_sha256"]=json!("b".repeat(64));v["gateway_address"]=json!("synv5abc123");v["enrollment_sha256"]=json!(digest(b"{}"));}
  if state=="commissioned"{for k in ["commission_request_sha256","admission_sha256","configuration_sha256"]{v[k]=json!("c".repeat(64))}v["transport_custody_verified"]=json!(true)}v
 }
 fn commission()->Request{
  let a="{\"public\":true}";let c=json!({"node_configuration":{},"relay_specification":{"listen_address":"127.0.0.1:8552","role":{"kind":"gateway"}}}).to_string();
  Request{version:1,operation:"gateway_target_commission".into(),parameters:json!({"admission_json":a,"admission_sha256":digest(a.as_bytes()),"configuration_json":c,"configuration_sha256":digest(c.as_bytes())})}
 }
 #[test]fn requests_are_exact_and_no_custody_or_service_operation_is_accepted(){
  let r=commission();assert_eq!(r.validate(),Ok(true));
  for (key,v)in [("admission_sha256",json!("0".repeat(64))),("configuration_json",json!("{}")),("unlock",json!("private"))]{let mut bad=r.clone();bad.parameters[key]=v;assert!(bad.validate().is_err())}
  let mut r=Request{version:1,operation:"gateway_target_generate".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};assert_eq!(r.validate(),Ok(true));
  for op in ["gateway_target_start","gateway_target_copy_keys","gateway_target_reset"]{r.operation=op.into();assert!(r.validate().is_err())}
 }
 #[test]fn public_status_cannot_claim_activation_or_unaudited_identity(){
  for state in ["ready","identity_ready","commissioned"]{assert!(review(&status(state),false).is_ok())}
  for(k,v)in[("services_started",json!(true)),("public_listener",json!(true)),("production_qualified",json!(true)),("automatic_retry",json!(true)),("transport_custody_verified",json!(true)),("admission_sha256",json!("a".repeat(64))),("extra",json!(false))]{let mut bad=status("identity_ready");bad[k]=v;assert!(review(&bad,false).is_err())}
  let mut export=status("identity_ready");export["enrollment_json"]=json!("{}");assert!(review(&export,true).is_ok());export["enrollment_json"]=json!("{ }");assert!(review(&export,true).is_err());
 }
 #[test]fn exact_positive_reconciliation_only(){
  let mut r=Request{version:1,operation:"gateway_target_reconcile".into(),parameters:json!({"request_sha256":"b".repeat(64)})};
  assert_eq!(reconciliation(&r,&status("identity_ready")).unwrap(),"gateway_target_generate");r.parameters["request_sha256"]=json!("c".repeat(64));assert_eq!(reconciliation(&r,&status("commissioned")).unwrap(),"gateway_target_commission");r.parameters["request_sha256"]=json!("9".repeat(64));assert!(reconciliation(&r,&status("commissioned")).is_err());
  let mut absent=status("ready");absent["available"]=json!(false);absent["blocker"]=json!("owner_unavailable");absent["state"]=json!("absent");for k in ["network_id","chain_id","genesis_sha256"]{absent[k]=Value::Null}assert!(review(&absent,false).is_ok());assert!(reconciliation(&r,&absent).is_err());
 }
 #[test]fn generation_pregrant_binds_verified_origin_and_rejects_existing_custody(){
  let r=Request{version:1,operation:"gateway_target_generate".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
  assert!(reviewed_mutation(&r,&json!({"version":1,"ok":true,"result":status("ready")})).is_ok());
  assert!(reviewed_mutation(&r,&json!({"version":1,"ok":true,"result":status("identity_ready")})).is_err());let mut bad=status("ready");bad["genesis_sha256"]=json!("9".repeat(64));assert!(reviewed_mutation(&r,&json!({"version":1,"ok":true,"result":bad})).is_err());
 }
 #[test]fn commission_pregrant_and_acknowledgement_bind_exact_future_request(){
  let r=commission();let mut v=json!({"schema":"nodenetwork-gateway-target-commission-preflight-v1","ready":true,"request_sha256":r.approval_id(),"network_id":"synergy-posy-canary-test","chain_id":"99999","genesis_sha256":"a".repeat(64),"gateway_address":"synv5abc123","enrollment_sha256":"b".repeat(64),"admission_sha256":r.parameters["admission_sha256"],"configuration_sha256":r.parameters["configuration_sha256"],"transport_custody_verified":true,"mutation_performed":false,"services_started":false,"public_listener":false,"production_qualified":false});
  assert!(commission_preflight(&r,&v).is_ok());v["request_sha256"]=json!("9".repeat(64));assert!(commission_preflight(&r,&v).is_err());
  let mut done=status("commissioned");done["commission_request_sha256"]=json!(r.approval_id());for k in ["admission_sha256","configuration_sha256"]{done[k]=r.parameters[k].clone()}assert!(acknowledgement(&r,&json!({"version":1,"ok":true,"result":done})).is_ok());done["commission_request_sha256"]=json!("9".repeat(64));assert!(acknowledgement(&r,&json!({"version":1,"ok":true,"result":done})).is_err());
 }
 #[test]fn install_recovery_requires_exact_original_request_role_and_consumed_audit(){
  let original=Request{version:1,operation:"gateway_install".into(),parameters:json!({"release_id":"candidate-1","manifest_sha256":"a".repeat(64),"network_id":"synergy-posy-canary-test","chain_id":99999,"node_name":"gateway-01"})};
  let read=Request{version:1,operation:"gateway_install_status".into(),parameters:json!({"request_sha256":original.approval_id()})};
  let receipt=json!({"format":"synergy-universal-linux-v1","root":"/opt/synergy","role":"rpc_gateway","network_id":"synergy-posy-canary-test","chain_id":99999,"node_name":"gateway-01","package_sha256":"a".repeat(64),"package_files":{"bin/synergy-node":"b".repeat(64)},"consensus_started":false,"host_integrations":[]});
  let v=json!({"schema":"nodenetwork-gateway-install-status-v1","request_sha256":original.approval_id(),"request":original.canonical(),"installation":receipt,"origin_verified":true,"install_audit_verified":true,"grant_absent":true,"services_started":false});
  assert_eq!(installation_status(&read,&v).unwrap()["installation"]["schema"],"nodenetwork-installed-gateway-v1");
  for(k,changed)in [("grant_absent",json!(false)),("install_audit_verified",json!(false)),("request_sha256",json!("9".repeat(64))),("extra",json!(true))]{let mut bad=v.clone();bad[k]=changed;assert!(installation_status(&read,&bad).is_err())}
  let mut bad=v;bad["installation"]["role"]=json!("validator");assert!(installation_status(&read,&bad).is_err());
 }
}
