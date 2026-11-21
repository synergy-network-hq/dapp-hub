//! Restrictive, independently pinned gateway provider scope. No provider API or key generation.
use crate::node_controller::Request;
use serde_json::Value;
use std::net::IpAddr;
pub(super) const PROFILE:&str="nodenetwork-controlled-gateway-v1";
// Engineering artifact capacity only: profile pins do not confer provider or
// network membership approval. A gateway never falls back to the validator pin.
pub(super) fn provider_pin<'a>(profile:&str,validator:Option<&'a str>,gateway:Option<&'a str>,debug:bool)->Result<&'a str,String>{
 let pin=|v:&str|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b));
 if !debug||validator.is_none_or(|v|!pin(v))||gateway.is_some_and(|g|!pin(g)||Some(g)==validator){return Err("This native build has no distinct independently approved VPN profile pins".into())}
 match profile{PROFILE=>gateway.ok_or_else(||"This native build has no independently approved gateway VPN profile".into()),"nodenetwork-controlled-canary-v1"|"nodenetwork-debug-vpn-provider-v1"=>Ok(validator.unwrap()),_=>Err("Unsupported independently approved VPN profile".into())}
}
pub(super) fn verified_provider_pin<'a>(raw:&str,profile:&str,validator:Option<&'a str>,gateway:Option<&'a str>,debug:bool)->Result<&'a str,String>{
 use sha2::{Digest,Sha256};let pin=provider_pin(profile,validator,gateway,debug)?;
 if format!("{:x}",Sha256::digest(raw.as_bytes()))!=pin{return Err("Selected VPN provider differs from its role-specific compiled independent approval".into())}Ok(pin)
}
const ERROR:&str="Gateway VPN requires its own independently approved TCP 8551 profile and exact signed target scope";
fn exact(v:&Value,keys:&[&str])->bool{v.as_object().is_some_and(|m|m.len()==keys.len()&&keys.iter().all(|k|m.contains_key(*k)))}
pub(super) fn profile_pins(profile: &Value) -> Result<(&str, &str), String> {
 let gateway = &profile["gateway"];
 let approved = |key| gateway[key].as_str().filter(|value| value.len() == 64 && value.bytes()
  .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
 let provider = approved("vpn_provider_sha256").ok_or("The network profile needs an approved gateway-only VPN provider digest")?;
 let locator = approved("vpn_credential_locator_sha256").ok_or("The network profile needs its approved credential locator digest")?;
 Ok((provider, locator))
}

pub(super) fn installed_pins(document: &Value, reply: &Value) -> Result<(String, String), String> {
 crate::operator_authorization::require_gateway_initial(document)?;
 if !exact(reply, &["version", "ok", "result"]) || reply["version"] != 1 || reply["ok"] != true {
  return Err(ERROR.into());
 }
 let raw_result = &reply["result"];
 let result = crate::gateway_target::profile_configuration(raw_result)?;
 let profile = &result["profile"];
 // A legacy observation has no bytes with which to independently check the
 // approval digest. It cannot authorize provider or credential access.
 if !raw_result["profile_json"].is_string() || result["installed"] != true
  || result["profile_sha256"] != document["artifacts"]["network-provisioning.json"]
  || !["network_id", "chain_id", "node_name"].iter().all(|key| profile[*key] == document[*key]) {
  return Err(ERROR.into());
 }
 let (provider, locator) = profile_pins(profile)?;
 Ok((provider.into(), locator.into()))
}

fn tcp(v:&Value)->bool{if !exact(v,&["ip","port"])||v["port"].as_u64()!=Some(8551){return false}let Some(s)=v["ip"].as_str()else{return false};let Ok(ip)=s.parse::<IpAddr>()else{return false};s==ip.to_string()&&!ip.is_unspecified()&&!ip.is_loopback()&&!ip.is_multicast()&&match ip{IpAddr::V4(v)=>!v.is_link_local()&&!v.is_broadcast(),IpAddr::V6(v)=>!v.is_unicast_link_local()}}
pub(super) fn validate(r:&Request)->Result<bool,String>{if r.version!=1||r.operation!="gateway_vpn_preflight"||!exact(&r.parameters,&["required_gateway_tcp"])||!tcp(&r.parameters["required_gateway_tcp"]){return Err(ERROR.into())}Ok(false)}
pub(super) fn selection(policy:&Value,doc:&Value,context:&Value)->Result<Option<Value>,String>{
 let gateway=crate::operator_authorization::require_gateway_initial(doc).is_ok();
 if (policy["profile"]==PROFILE)!=gateway{return Err(ERROR.into())}
 if !gateway{return Ok(None)}
 if policy.get("required_peer_ips").is_some()||!tcp(&policy["required_gateway_tcp"])||!exact(&policy["network_binding"],&["network_id","chain_id","formation_sha256"])||["network_id","chain_id","formation_sha256"].iter().any(|k|policy["network_binding"][*k]!=context[*k]){return Err(ERROR.into())}
 Ok(Some(policy["required_gateway_tcp"].clone()))
}
pub(super) fn preflight(reply:&Value,selected:&Value,tcp:&Value,initial_genesis:&Value)->Result<(),String>{
 if !exact(reply,&["version","ok","result"])||reply["version"]!=1||reply["ok"]!=true{return Err(ERROR.into())}
 let v=&reply["result"];
 if !exact(v,&["schema","required_gateway_tcp","network_id","chain_id","genesis_sha256","mutation_performed","production_qualified"])||v["schema"]!="nodenetwork-gateway-vpn-preflight-v1"||v["required_gateway_tcp"]!=*tcp||selected["state"]!="commissioned"||selected["transport_custody_verified"]!=true||["network_id","chain_id","genesis_sha256"].iter().any(|k|v[*k]!=selected[*k])||v["genesis_sha256"]!=*initial_genesis||v["mutation_performed"]!=false||v["production_qualified"]!=false{return Err(ERROR.into())}Ok(())
}
pub(super) fn enrollment(policy:&Value,hostname:&Value,key:&str,tcp:Option<&Value>)->Result<Vec<u8>,String>{
 #[derive(serde::Serialize)]struct Enrollment<'a>{setup_key:&'a str,management_url:&'a Value,hostname:&'a Value,#[serde(skip_serializing_if="Option::is_none")]required_peer_ips:Option<&'a Value>,#[serde(skip_serializing_if="Option::is_none")]required_gateway_tcp:Option<&'a Value>}
 serde_json::to_vec(&Enrollment{setup_key:key,management_url:&policy["management_origin"],hostname,required_peer_ips:if tcp.is_none(){Some(&policy["required_peer_ips"])}else{None},required_gateway_tcp:tcp}).map_err(|_|"Cannot encode exact private VPN enrollment".into())
}
#[cfg(test)]mod tests{use super::*;use serde_json::json;
 #[test]
 fn profile_bound_vpn_requires_exact_installed_bytes_and_both_approvals() {
  use sha2::{Digest, Sha256};
  let provider = "a".repeat(64);
  let locator = "b".repeat(64);
  let origin_pin = "c".repeat(64);
  let profile = json!({"schema":"synergy-network-provisioning-v1", "role":"rpc_gateway",
   "network_id":"independent-network", "chain_id":40001, "node_name":"gateway-01", "genesis_hash":origin_pin,
   "gateway":{"vpn_provider_sha256":provider,"vpn_credential_locator_sha256":locator}});
  let raw = format!("{}\n", serde_json::to_string_pretty(&profile).unwrap());
  let digest = format!("{:x}", Sha256::digest(raw.as_bytes()));
  let document = json!({"version":1,"profile":"nodenetwork-engineering-authorization-v1",
   "target":{"kind":"remote","root":"/opt/synergy"},"release_id":"sealed-master","manifest_sha256":origin_pin,
   "network_id":profile["network_id"],"chain_id":profile["chain_id"],"node_name":profile["node_name"],
   "sequence":1,"expires_at":300,
   "artifacts":{"formation-context.json":origin_pin,"network-provisioning.json":digest,
    "commissioning/network/genesis.json":origin_pin,"commissioning/network/authority.json":origin_pin,
    "commissioning/network/authority-root.pub":origin_pin,"commissioning/network/network-manifest.json":origin_pin,
    "commissioning/network/transport-registry.json":origin_pin,"commissioning/network/transport-root.pub":origin_pin},
   "genesis_pins":{"genesis.json":origin_pin,"authority.json":origin_pin,"authority-root.pub":origin_pin},
   "requests":[{"operation":"gateway_install","request_sha256":origin_pin}]});
  let configuration = json!({"node_configuration":{"network_id":profile["network_id"],
   "chain_id":profile["chain_id"],"node_name":profile["node_name"],"role":profile["role"]},
   "relay_specification":{"role":{"kind":"gateway","gateway_address":"synv5fixture"}}});
  let reply = json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-gateway-profile-configuration-v1",
   "installed":true,"profile":profile,"profile_json":raw,"profile_sha256":digest,"configuration_json":configuration.to_string()}});
  assert_eq!(installed_pins(&document, &reply).unwrap(), (provider, locator));
  for (field, value) in [("installed", json!(false)), ("profile_json", json!(profile.to_string())),
    ("profile_sha256", json!("d".repeat(64)))] {
   let mut changed = reply.clone();
   changed["result"][field] = value;
   assert!(installed_pins(&document, &changed).is_err(), "{field}");
  }
  let mut legacy = reply.clone();
  legacy["result"].as_object_mut().unwrap().remove("profile_json");
  assert!(installed_pins(&document, &legacy).is_err());
  let mut altered = profile.clone();
  altered["gateway"]["vpn_credential_locator_sha256"] = Value::Null;
  assert!(profile_pins(&altered).is_err());
 }
 #[test]fn gateway_vpn_separate_compiled_profile_pins_never_fallback_or_cross_roles(){let a="a".repeat(64);let b="b".repeat(64);assert_eq!(provider_pin("nodenetwork-controlled-canary-v1",Some(&a),Some(&b),true).unwrap(),a);assert_eq!(provider_pin(PROFILE,Some(&a),Some(&b),true).unwrap(),b);assert!(provider_pin(PROFILE,Some(&a),None,true).is_err());for(profile,v,g,debug)in[(PROFILE,None,Some(b.as_str()),true),(PROFILE,Some(a.as_str()),Some(a.as_str()),true),(PROFILE,Some(a.as_str()),Some("bad"),true),(PROFILE,Some(a.as_str()),Some(b.as_str()),false),("unknown",Some(a.as_str()),Some(b.as_str()),true)]{assert!(provider_pin(profile,v,g,debug).is_err())}}
 #[test]fn gateway_vpn_role_swapped_profile_bytes_are_not_independently_approved(){use sha2::{Digest,Sha256};let validator="validator public profile";let gateway="gateway public profile";let a=format!("{:x}",Sha256::digest(validator));let b=format!("{:x}",Sha256::digest(gateway));assert!(verified_provider_pin(validator,"nodenetwork-controlled-canary-v1",Some(&a),Some(&b),true).is_ok());assert!(verified_provider_pin(gateway,PROFILE,Some(&a),Some(&b),true).is_ok());assert!(verified_provider_pin(validator,PROFILE,Some(&a),Some(&b),true).is_err());assert!(verified_provider_pin(gateway,"nodenetwork-controlled-canary-v1",Some(&a),Some(&b),true).is_err());assert!(verified_provider_pin(gateway,PROFILE,Some(&a),None,true).is_err())}
 #[test]fn gateway_vpn_fixed_tcp_read_rejects_unrestricted_or_renderer_options(){let mut r=Request{version:1,operation:"gateway_vpn_preflight".into(),parameters:json!({"required_gateway_tcp":{"ip":"10.69.1.2","port":8551}})};assert_eq!(r.validate(),Ok(false));for v in [json!({"ip":"10.69.1.2","port":443}),json!({"ip":"127.0.0.1","port":8551}),json!({"ip":"10.69.1.2","port":"8551"}),json!({"ip":"10.69.1.2","port":8551,"icmp":true})]{r.parameters= json!({"required_gateway_tcp":v});assert!(r.validate().is_err())}}
 #[test]fn gateway_vpn_profiles_cannot_cross_validator_and_gateway_initials(){
 let mut artifacts=serde_json::Map::new();for n in ["formation-context.json","commissioning/network/genesis.json","commissioning/network/authority.json","commissioning/network/authority-root.pub","commissioning/network/network-manifest.json","commissioning/network/transport-registry.json","commissioning/network/transport-root.pub"]{artifacts.insert(n.into(),json!("a".repeat(64)));}
 let doc=json!({"version":1,"profile":"nodenetwork-isolated-formation-authorization-v1","target":{"kind":"remote","host":"example.test","port":22,"root":"/opt/synergy","host_key":null,"machine_id_sha256":null},"release_id":"approved","manifest_sha256":"a".repeat(64),"network_id":"synergy-posy-canary-test","chain_id":99999,"node_name":"gateway","sequence":1,"expires_at":1795070000,"artifacts":artifacts,"requests":[{"operation":"gateway_install","request_sha256":"b".repeat(64)}],"genesis_pins":{"genesis.json":"a".repeat(64),"authority.json":"a".repeat(64),"authority-root.pub":"a".repeat(64)}});
 let context=json!({"network_id":doc["network_id"],"chain_id":99999,"formation_sha256":"a".repeat(64)});let policy=json!({"profile":PROFILE,"network_binding":context,"required_gateway_tcp":{"ip":"10.69.1.2","port":8551}});
 assert!(selection(&policy,&doc,&context).unwrap().is_some());let mut wrong=policy.clone();wrong["profile"]=json!("nodenetwork-controlled-canary-v1");assert!(selection(&wrong,&doc,&context).is_err());let mut validator=doc.clone();validator["requests"]=json!([{"operation":"install","request_sha256":"b".repeat(64)}]);assert!(selection(&policy,&validator,&context).is_err());assert_eq!(selection(&wrong,&validator,&context).unwrap(),None);let mut mixed=policy;mixed["required_peer_ips"]=json!(["10.69.1.2"]);assert!(selection(&mixed,&doc,&context).is_err());
 }
 #[test]fn gateway_vpn_preflight_binds_commissioned_origin_and_exact_profile_target(){let tcp=json!({"ip":"10.69.1.2","port":8551});let selected=json!({"state":"commissioned","transport_custody_verified":true,"network_id":"synergy-posy-canary-test","chain_id":"99999","genesis_sha256":"a".repeat(64)});let v=json!({"schema":"nodenetwork-gateway-vpn-preflight-v1","required_gateway_tcp":tcp,"network_id":selected["network_id"],"chain_id":selected["chain_id"],"genesis_sha256":selected["genesis_sha256"],"mutation_performed":false,"production_qualified":false});let reply=json!({"version":1,"ok":true,"result":v});assert!(preflight(&reply,&selected,&tcp,&selected["genesis_sha256"]).is_ok());for k in ["network_id","chain_id","genesis_sha256","required_gateway_tcp"]{let mut bad=reply.clone();bad["result"][k]=Value::Null;assert!(preflight(&bad,&selected,&tcp,&selected["genesis_sha256"]).is_err())}assert!(preflight(&reply,&selected,&tcp,&json!("b".repeat(64))).is_err())}
 #[test]fn gateway_vpn_enrollment_has_only_approved_tcp_while_validator_icmp_unchanged(){let p=json!({"management_origin":"https://approved.test","required_peer_ips":["10.69.1.2"]});let tcp=json!({"ip":"10.69.1.2","port":8551});let gateway:Value=serde_json::from_slice(&enrollment(&p,&json!("name"),"synthetic",Some(&tcp)).unwrap()).unwrap();assert_eq!(gateway["required_gateway_tcp"],tcp);assert!(gateway.get("required_peer_ips").is_none());let validator:Value=serde_json::from_slice(&enrollment(&p,&json!("name"),"synthetic",None).unwrap()).unwrap();assert_eq!(validator["required_peer_ips"],p["required_peer_ips"]);assert!(validator.get("required_gateway_tcp").is_none())}
}
