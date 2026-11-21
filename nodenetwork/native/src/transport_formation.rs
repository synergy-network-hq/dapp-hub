//! Public transport formation inputs and exports. APQE verification stays in the master.
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeSet,path::Path};
const LIMIT:usize=2*1024*1024;
fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)))}
fn sha(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
pub fn prepare(path:&Path,current:&Value)->Result<crate::node_controller::Request,String>{
 use std::io::Read;
 let meta=path.symlink_metadata().map_err(|_|"Transport request is inaccessible")?;
 if !meta.is_file()||meta.len()==0||meta.len()>LIMIT as u64{return Err("Select a bounded public transport request JSON file".into())}
 let mut bytes=Vec::new();std::fs::File::open(path).and_then(|f|f.take(LIMIT as u64+1).read_to_end(&mut bytes)).map_err(|_|"Cannot read public transport request")?;
 if bytes.len()>LIMIT{return Err("Transport request exceeds its limit".into())}
 let request:crate::node_controller::Request=serde_json::from_slice(&bytes).map_err(|_|"Invalid public transport request")?;
 request.validate()?;
 if request.operation!="network_transport_prepare"||current["pending"]!=false{return Err("Read the unprepared transport status before creating issuer custody".into())}
 for field in ["formation_sha256","genesis_review_sha256","target_provider_report_sha256"]{if !pin(&current[field])||request.parameters[field]!=current[field]{return Err("Transport request changes the authenticated formation, Genesis or installed APQE provider".into())}}
 Ok(request)
}
pub fn review(value:&Value)->Result<Value,String>{
 let fields=["schema","pending","signed","formation_sha256","genesis_review_sha256","target_provider_report_sha256","network_id","chain_id","request_sha256","review_sha256","genesis_sha256","authority_sha256","issuer_root_sha256","valid_from_unix","expires_at_unix","validator_addresses","runtime_admission","fleet_readiness_verified","registry_sha256","sign_request_sha256"];
 if !value.as_object().is_some_and(|m|m.keys().all(|k|fields.contains(&k.as_str()))){return Err("Transport review contains unexpected or private fields".into())}
 if value["schema"]!="nodenetwork-network-transport-v1"||!value["pending"].is_boolean(){return Err("Unsupported authenticated transport review".into())}
 if value["pending"]==false{return Ok(value.clone())}
 for field in ["formation_sha256","genesis_review_sha256","request_sha256","review_sha256","genesis_sha256","authority_sha256","issuer_root_sha256"]{if !pin(&value[field]){return Err("Incomplete transport commitment review".into())}}
 let addresses=value["validator_addresses"].as_array().ok_or("Missing transport members")?;
 if addresses.len()!=5||addresses.iter().any(|v|v.as_str().is_none_or(|s|s.is_empty()||s.len()>256))||addresses.iter().filter_map(Value::as_str).collect::<BTreeSet<_>>().len()!=5||!value["signed"].is_boolean()||value["runtime_admission"]!=false||value["fleet_readiness_verified"]!=false{return Err("Transport issuance cannot establish runtime readiness".into())}
 if value["signed"]==true&&(!pin(&value["registry_sha256"])||!pin(&value["sign_request_sha256"])){return Err("Incomplete signed transport review".into())}
 Ok(value.clone())
}
pub const ARTIFACTS:[&str;8]=["network/genesis.json","network/authority.json","network/authority-root.pub","network/network-manifest.json","network/transport-registry.json","network/transport-root.pub","config/node.json","config/start-authorized.json"];
pub type PublicFiles=Vec<Vec<(&'static str,Vec<u8>)>>;
pub fn export(value:&Value,expected:&Value)->Result<PublicFiles,String>{
 let expected=review(expected)?;
 if expected["signed"]!=true||value["schema"]!="nodenetwork-network-transport-export-v1"||value["fleet_readiness_verified"]!=false{return Err("Only signed public commissioning drafts can be exported".into())}
 for field in ["review_sha256","registry_sha256","issuer_root_sha256"]{if value[field]!=expected[field]{return Err("Public transport export changed after review".into())}}
 let nodes=value["nodes"].as_array().filter(|n|n.len()==5).ok_or("Five public commissioning drafts required")?;
 let mut seen=BTreeSet::new();let mut output=Vec::new();let mut size=0usize;
 for node in nodes{
  let address=node["address"].as_str().ok_or("Missing exported validator address")?;
  if !expected["validator_addresses"].as_array().unwrap().iter().any(|v|v==address)||!seen.insert(address){return Err("Exported validator membership differs".into())}
  let artifacts=node["artifacts"].as_object().filter(|a|a.len()==ARTIFACTS.len()).ok_or("Exact eight public artifacts required")?;
  let mut files=Vec::new();
  for name in ARTIFACTS{
   let text=artifacts.get(name).and_then(Value::as_str).ok_or("Missing exact public transport artifact")?;
   let bytes=if name.ends_with(".pub"){let bytes=STANDARD.decode(text).map_err(|_|"Invalid public root encoding")?;let length=if name=="network/authority-root.pub"{1952}else{2592};if bytes.len()!=length||STANDARD.encode(&bytes)!=text{return Err("Unexpected public APQE root".into())}bytes}else{serde_json::from_str::<Value>(text).map_err(|_|"Public transport artifact is not JSON")?;text.as_bytes().to_vec()};
   size=size.checked_add(bytes.len()).ok_or("Public export exceeds bound")?;if bytes.is_empty()||size>4*1024*1024{return Err("Public transport export exceeds its bound".into())}
   let field=match name{"network/genesis.json"=>Some("genesis_sha256"),"network/authority.json"=>Some("authority_sha256"),"network/transport-registry.json"=>Some("registry_sha256"),"network/transport-root.pub"=>Some("issuer_root_sha256"),_=>None};
   if field.is_some_and(|field|sha(&bytes)!=expected[field]){return Err("Public artifact differs from its authenticated transport review".into())}
   files.push((name,bytes));
  }
  output.push(files);
 }
 Ok(output)
}
pub fn summary(value:&Value)->Value{json!({"review_sha256":value["review_sha256"],"registry_sha256":value["registry_sha256"],"issuer_root_sha256":value["issuer_root_sha256"],"node_count":5,"fleet_readiness_verified":false,"runtime_admission":false})}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn public_transport_export_rejects_changed_review_and_invented_readiness(){
  let a="a".repeat(64);let mut v=json!({"schema":"nodenetwork-network-transport-v1","pending":true,"signed":true,"formation_sha256":a,"genesis_review_sha256":a,"request_sha256":a,"review_sha256":a,"genesis_sha256":a,"authority_sha256":a,"issuer_root_sha256":a,"registry_sha256":a,"sign_request_sha256":a,"validator_addresses":["one","two","three","four","five"],"runtime_admission":false,"fleet_readiness_verified":false});
  assert!(review(&v).is_ok());v["fleet_readiness_verified"]=json!(true);assert!(review(&v).is_err());v["fleet_readiness_verified"]=json!(false);
  let export=json!({"schema":"nodenetwork-network-transport-export-v1","review_sha256":"b".repeat(64),"fleet_readiness_verified":false});assert!(super::export(&export,&v).is_err());
  v["private_key"]=json!("must never reach renderer");assert!(review(&v).is_err());v.as_object_mut().unwrap().remove("private_key");v["validator_addresses"][4]=json!("one");assert!(review(&v).is_err());
 }
}
