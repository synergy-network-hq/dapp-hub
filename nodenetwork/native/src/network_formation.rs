//! Native public-file review. Cryptographic formation/signing stays in the master.
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeSet,path::Path};
fn sha(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn pin(v:&Value)->bool{v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}
fn read(path:&Path,max:usize)->Result<Vec<u8>,String>{
 use std::io::Read;
 for ancestor in path.ancestors(){let m=ancestor.symlink_metadata().map_err(|_|"Public input is unavailable")?;if ancestor==path {if !m.is_file()||m.len()==0||m.len()>max as u64{return Err("Public input must be a bounded regular file".into())}}else if !m.is_dir(){return Err("Public input ancestry contains a link".into())}}
 let mut out=Vec::new();std::fs::File::open(path).and_then(|f|f.take(max as u64+1).read_to_end(&mut out)).map_err(|_|"Cannot read public input")?;
 if out.len()>max{return Err("Public input exceeds its bound".into())}Ok(out)
}
pub fn prepare_inputs(folder:&Path,formation_sha256:&str)->Result<Value,String>{
 if !pin(&json!(formation_sha256)){return Err("Review the independently approved formation first".into())}
 let recipe=String::from_utf8(read(&folder.join("recipe.json"),1024*1024)?).map_err(|_|"Recipe must be UTF-8")?;
 let parsed:Value=serde_json::from_str(&recipe).map_err(|_|"Recipe must be JSON")?;
 if !parsed.is_object()||parsed.get("formation_registrations").is_some(){return Err("The app supplies the five registration references; recipe paths are forbidden".into())}
 let mut registrations=Vec::new();let mut addresses=BTreeSet::new();
 for i in 1..=5{let raw=String::from_utf8(read(&folder.join(format!("registration-{i}.json")),128*1024)?).map_err(|_|"Registration must be UTF-8")?;
  let v:Value=serde_json::from_str(&raw).map_err(|_|"Registration must be JSON")?;
  let address=v["payload"]["identity"]["address"].as_str().filter(|s|s.starts_with("synv1")&&s.len()<=95).ok_or("Registration has no validator identity")?;
  if v["payload"]["schema_version"]!="apqe-validator-formation-registration-v1"||!addresses.insert(address.to_string()){return Err("Five distinct public formation registrations required".into())}
  registrations.push(raw);
 }
 Ok(json!({"formation_sha256":formation_sha256,"recipe_json":recipe,"registrations_json":registrations}))
}
pub fn review(value:&Value)->Result<Value,String>{
 if value==&json!({"pending":false}){return Ok(value.clone())}
 let fields=["formation_sha256","request_sha256","review_sha256","unsigned_genesis_sha256","unsigned_authority_sha256","authority_root_sha256"];
 if value["schema"]!="nodenetwork-network-formation-v1"||value["pending"]!=true||!value["signed"].is_boolean()||fields.iter().any(|k|!pin(&value[k])){return Err("Unsupported engineering Genesis review".into())}
 let network=value["network_id"].as_str().filter(|s|(2..=128).contains(&s.len())&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b"_-".contains(&b))).ok_or("Invalid network review")?;
 let chain=value["chain_id"].as_str().and_then(|s|s.parse::<u64>().ok().filter(|n|*n>0&&n.to_string()==s)).ok_or("Invalid chain review")?;
 let ids=value["validator_addresses"].as_array().filter(|a|a.len()==5).ok_or("Five verified validators required")?;
 let mut unique=BTreeSet::new();for id in ids{let id=id.as_str().filter(|s|s.starts_with("synv1")&&(15..=95).contains(&s.len())&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit())).ok_or("Invalid validator identity")?;if !unique.insert(id){return Err("Repeated validator identity".into())}}
 let mut out=json!({"schema":"nodenetwork-network-formation-v1","pending":true,"signed":value["signed"],"network_id":network,"chain_id":chain.to_string(),"validator_addresses":ids});
 for k in fields{out[k]=value[k].clone()}
 if value["signed"]==true{for k in ["genesis_sha256","authority_sha256","sign_request_sha256"]{if !pin(&value[k]){return Err("Signed review is missing exact evidence".into())}out[k]=value[k].clone()}}
 Ok(out)
}
pub fn export(value:&Value,expected:&str)->Result<Vec<(&'static str,Vec<u8>)>,String>{
 if !value.as_object().is_some_and(|v|v.len()==6&&["schema","review_sha256","genesis_sha256","authority_sha256","authority_root_sha256","artifacts"].iter().all(|k|v.contains_key(*k)))||value["schema"]!="nodenetwork-network-formation-export-v1"||!pin(&json!(expected))||value["review_sha256"]!=expected{return Err("Signed artifact export differs from reviewed Genesis".into())}
 let a=value["artifacts"].as_object().filter(|v|v.len()==3).ok_or("Exactly three signed public artifacts required")?;
 let mut files=Vec::new();
 for(name,field,max)in[("genesis.json","genesis_sha256",4*1024*1024),("authority.json","authority_sha256",1024*1024),("authority-root.pub","authority_root_sha256",8192)]{
  let text=a.get(name).and_then(Value::as_str).ok_or("Missing exact signed artifact")?;
  let bytes=if name=="authority-root.pub"{let b=STANDARD.decode(text).map_err(|_|"Invalid public root encoding")?;if STANDARD.encode(&b)!=text{return Err("Noncanonical public root encoding".into())}b}else{serde_json::from_str::<Value>(text).map_err(|_|"Signed artifact is not JSON")?;text.as_bytes().to_vec()};
  if bytes.is_empty()||bytes.len()>max||!pin(&value[field])||sha(&bytes)!=value[field]{return Err("Signed public artifact digest or bound differs".into())}files.push((name,bytes));
 }Ok(files)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn exports_require_original_bytes_and_exact_review_without_private_fields(){let g="{\"genesis\":1}\n";let a="{}";let root=vec![9u8;1952];let p="a".repeat(64);let mut v=json!({"schema":"nodenetwork-network-formation-export-v1","review_sha256":p,"genesis_sha256":sha(g.as_bytes()),"authority_sha256":sha(a.as_bytes()),"authority_root_sha256":sha(&root),"artifacts":{"genesis.json":g,"authority.json":a,"authority-root.pub":STANDARD.encode(&root)}});let files=export(&v,&p).unwrap();assert_eq!(files[0].1,g.as_bytes());assert!(export(&v,&"b".repeat(64)).is_err());v["artifacts"]["genesis.json"]=json!(g.trim());assert!(export(&v,&p).is_err());v["artifacts"]["private"]=json!("must reject");assert!(export(&v,&p).is_err());}
}
