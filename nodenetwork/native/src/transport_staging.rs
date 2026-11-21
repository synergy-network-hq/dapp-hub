//! Fixed public transport inputs from the original APQE-verifying coordinator.
use crate::{authorization_lifecycle as auth,node_controller::{Request,Target},transport_formation as transport};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,path::Path};
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
pub(super) struct Candidate{pub files:BTreeMap<String,Vec<u8>>,pub summary:Value}
pub(super) fn select(export:&Value,review:&Value,genesis:&Value,doc:&Value,status:&Value,target:&Target,binding:&Value)->Result<Candidate,String>{
 let reviewed=transport::review(review)?;
 if reviewed["signed"]!=true||reviewed["formation_sha256"]!=doc["artifacts"]["formation-context.json"]||reviewed["genesis_review_sha256"]!=genesis["review_sha256"]||reviewed["genesis_sha256"]!=genesis["genesis_sha256"]||reviewed["authority_sha256"]!=genesis["authority_sha256"]{return Err("Transport coordinator changed the exact signed formation".into())}
 if binding["schema"]!="nodenetwork-genesis-binding-v1"||binding["bound"]!=true||binding["membership_verified"]!=true||status["formation_sha256"]!=doc["artifacts"]["formation-context.json"]||binding["genesis_sha256"]!=genesis["genesis_sha256"]||binding["address"].as_str().is_none(){return Err("Target has not verified and bound its original formation custody".into())}
 let enrollment=binding["enrollment_json"].as_str().filter(|s|!s.is_empty()&&s.len()<=128*1024).ok_or("Bound public enrollment absent")?;
 if binding["enrollment_sha256"]!=hash(enrollment.as_bytes()){return Err("Bound enrollment bytes changed".into())}
 let mut files=None;let decoded=transport::export(export,&reviewed)?;
 for(node,contents)in export["nodes"].as_array().ok_or("Public transport nodes absent")?.iter().zip(decoded){if node["address"]==binding["address"]{if files.is_some(){return Err("Duplicate transport target".into())}files=Some(contents.into_iter().map(|(k,v)|(k.to_string(),v)).collect::<BTreeMap<_,_>>());}}
 let files=files.ok_or("Target's existing identity is absent from signed transport")?;
 let config:Value=serde_json::from_slice(&files["config/node.json"]).map_err(|_|"Invalid target configuration")?;
 let draft:Value=serde_json::from_slice(&files["config/start-authorized.json"]).map_err(|_|"Invalid startup draft")?;
 let registry:Value=serde_json::from_slice(&files["network/transport-registry.json"]).map_err(|_|"Invalid signed registry")?;
 let member=registry["payload"]["validators"].as_array().and_then(|v|v.iter().find(|v|v["node_address"]==binding["address"])).ok_or("Signed registry target absent")?;
 if member["enrollment_sha256"]!=binding["enrollment_sha256"]||member["revoked"]!=false{return Err("Signed transport changes the original bound enrollment".into())}
 let apqe=&config["apqe_transport"];
 if apqe["profile"]!="engineering_canary_pq_vsession_v1"||[&config["aegis_signing_key_path"],&config["aegis_key_bindings_path"],&config["consensus"]["signing_key_path"],&config["etdag"]["ingress_kem_secret_key_path"]].iter().any(|v|!v.is_null()){return Err("Commissioning requires the existing opaque APQE custody profile".into())}
 for(field,path)in[("registry_path","network/transport-registry.json"),("registry_trust_key_path","network/transport-root.pub"),("enrollment_path","keys/apqe/enrollment.json"),("custody_path","keys/apqe/custody.json"),("custody_unlock_path","keys/apqe/unlock")]{if apqe[field]!=format!("{}/{path}",target.root){return Err("Commissioning APQE paths escape selected root".into())}}
 if apqe["registry_trust_key_sha256"]!=hash(&files["network/transport-root.pub"])||apqe["genesis_trust_key_sha256"]!=hash(&files["network/authority-root.pub"]){return Err("Commissioning APQE trust roots differ".into())}
 let selection=&status["selection"];
 for field in ["network_id","chain_id","node_name"]{if config[field]!=selection[field]||selection[field]!=doc[field]{return Err("Commissioning configuration changes the approved target selection".into())}}
 let root=&target.root;
 for(field,path)in[("public_identity_path","keys/apqe/validator.pub.json"),("admin_socket_path","run/admin.sock"),("genesis_path","network/genesis.json"),("manifest_path","network/network-manifest.json")]{if config[field]!=format!("{root}/{path}"){return Err("Commissioning configuration escapes the selected managed root".into())}}
 if config["storage"]["data_directory"]!=format!("{root}/data")||config["consensus"]["authority_binding"]!=format!("{root}/network/authority.json")||config["consensus"]["authority_trust_key_path"]!=format!("{root}/network/authority-root.pub"){return Err("Commissioning storage or authority changes selected root".into())}
 if status["provider_report_sha256"].as_str().is_none_or(|s|s.len()!=64)||config["aegis_provider"]["authenticated_report_sha256"]!=status["provider_report_sha256"]||config["aegis_provider"]["report_path"]!=format!("{root}/lib/apqe/build-report.json"){return Err("Commissioning provider differs from authenticated current master".into())}
 for(name,field)in[("network/genesis.json","genesis_sha256"),("network/authority.json","authority_sha256"),("network/authority-root.pub","authority_root_sha256")]{if hash(&files[name])!=genesis[field]{return Err("Commissioning public Genesis or authority changed".into())}}
 let public=files.iter().filter_map(|(name,raw)|name.strip_prefix("network/").map(|n|(n.to_string(),json!(hash(raw))))).collect::<serde_json::Map<_,_>>();
 if draft["all_validators_ready"]!=false||draft["all_pairs_vpn_verified"]!=false||draft["production_approved"]!=false||draft["public_file_sha256"]!=Value::Object(public)||draft["validator_addresses"]!=reviewed["validator_addresses"]||draft["network_id"]!=doc["network_id"]||draft["chain_id"]!=doc["chain_id"]{return Err("Commissioning draft asserts readiness or changes reviewed network".into())}
 let pins=files.iter().map(|(n,b)|(n.clone(),json!(hash(b)))).collect::<serde_json::Map<_,_>>();
 let summary=json!({"schema":"nodenetwork-native-transport-staged-v1","staged":true,"address":binding["address"],"review_sha256":reviewed["review_sha256"],"artifact_sha256":pins,"fleet_readiness_verified":false,"commissioned":false,"runtime_admission":false});
 Ok(Candidate{files,summary})
}
pub(super) async fn candidate(base:&Path,target:&Target,control:&Path)->Result<Candidate,String>{
 let source=auth::signed_source(base,target,control).await?.ok_or("Original signed formation coordinator has not been exported in this native app")?;
 let doc=auth::original_document(base,target)?;
 let status=auth::execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let binding=auth::execute(base,target.clone(),Request{version:1,operation:"genesis_binding_preflight".into(),parameters:json!({})},control).await?;
 let review=auth::execute(base,source.target.clone(),Request{version:1,operation:"network_transport_status".into(),parameters:json!({})},control).await?;
 let export=auth::execute(base,source.target,Request{version:1,operation:"network_transport_export".into(),parameters:json!({})},control).await?;
 if [&status,&binding,&review,&export].iter().any(|v|v["ok"]!=true){return Err("Authenticated target or original coordinator refused transport verification".into())}
 // Native continuation independently rechecks original target/current adoption.
 select(&export["result"],&review["result"],&source.export,&doc,&status["result"],target,&binding["result"])
}

#[cfg(test)]mod tests{
 use super::*;use base64::{Engine as _,engine::general_purpose::STANDARD};
 type Fixture=(Value,Value,Value,Value,Value,Target,Value);
 fn fixture()->Fixture{
  let target=Target{kind:"remote".into(),host:Some("host.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};
  let formation="f".repeat(64);let g="{\"genesis\":1}";let a="{\"authority\":1}";let root=vec![9u8;1952];let issuer=vec![7u8;2592];
  let enrollment="{\"public\":\"enrollment\"}";let addresses=(0..5).map(|i|format!("synv1{}",i.to_string().repeat(30))).collect::<Vec<_>>();
  let genesis=json!({"review_sha256":"a".repeat(64),"genesis_sha256":hash(g.as_bytes()),"authority_sha256":hash(a.as_bytes()),"authority_root_sha256":hash(&root)});
  let registry=json!({"payload":{"validators":addresses.iter().map(|a|json!({"node_address":a,"enrollment_sha256":hash(enrollment.as_bytes()),"revoked":false})).collect::<Vec<_>>()}}).to_string();
  let mut network=BTreeMap::from([("network/genesis.json",g.to_string()),("network/authority.json",a.to_string()),("network/authority-root.pub",STANDARD.encode(&root)),("network/network-manifest.json","{}".into()),("network/transport-registry.json",registry.clone()),("network/transport-root.pub",STANDARD.encode(&issuer))]);
  let public=network.iter().map(|(n,b)|(n.strip_prefix("network/").unwrap().to_string(),json!(if n.ends_with(".pub"){hash(&STANDARD.decode(b).unwrap())}else{hash(b.as_bytes())}))).collect::<serde_json::Map<_,_>>();
  let draft=json!({"network_id":"fresh","chain_id":99999,"production_approved":false,"all_validators_ready":false,"all_pairs_vpn_verified":false,"validator_addresses":addresses,"public_file_sha256":public}).to_string();
  let config=json!({"network_id":"fresh","chain_id":99999,"node_name":"node0","public_identity_path":"/opt/synergy/keys/apqe/validator.pub.json","admin_socket_path":"/opt/synergy/run/admin.sock","genesis_path":"/opt/synergy/network/genesis.json","manifest_path":"/opt/synergy/network/network-manifest.json","storage":{"data_directory":"/opt/synergy/data"},"apqe_transport":{"profile":"engineering_canary_pq_vsession_v1","registry_path":"/opt/synergy/network/transport-registry.json","registry_trust_key_path":"/opt/synergy/network/transport-root.pub","enrollment_path":"/opt/synergy/keys/apqe/enrollment.json","custody_path":"/opt/synergy/keys/apqe/custody.json","custody_unlock_path":"/opt/synergy/keys/apqe/unlock","registry_trust_key_sha256":hash(&issuer),"genesis_trust_key_sha256":hash(&root)},"consensus":{"authority_binding":"/opt/synergy/network/authority.json","authority_trust_key_path":"/opt/synergy/network/authority-root.pub"},"aegis_provider":{"report_path":"/opt/synergy/lib/apqe/build-report.json","authenticated_report_sha256":"b".repeat(64)}}).to_string();
  network.insert("config/node.json",config);network.insert("config/start-authorized.json",draft);
  let export=json!({"schema":"nodenetwork-network-transport-export-v1","review_sha256":"c".repeat(64),"registry_sha256":hash(registry.as_bytes()),"issuer_root_sha256":hash(&issuer),"fleet_readiness_verified":false,"nodes":addresses.iter().map(|a|json!({"address":a,"artifacts":network})).collect::<Vec<_>>()});
  let review=json!({"schema":"nodenetwork-network-transport-v1","pending":true,"signed":true,"formation_sha256":formation,"genesis_review_sha256":genesis["review_sha256"],"request_sha256":"d".repeat(64),"review_sha256":export["review_sha256"],"genesis_sha256":genesis["genesis_sha256"],"authority_sha256":genesis["authority_sha256"],"issuer_root_sha256":export["issuer_root_sha256"],"registry_sha256":export["registry_sha256"],"sign_request_sha256":"e".repeat(64),"validator_addresses":addresses,"runtime_admission":false,"fleet_readiness_verified":false});
  let doc=json!({"network_id":"fresh","chain_id":99999,"node_name":"node0","artifacts":{"formation-context.json":formation}});
  let status=json!({"selection":{"network_id":"fresh","chain_id":99999,"node_name":"node0"},"formation_sha256":formation,"provider_report_sha256":"b".repeat(64)});
  let binding=json!({"schema":"nodenetwork-genesis-binding-v1","bound":true,"membership_verified":true,"address":addresses[0],"genesis_sha256":genesis["genesis_sha256"],"enrollment_json":enrollment,"enrollment_sha256":hash(enrollment.as_bytes())});
  (export,review,genesis,doc,status,target,binding)
 }
 #[test]fn selects_only_exact_bound_target_public_drafts(){let(e,r,g,d,s,t,b)=fixture();let c=select(&e,&r,&g,&d,&s,&t,&b).unwrap();assert_eq!(c.files.len(),8);assert_eq!(c.summary["staged"],true);assert_eq!(c.summary["fleet_readiness_verified"],false);assert_eq!(c.summary["commissioned"],false);}
 #[test]fn denies_foreign_formation_provider_genesis_and_bound_enrollment(){let(e,r,g,d,s,t,b)=fixture();for field in["formation_sha256","genesis_review_sha256","genesis_sha256","authority_sha256"]{let mut wrong=r.clone();wrong[field]=json!("0".repeat(64));assert!(select(&e,&wrong,&g,&d,&s,&t,&b).is_err())}for field in["bound","membership_verified","enrollment_sha256","address"]{let mut wrong=b.clone();wrong[field]=Value::Null;assert!(select(&e,&r,&g,&d,&s,&t,&wrong).is_err())}let mut wrong=s.clone();wrong["provider_report_sha256"]=json!("f".repeat(64));assert!(select(&e,&r,&g,&d,&wrong,&t,&b).is_err());}
 #[test]fn denies_wrong_target_root_config_readiness_and_missing_files(){let(e,r,g,d,s,t,b)=fixture();for(field,value)in[("node_name",json!("foreign")),("genesis_path",json!("/foreign/genesis.json")),("admin_socket_path",json!("/tmp/socket"))]{let mut wrong=e.clone();let mut config:Value=serde_json::from_str(wrong["nodes"][0]["artifacts"]["config/node.json"].as_str().unwrap()).unwrap();config[field]=value;wrong["nodes"][0]["artifacts"]["config/node.json"]=json!(config.to_string());assert!(select(&wrong,&r,&g,&d,&s,&t,&b).is_err())}let mut wrong=e.clone();wrong["nodes"][0]["artifacts"].as_object_mut().unwrap().remove("network/transport-root.pub");assert!(select(&wrong,&r,&g,&d,&s,&t,&b).is_err());let mut wrong=e;let mut draft:Value=serde_json::from_str(wrong["nodes"][0]["artifacts"]["config/start-authorized.json"].as_str().unwrap()).unwrap();draft["all_pairs_vpn_verified"]=json!(true);wrong["nodes"][0]["artifacts"]["config/start-authorized.json"]=json!(draft.to_string());assert!(select(&wrong,&r,&g,&d,&s,&t,&b).is_err());}
}
