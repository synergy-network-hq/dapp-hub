//! Engineering-only gateway admission issuer adapter. Admission does not commission a service.
use crate::node_controller::Request;
use serde_json::Value;
use sha2::{Digest,Sha256};
pub(super) const PURPOSE:&str="engineering-rpc-gateway-admission-v1";
pub(super) fn exact(v:&Value,keys:&[&str])->bool{v.as_object().is_some_and(|m|m.len()==keys.len()&&keys.iter().all(|k|m.contains_key(*k)))}
pub(super) fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}
fn text(v:&Value,max:usize)->bool{v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=max&&!s.contains('\0'))}
fn address(v:&Value)->bool{v.as_str().is_some_and(|s|s.starts_with("synv5")&&s.len()>5&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()))}
fn network(v:&Value)->bool{v.as_str().is_some_and(|s|s.starts_with("synergy-posy-canary-")&&s.len()<=128&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-'))}
pub(super) fn digest(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
pub(super) fn purpose(request:&Request)->Result<&str,String>{
 let p=&request.parameters;
 let raw=p["purpose_approval_json"].as_str().filter(|s|!s.is_empty()&&s.len()<=16384).ok_or("Review a bounded exact public gateway purpose approval")?;
 let v:Value=serde_json::from_str(raw).map_err(|_|"Malformed public gateway purpose approval")?;
 if !exact(&v,&["format","purpose","formation_sha256","transport_review_sha256","issuer_root_sha256","gateway_enrollment_sha256","genesis_sha256","authority_sha256","registry_sha256","valid_from_unix","expires_at_unix"])
  ||v["format"]!="synergy-engineering-gateway-purpose-v1"||v["purpose"]!=PURPOSE||digest(raw.as_bytes())!=p["purpose_approval_sha256"]
  ||["formation_sha256","transport_review_sha256","valid_from_unix","expires_at_unix"].iter().any(|k|v[*k]!=p[*k])
  ||!["formation_sha256","transport_review_sha256","issuer_root_sha256","gateway_enrollment_sha256","genesis_sha256","authority_sha256","registry_sha256"].iter().all(|k|pin(&v[*k]))
  ||v["gateway_enrollment_sha256"]!=digest(p["gateway_enrollment_json"].as_str().ok_or("Public gateway enrollment required")?.as_bytes()){
  return Err("Gateway purpose approval differs from the exact reviewed enrollment and signed origin".into())
 }Ok(raw)
}
pub(super) fn validate(request:&Request)->Result<bool,String>{
 let p=&request.parameters;
 let mutation=match request.operation.as_str(){
  "gateway_admission_status"|"gateway_admission_export" if exact(p,&[])=>false,
  "gateway_admission_reconcile" if exact(p,&["request_sha256"])&&pin(&p["request_sha256"])=>false,
  "gateway_admission_sign" if exact(p,&["review_sha256","purpose_approval_sha256"])&&pin(&p["review_sha256"])&&pin(&p["purpose_approval_sha256"])=>true,
  "gateway_admission_prepare"|"gateway_admission_preflight" if exact(p,&["formation_sha256","transport_review_sha256","gateway_enrollment_json","purpose_approval_json","purpose_approval_sha256","valid_from_unix","expires_at_unix"])=>{
   if !["formation_sha256","transport_review_sha256","purpose_approval_sha256"].iter().all(|k|pin(&p[*k]))||!text(&p["gateway_enrollment_json"],128*1024){return Err("Bounded exact public gateway enrollment and origin pins required".into())}
   let from=p["valid_from_unix"].as_u64().filter(|n|*n>0&&*n<1<<53).ok_or("Invalid gateway validity")?;
   let until=p["expires_at_unix"].as_u64().filter(|n|*n<1<<53).ok_or("Invalid gateway expiration")?;
   if until<=from||until-from>7*86400{return Err("Gateway admission must fit a seven-day engineering window".into())}
   purpose(request)?;request.operation=="gateway_admission_prepare"
  },
  _=>return Err("Unsupported exact gateway admission operation; paths, secrets and service commands are forbidden".into()),
 };
 if mutation&&!cfg!(debug_assertions){return Err("Gateway admission issuance is isolated engineering only".into())}
 Ok(mutation)
}

pub(super) fn preflight(request:&Request,value:&Value)->Result<Value,String>{
 let mut prepare=request.clone();prepare.operation="gateway_admission_prepare".into();validate(&prepare)?;
 let fail=||"Gateway admission preflight did not verify the exact additional purpose and current signed origin".to_string();
 if !exact(value,&["schema","ready","request_sha256","formation_sha256","transport_review_sha256","issuer_root_sha256","purpose_approval_sha256","genesis_sha256","authority_sha256","registry_sha256","gateway_enrollment_sha256","gateway_address","network_id","chain_id","valid_from_unix","expires_at_unix","mutation_performed","services_started","public_listener","production_qualified"])
 ||value["schema"]!="nodenetwork-gateway-admission-preflight-v1"||value["ready"]!=true||value["request_sha256"]!=prepare.approval_id()
 ||["formation_sha256","transport_review_sha256","purpose_approval_sha256","valid_from_unix","expires_at_unix"].iter().any(|k|value[*k]!=prepare.parameters[*k])
 ||["mutation_performed","services_started","public_listener","production_qualified"].iter().any(|k|value[*k]!=false)
 ||!["request_sha256","formation_sha256","transport_review_sha256","issuer_root_sha256","purpose_approval_sha256","genesis_sha256","authority_sha256","registry_sha256","gateway_enrollment_sha256"].iter().all(|k|pin(&value[*k]))
 ||value["chain_id"]!="99999"||!network(&value["network_id"])||!address(&value["gateway_address"]){return Err(fail())}
 let approval:Value=serde_json::from_str(purpose(&prepare)?).map_err(|_|fail())?;
 if ["issuer_root_sha256","genesis_sha256","authority_sha256","registry_sha256","gateway_enrollment_sha256"].iter().any(|k|value[*k]!=approval[*k]){return Err(fail())}
 Ok(value.clone())
}

pub(super) fn review(value:&Value,export:bool)->Result<Value,String>{
 let fail=||"Unsupported verified gateway admission review; no service or journal outcome was inferred".to_string();
 let mut keys=vec!["schema","pending","signed","request_sha256","review_sha256","purpose_approval_sha256","formation_sha256","network_id","chain_id","genesis_sha256","authority_sha256","registry_sha256","gateway_address","gateway_enrollment_sha256","valid_from_unix","expires_at_unix","admission_sha256","sign_request_sha256","gateway_commissioned","services_started","public_listener","production_qualified","automatic_retry","available","blocker"];
 if export{keys.push("admission_json")}
 if !exact(value,&keys)||value["schema"]!="nodenetwork-gateway-admission-v1"||["gateway_commissioned","services_started","public_listener","production_qualified","automatic_retry"].iter().any(|k|value[*k]!=false){return Err(fail())}
 if value["pending"]==false{
  if export||value["signed"]!=false||!(value["available"]==true&&value["blocker"].is_null()||value["available"]==false&&["gateway_runtime_or_origin_unavailable","gateway_purpose_approval_required"].iter().any(|s|value["blocker"]==*s))
  ||keys[3..18].iter().any(|k|!value[*k].is_null()){return Err(fail())}
 }else{
  if value["pending"]!=true||value["available"]!=true||!value["blocker"].is_null()||!value["signed"].is_boolean()
  ||!["request_sha256","review_sha256","purpose_approval_sha256","formation_sha256","genesis_sha256","authority_sha256","registry_sha256","gateway_enrollment_sha256"].iter().all(|k|pin(&value[*k]))
  ||!address(&value["gateway_address"])||!network(&value["network_id"])||value["chain_id"]!="99999"{return Err(fail())}
  let from=value["valid_from_unix"].as_u64().filter(|n|*n>0&&*n<1<<53).ok_or_else(fail)?;let until=value["expires_at_unix"].as_u64().filter(|n|*n<1<<53).ok_or_else(fail)?;
  if until<=from||until-from>604800{return Err(fail())}
  if value["signed"]==true{if !pin(&value["admission_sha256"])||!pin(&value["sign_request_sha256"]){return Err(fail())}}
  else if !value["admission_sha256"].is_null()||!value["sign_request_sha256"].is_null()||export{return Err(fail())}
 }
 if export{let raw=value["admission_json"].as_str().filter(|s|!s.is_empty()&&s.len()<=128*1024).ok_or_else(fail)?;if digest(raw.as_bytes())!=value["admission_sha256"]{return Err(fail())}}
 Ok(value.clone())
}

pub(super) fn acknowledgement(request:&Request,reply:&Value)->Result<Value,String>{
 if reply["version"]!=1||reply["ok"]!=true||!exact(reply,&["version","ok","result"]){return Err("Gateway admission outcome is uncertain or refused; reconcile the exact original request before another change".into())}
 let result=review(&reply["result"],false)?;
 let matches=if request.operation=="gateway_admission_prepare"{result["pending"]==true&&result["signed"]==false&&result["request_sha256"]==request.approval_id()&&["formation_sha256","purpose_approval_sha256","valid_from_unix","expires_at_unix"].iter().all(|k|result[*k]==request.parameters[*k])&&result["gateway_enrollment_sha256"]==digest(request.parameters["gateway_enrollment_json"].as_str().ok_or("Missing gateway enrollment")?.as_bytes())}
 else{result["signed"]==true&&result["sign_request_sha256"]==request.approval_id()&&["review_sha256","purpose_approval_sha256"].iter().all(|k|result[*k]==request.parameters[*k])};
 if !matches{return Err("Gateway admission acknowledgement differs from the exact immutable review".into())}Ok(reply.clone())
}

pub(super) fn reconciliation(request:&Request,result:&Value)->Result<Option<&'static str>,String>{
 let result=review(result,false)?;
 if result["pending"]==false{return Ok(None)}
 if result["request_sha256"]==request.parameters["request_sha256"]{return Ok(Some("gateway_admission_prepare"))}
 if result["signed"]==true&&result["sign_request_sha256"]==request.parameters["request_sha256"]{return Ok(Some("gateway_admission_sign"))}
 Err("Gateway admission observation does not confirm the requested original dispatch; its fence remains".into())
}
pub(super) fn reviewed_mutation(request:&Request,reply:&Value)->Result<Value,String>{
 if reply["version"]!=1||reply["ok"]!=true||!exact(reply,&["version","ok","result"]){return Err("The installed master could not verify its gateway issuer capability and exact purpose; no grant was staged".into())}
 let result=if request.operation=="gateway_admission_prepare"{preflight(request,&reply["result"])?}else{
  let v=review(&reply["result"],false)?;
  if v["pending"]!=true||v["signed"]!=false||["review_sha256","purpose_approval_sha256"].iter().any(|k|v[*k]!=request.parameters[*k]){return Err("Read the exact unsigned gateway admission before signing; no grant was staged".into())}v
 };
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if result["expires_at_unix"].as_u64().is_none_or(|n|n<=now){return Err("Gateway admission review expired; no grant was staged".into())}Ok(result)
}

#[cfg(test)]mod tests{
 use super::*;use serde_json::json;
 fn prepare()->Request{let enrollment="{\"public\":true}";let p=json!({"format":"synergy-engineering-gateway-purpose-v1","purpose":PURPOSE,"formation_sha256":"a".repeat(64),"transport_review_sha256":"b".repeat(64),"issuer_root_sha256":"c".repeat(64),"gateway_enrollment_sha256":digest(enrollment.as_bytes()),"genesis_sha256":"d".repeat(64),"authority_sha256":"e".repeat(64),"registry_sha256":"f".repeat(64),"valid_from_unix":1000,"expires_at_unix":2000}).to_string();Request{version:1,operation:"gateway_admission_prepare".into(),parameters:json!({"formation_sha256":"a".repeat(64),"transport_review_sha256":"b".repeat(64),"gateway_enrollment_json":enrollment,"purpose_approval_sha256":digest(p.as_bytes()),"purpose_approval_json":p,"valid_from_unix":1000,"expires_at_unix":2000})}}
 #[test]fn gateway_request_requires_separate_exact_purpose_and_no_commands(){
  let r=prepare();assert_eq!(validate(&r),Ok(true));
  for (key,v)in[("gateway_enrollment_json",json!("{}")),("formation_sha256",json!("0".repeat(64))),("expires_at_unix",json!(999)),("purpose_approval_sha256",json!("0".repeat(64))),("path",json!("/tmp/input"))]{let mut bad=prepare();bad.parameters[key]=v;assert!(validate(&bad).is_err())}
  for op in ["gateway_start","gateway_commission","gateway_admission_remove"]{let mut bad=prepare();bad.operation=op.into();assert!(validate(&bad).is_err())}
 }
 #[test]fn gateway_read_and_sign_scopes_are_closed(){
  for op in ["gateway_admission_status","gateway_admission_export"]{let r=Request{version:1,operation:op.into(),parameters:json!({})};assert_eq!(validate(&r),Ok(false));}
  let mut r=Request{version:1,operation:"gateway_admission_reconcile".into(),parameters:json!({"request_sha256":"a".repeat(64)})};assert_eq!(validate(&r),Ok(false));r.parameters["force"]=json!(true);assert!(validate(&r).is_err());
  let mut r=Request{version:1,operation:"gateway_admission_sign".into(),parameters:json!({"review_sha256":"a".repeat(64),"purpose_approval_sha256":"b".repeat(64)})};assert_eq!(validate(&r),Ok(true));r.parameters["purpose_approval_json"]=json!("{}");assert!(validate(&r).is_err());
 }
 fn pending()->Value{json!({"schema":"nodenetwork-gateway-admission-v1","pending":true,"signed":false,"request_sha256":"a".repeat(64),"review_sha256":"b".repeat(64),"purpose_approval_sha256":"c".repeat(64),"formation_sha256":"d".repeat(64),"network_id":"synergy-posy-canary-20261117","chain_id":"99999","genesis_sha256":"e".repeat(64),"authority_sha256":"f".repeat(64),"registry_sha256":"1".repeat(64),"gateway_address":"synv5abc123","gateway_enrollment_sha256":"2".repeat(64),"valid_from_unix":1000,"expires_at_unix":2000,"admission_sha256":null,"sign_request_sha256":null,"gateway_commissioned":false,"services_started":false,"public_listener":false,"production_qualified":false,"automatic_retry":false,"available":true,"blocker":null})}
 #[test]fn gateway_review_cannot_claim_service_success_or_reconcile_a_foreign_request(){
  let v=pending();assert!(review(&v,false).is_ok());
  for(key,value)in[("gateway_commissioned",json!(true)),("services_started",json!(true)),("production_qualified",json!(true)),("public_listener",json!(true)),("automatic_retry",json!(true)),("extra",json!(false)),("gateway_address",json!("synv1abc")),("chain_id",json!(99999)),("signed",json!(true))]{let mut bad=pending();bad[key]=value;assert!(review(&bad,false).is_err())}
  let mut r=Request{version:1,operation:"gateway_admission_reconcile".into(),parameters:json!({"request_sha256":"a".repeat(64)})};assert_eq!(reconciliation(&r,&v).unwrap(),Some("gateway_admission_prepare"));r.parameters["request_sha256"]=json!("9".repeat(64));assert!(reconciliation(&r,&v).is_err());
  let mut signed=v;signed["signed"]=json!(true);signed["admission_sha256"]=json!("8".repeat(64));signed["sign_request_sha256"]=r.parameters["request_sha256"].clone();assert_eq!(reconciliation(&r,&signed).unwrap(),Some("gateway_admission_sign"));
 }
 #[test]fn gateway_preflight_binds_prepare_digest_origin_and_public_purpose(){
  let r=prepare();let approval:Value=serde_json::from_str(r.parameters["purpose_approval_json"].as_str().unwrap()).unwrap();let mut v=json!({"schema":"nodenetwork-gateway-admission-preflight-v1","ready":true,"request_sha256":r.approval_id(),"formation_sha256":r.parameters["formation_sha256"],"transport_review_sha256":r.parameters["transport_review_sha256"],"issuer_root_sha256":approval["issuer_root_sha256"],"purpose_approval_sha256":r.parameters["purpose_approval_sha256"],"genesis_sha256":approval["genesis_sha256"],"authority_sha256":approval["authority_sha256"],"registry_sha256":approval["registry_sha256"],"gateway_enrollment_sha256":approval["gateway_enrollment_sha256"],"gateway_address":"synv5abc123","network_id":"synergy-posy-canary-20261117","chain_id":"99999","valid_from_unix":1000,"expires_at_unix":2000,"mutation_performed":false,"services_started":false,"public_listener":false,"production_qualified":false});assert!(preflight(&r,&v).is_ok());v["registry_sha256"]=json!("0".repeat(64));assert!(preflight(&r,&v).is_err());v["registry_sha256"]=approval["registry_sha256"].clone();v["request_sha256"]=json!("0".repeat(64));assert!(preflight(&r,&v).is_err());
 }
}
