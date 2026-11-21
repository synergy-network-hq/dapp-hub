//! Candidate Linux origin/crypto smoke observation; no upgrade approval or process qualification.
use crate::{gateway_admission::{exact,pin},node_controller::Request};
use serde_json::Value;
const PINS:&[&str]=&["manifest_sha256","provider_report_sha256","genesis_sha256","authority_sha256","authority_root_sha256","registry_sha256","issuer_root_sha256","network_manifest_sha256","candidate_node_sha256"];
const TRUE:&[&str]=&["native_origin_verified","package_verified"];
const FALSE:&[&str]=&["mutation_performed","keys_generated","services_started","network_qualified","production_qualified","automatic_retry"];
pub(super) fn review(request:&Request,value:&Value,scope:&Value)->Result<Value,String>{
 let mut fields=vec!["schema","release_id","network_id","chain_id"];fields.extend_from_slice(PINS);fields.extend_from_slice(TRUE);fields.extend_from_slice(FALSE);
 let fail=||"Candidate Linux origin/crypto smoke was not independently correlated; no upgrade or network qualification was inferred".to_string();
 if request.operation!="upgrade_native_preflight"||!exact(&request.parameters,&["release_id","manifest_sha256"])||!exact(value,&fields)
  ||value["schema"]!="nodenetwork-upgrade-native-preflight-v1"||["release_id","manifest_sha256"].iter().any(|k|value[*k]!=request.parameters[*k])
  ||PINS.iter().any(|k|!pin(&value[*k]))||TRUE.iter().any(|k|value[*k]!=true)||FALSE.iter().any(|k|value[*k]!=false)
  ||!value["network_id"].as_str().is_some_and(|s|s.starts_with("synergy-posy-canary-")&&s.len()>20&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-'))||value["chain_id"]!="99999"||value["network_id"]!=scope["network_id"]||value["chain_id"]!=scope["chain_id"]{return Err(fail())}
 let origins=[("genesis_sha256","genesis.json"),("authority_sha256","authority.json"),("authority_root_sha256","authority-root.pub"),("registry_sha256","transport-registry.json"),("issuer_root_sha256","transport-root.pub"),("network_manifest_sha256","network-manifest.json")];
 for (field,name) in origins{
  let expected=&scope["origin_pins"][name];
  // Genesis3 is mandatory. Other independent pins are compared when retained.
  if (matches!(name,"genesis.json"|"authority.json"|"authority-root.pub")||!expected.is_null())&&(!pin(expected)||value[field]!=*expected){return Err(fail())}
 }
 Ok(value.clone())
}
#[cfg(test)]mod tests{
 use super::*;use serde_json::json;
 fn fixture()->(Request,Value,Value){
  let p="a".repeat(64);let request=Request{version:1,operation:"upgrade_native_preflight".into(),parameters:json!({"release_id":"candidate","manifest_sha256":p})};
  let mut value=json!({"schema":"nodenetwork-upgrade-native-preflight-v1","release_id":"candidate","network_id":"synergy-posy-canary-test","chain_id":"99999"});for k in PINS{value[*k]=json!(p)}for k in TRUE{value[*k]=json!(true)}for k in FALSE{value[*k]=json!(false)}
  let scope=json!({"network_id":value["network_id"],"chain_id":"99999","origin_pins":{"genesis.json":p,"authority.json":p,"authority-root.pub":p,"transport-registry.json":p,"transport-root.pub":p,"network-manifest.json":p}});(request,value,scope)
 }
 #[test]fn runtime_probe_is_read_only_and_exactly_bound(){let(r,v,s)=fixture();assert_eq!(r.validate(),Ok(false));assert!(review(&r,&v,&s).is_ok());
  for k in PINS{let mut bad=v.clone();bad[*k]=json!("foreign");assert!(review(&r,&bad,&s).is_err())}
  for k in FALSE{let mut bad=v.clone();bad[*k]=json!(true);assert!(review(&r,&bad,&s).is_err())}
  for k in TRUE{let mut bad=v.clone();bad[*k]=json!(false);assert!(review(&r,&bad,&s).is_err())}
 }
 #[test]fn runtime_probe_rejects_foreign_origin_selection_and_missing_evidence(){let(r,v,s)=fixture();
  for k in ["genesis_sha256","authority_sha256","authority_root_sha256","registry_sha256","issuer_root_sha256","network_manifest_sha256","manifest_sha256"]{let mut bad=v.clone();bad[k]=json!("b".repeat(64));assert!(review(&r,&bad,&s).is_err())}
  for k in ["release_id","network_id","chain_id"]{let mut bad=v.clone();bad[k]=json!("other");assert!(review(&r,&bad,&s).is_err())}
  let mut missing=s.clone();missing["origin_pins"]["genesis.json"]=Value::Null;assert!(review(&r,&v,&missing).is_err());let mut extra=v;extra["full_process_qualified"]=json!(true);assert!(review(&r,&extra,&s).is_err());
 }
}
