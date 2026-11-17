//! Exact debug-build authorization, not a production issuer or membership proof.
use crate::{node_bootstrap,node_controller::{self,Target,Request}};
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,path::Path,process::Stdio,time::{Duration,SystemTime,UNIX_EPOCH}};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
use zeroize::Zeroizing;
const PROFILE:&str="nodenetwork-isolated-formation-authorization-v1";
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BoundTarget {kind:String,host:Option<String>,port:Option<u16>,root:String,host_key:Option<String>,machine_id_sha256:Option<String>,#[serde(default)]guest:Option<crate::managed_guest::GuestBinding>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant{operation:String,request_sha256:String}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {version:u8,profile:String,target:BoundTarget,release_id:String,manifest_sha256:String,
 network_id:String,chain_id:u64,node_name:String,sequence:u64,expires_at:u64,
 artifacts:BTreeMap<String,String>,requests:Vec<Grant>,genesis_pins:Option<BTreeMap<String,String>>}
pub struct Prepared {wire:Zeroizing<Vec<u8>>,pub summary:Value,pub host_key:Option<String>,pub sha256:String,pub(super) document:String,pub(super) continuation:Option<(String,String,String)>}
fn digest(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn pin(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn limit(name:&str)->Option<usize>{match name{
 "managed-guest.json"=>Some(16384),"formation-context.json"=>Some(4096),"vpn-ca.pem"=>Some(128*1024),"vpn-provider.json"=>Some(16384),"vpn-server-binding.json"=>Some(16384),"vpn-retirement.json"=>Some(16384),"vpn-enrollment.json"=>Some(16384),
 "commissioning/config/node.json"=>Some(1024*1024),"commissioning/config/start-authorized.json"=>Some(65536),
 "commissioning/network/genesis.json"=>Some(4*1024*1024),"commissioning/network/authority.json"|
 "commissioning/network/network-manifest.json"|"commissioning/network/transport-registry.json"=>Some(1024*1024),
 "commissioning/network/authority-root.pub"|"commissioning/network/transport-root.pub"=>Some(8192),_=>None}}
fn read(path:&Path,max:usize)->Result<Zeroizing<Vec<u8>>,String>{
 use std::io::Read;
 for ancestor in path.parent().ok_or("Authorization input has no parent")?.ancestors(){
  if !std::fs::symlink_metadata(ancestor).is_ok_and(|m|m.is_dir()){return Err("Authorization input ancestry contains a link".into());}
 }
 let m=path.symlink_metadata().map_err(|_|"Authorization input unavailable")?;
 if !m.is_file()||m.len()==0||m.len()>max as u64{return Err("Authorization input is not a bounded regular file".into());}
 #[cfg(unix)] {use std::os::unix::fs::MetadataExt;if m.nlink()!=1{return Err("Hard-linked authorization input refused".into());}
  if path.file_name().is_some_and(|n|n=="vpn-enrollment.json")&&(m.mode()&0o077!=0){return Err("One-use VPN input must be private mode0600".into());}}
 let mut bytes=Zeroizing::new(Vec::new());std::fs::File::open(path).map_err(|_|"Authorization input unavailable")?
  .take(max as u64+1).read_to_end(&mut bytes).map_err(|_|"Cannot read authorization input")?;
 if bytes.len()>max{return Err("Authorization input exceeds bound".into());}Ok(bytes)
}
fn validate(raw:&str,target:&Target,expected:&str,now:u64)->Result<Document,String>{
 target.validate()?;
 if raw.len()>65536||!pin(expected)||digest(raw.as_bytes())!=expected{return Err("Authorization differs from independent native build approval".into());}
 let d:Document=serde_json::from_str(raw).map_err(|_|"Unsupported exact authorization schema")?;
 if d.version!=1||d.profile!=PROFILE||d.sequence==0||d.sequence>=1u64<<53||d.expires_at<=now||d.expires_at>now.saturating_add(3600)
  ||d.target.kind!=target.kind||d.target.host.as_ref().map(|s|s.to_ascii_lowercase())!=target.host.as_ref().map(|s|s.to_ascii_lowercase())
  ||d.target.port!=if target.kind=="remote"{Some(target.port.unwrap_or(22))}else{None}||d.target.root!=target.root||d.target.guest!=target.guest {
  return Err("Authorization target, scope or expiry differs".into());
 }
 if target.kind=="remote"{
  if d.target.machine_id_sha256.is_some(){return Err("Remote identity must use the independently pinned host key".into());}
  let host=target.host.as_ref().unwrap().trim_matches(['[',']']);let port=target.port.unwrap_or(22);
  let host=if port==22{host.to_string()}else{format!("[{host}]:{port}")};
  let parts:Vec<_>=d.target.host_key.as_deref().unwrap_or("").split_whitespace().collect();
  if parts.len()!=3||parts[0]!=host||parts[1]!="ssh-ed25519"||STANDARD.decode(parts[2]).ok().is_none_or(|key|key.len()!=51||!key.starts_with(b"\0\0\0\x0bssh-ed25519\0\0\0\x20")){return Err("Exact independently approved administrative SSH host key required".into());}
 }else if d.target.host_key.is_some()||!d.target.machine_id_sha256.as_deref().is_some_and(pin){return Err("Exact local machine identity required".into());}
 Request{version:1,operation:"install_preflight".into(),parameters:json!({"release_id":d.release_id,"manifest_sha256":d.manifest_sha256,"network_id":d.network_id,"chain_id":d.chain_id,"node_name":d.node_name})}.validate()?;
 if d.artifacts.len()>10||d.artifacts.iter().any(|(n,p)|limit(n).is_none()||!pin(p))||d.requests.is_empty()||d.requests.len()>16{return Err("Authorization inputs or requests exceed exact fixed scope".into());}
 let mut requests=std::collections::BTreeSet::new();
 for r in &d.requests{if !matches!(r.operation.as_str(),"install"|"commission"|"register"|"vpn_enroll"|"vpn_bind"|"vpn_retire"|"start"|"stop"|"restart"|"upgrade"|"uninstall"|"identity_generate"|"network_formation_prepare"|"network_formation_sign"|"network_transport_prepare"|"network_transport_sign"|"guest_create"|"guest_stop"|"guest_remove"|"formation_prepare"|"genesis_stage"|"genesis_bind")||!pin(&r.request_sha256)||!requests.insert(&r.request_sha256){return Err("Only unique exact supported mutation digests may be authorized".into());}}
 if d.genesis_pins.as_ref().is_some_and(|p|p.len()!=3||!["genesis.json","authority.json","authority-root.pub"].iter().all(|n|p.get(*n).is_some_and(|s|pin(s)))){return Err("Exact independently approved Genesis pins required".into());}
 Ok(d)
}
pub fn prepare(path:&Path,target:&Target)->Result<Prepared,String>{
 if !cfg!(debug_assertions){return Err("Operator authorization is unavailable in production builds".into());}
 let bytes=read(path,65536)?;let expected=digest(&bytes);
 if !initial_pin_allowed(&expected){return Err("No matching independent engineering authorization is compiled into this build".into())}
 prepare_pinned(path,target,&expected,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())
}
fn prepare_pinned(path:&Path,target:&Target,expected:&str,now:u64)->Result<Prepared,String>{
 let raw=read(path,65536)?;let text=std::str::from_utf8(&raw).map_err(|_|"Authorization must be exact UTF8 JSON")?;
 let d=validate(text,target,expected,now)?;
 if target.kind=="local"{let machine=read(Path::new("/etc/machine-id"),128)?;if Some(digest(&machine))!=d.target.machine_id_sha256{return Err("Local machine identity differs from the approved document".into());}}
 let mut artifacts=BTreeMap::new();
 for (name,pin) in &d.artifacts{let bytes=read(&path.parent().unwrap().join(name),limit(name).unwrap())?;if digest(&bytes)!=*pin{return Err("Selected authorization artifact digest differs".into());}artifacts.insert(name.clone(),Zeroizing::new(STANDARD.encode(&bytes)));}
 // Keep secret-bearing one-use VPN payload out of renderer responses and logs.
 let values:BTreeMap<_,_>=artifacts.iter().map(|(n,v)|(n,v.as_str())).collect();
 #[derive(Serialize)]struct Wire<'a>{authorization:&'a str,artifacts:BTreeMap<&'a String,&'a str>}
 let wire=Zeroizing::new(serde_json::to_vec(&Wire{authorization:text,artifacts:values}).map_err(|_|"Cannot encode authorization")?);
 if wire.len()>12*1024*1024{return Err("Authorization transfer exceeds bound".into());}
 Ok(Prepared{wire,document:text.into(),continuation:None,host_key:d.target.host_key,sha256:expected.into(),summary:json!({"sha256":expected,"sequence":d.sequence,"expires_at":d.expires_at,"release_id":d.release_id,"manifest_sha256":d.manifest_sha256,"network_id":d.network_id,"chain_id":d.chain_id.to_string(),"node_name":d.node_name,"artifact_count":d.artifacts.len(),"requests":d.requests.iter().map(|r|json!({"operation":r.operation,"request_sha256":r.request_sha256})).collect::<Vec<_>>()})})
}
pub async fn execute(target:Target,operator:String,prepared:Prepared,control:&Path)->Result<Value,String>{
 target.validate()?;node_bootstrap::validate_operator(&operator)?;
 let _serial=node_controller::SERIAL.lock().await;
 // Retire only this app-owned prior channel before applying the exact new pin.
 node_controller::close_connection_checked(&target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(&target,control,&operator).await?;
 let pin_path=control.join(format!("authorization-{}.known-hosts",prepared.sha256));
 if let Some(host_key)=&prepared.host_key{
  node_controller::protect_control_directory(control)?;
  let expected=format!("{host_key}\n");
  if pin_path.exists()||pin_path.is_symlink(){if read(&pin_path,2048)?.as_slice()!=expected.as_bytes(){return Err("Existing authorization host pin differs".into());}}
  else{use std::io::Write;let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}options.open(&pin_path).and_then(|mut f|{f.write_all(expected.as_bytes())?;f.sync_all()}).map_err(|_|"Cannot protect authorization host pin")?;}
 }
 let continuation=prepared.continuation.as_ref().map(|(initial,parent,formation)|format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256=\"{initial}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_PARENT_SHA256=\"{parent}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_FORMATION_SHA256=\"{formation}\"\n")).unwrap_or_default();
 let script=format!("NATIVE_AUTHENTICATED_AUTHORIZATION_SHA256=\"{}\"\n{}{}",prepared.sha256,continuation,BOOTSTRAP);
 let mut c=if target.kind=="local"{
  if !cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local authorization requires Linux x86_64".into());}
  let mut c=tokio::process::Command::new("/usr/bin/sudo");c.args(["-n","/usr/bin/python3","-I","-B","-c",&script,"--stage-engineering-authorization"]);c
 }else{
  let quote=script.replace('\'',"'\\''");node_controller::remote_command(&target,control,&operator,&format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c '{quote}' --stage-engineering-authorization"),Some(&pin_path))?
 };
 c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=c.spawn().map_err(|_|"Cannot start authenticated authorization transport")?;
 let mut input=child.stdin.take().ok_or("Authorization input unavailable")?;let output=child.stdout.take().ok_or("Authorization output unavailable")?;
 let result=tokio::time::timeout(Duration::from_secs(120),async{
  let send=async{input.write_all(&prepared.wire).await.map_err(|_|"Authorization transport interrupted")?;drop(input);Ok::<_,&str>(())};
  let receive=async{let mut bytes=Vec::new();output.take(65537).read_to_end(&mut bytes).await.map_err(|_|"Authorization response unavailable")?;if bytes.len()>65536{return Err("Authorization response exceeds bound");}Ok(bytes)};
  let (_,bytes)=tokio::try_join!(send,receive)?;
  let status=child.wait().await.map_err(|_|"Authorization process outcome unknown")?;if !status.success(){return Err("Authorization transport failed; inspect target before any further operation");}
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid authorization response")?;
  if reply["version"]!=1||!reply["ok"].is_boolean(){return Err("Unsupported authorization response");}
  Ok(reply)
 }).await;
 node_controller::close_connection_checked(&target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(&target,control,&operator).await?;
 // No automatic replay, even after timeout or partial upload.
 match result{Ok(value)=>value.map_err(String::from),Err(_)=>Err("Authorization outcome uncertain; use read-only target reconciliation, do not resend".into())}
}

fn approved_initial(candidate:&str,single:Option<&str>,set:Option<&str>,debug:bool)->bool{
 let mut values=std::collections::BTreeSet::new();
 if let Some(set)=set{for p in set.split(','){if !pin(p)||!values.insert(p){return false}}}
 if let Some(single)=single{if !pin(single)||(set.is_some()&&!values.contains(single)){return false}values.insert(single);}
 debug&&!values.is_empty()&&values.len()<=5&&values.contains(candidate)
}
pub(super) fn initial_pin_allowed(candidate:&str)->bool{
 approved_initial(candidate,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256"),option_env!("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256S"),cfg!(debug_assertions))
}
pub(super) fn verify_initial(raw:&str,target:&Target)->Result<Value,String>{
 let hash=digest(raw.as_bytes());if !initial_pin_allowed(&hash){return Err("Initial document is not approved by this isolated native build".into())}
 let v:Value=serde_json::from_str(raw).map_err(|_|"Invalid initial document")?;
 // Expiry limits the original one-use grants. Explicitly confirmed continuations
 // have their own short expiry; the immutable host/formation pin is retained.
 let when=v["expires_at"].as_u64().and_then(|n|n.checked_sub(1)).ok_or("Invalid initial expiry")?;
 validate(raw,target,&hash,when)?;Ok(v)
}
pub(super) fn continuation(doc:Value,target:&Target,initial:&str,parent:&str,formation:&str)->Result<Prepared,String>{
 if !initial_pin_allowed(initial)||!pin(parent)||!pin(formation){return Err("Unapproved continuation origin".into())}
 let text=doc.to_string();let hash=digest(text.as_bytes());let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let d=validate(&text,target,&hash,now)?;
 if !d.artifacts.is_empty()||d.requests.len()!=1{return Err("Continuation may authorize one exact request, with no arbitrary file input".into())}
 let wire=Zeroizing::new(serde_json::to_vec(&json!({"authorization":text,"artifacts":{}})).map_err(|_|"Cannot encode continuation")?);
 Ok(Prepared{wire,document:text,host_key:d.target.host_key,sha256:hash.clone(),continuation:Some((initial.into(),parent.into(),formation.into())),summary:json!({"sha256":hash,"sequence":d.sequence,"expires_at":d.expires_at})})
}

/// Only the native provider workflow may attach an exact private enrollment or
/// independently verified public binding. Generic continuations stay input-free.
pub(super) struct NativeVpnArtifact<'a>{pub name:&'a str,pub bytes:&'a [u8],pub ca:Option<&'a [u8]>,pub provider:Option<&'a [u8]>}
pub(super) fn vpn_continuation(mut doc:Value,target:&Target,initial:&str,parent:&str,formation:&str,artifact:NativeVpnArtifact<'_>)->Result<Prepared,String>{
 let NativeVpnArtifact{name,bytes,ca,provider}=artifact;
 if !matches!(name,"vpn-enrollment.json"|"vpn-server-binding.json"|"vpn-retirement.json")||bytes.is_empty()||bytes.len()>16384{return Err("Invalid native VPN continuation input".into())}
 let operation=if name=="vpn-enrollment.json"{"vpn_enroll"}else if name=="vpn-server-binding.json"{"vpn_bind"}else{"vpn_retire"};
 if doc["requests"][0]["operation"]!=operation{return Err("VPN artifact and exact request differ".into())}
 let mut prepared=continuation(doc.clone(),target,initial,parent,formation)?;
 doc["artifacts"]=json!({name:digest(bytes)});
 if ca.is_some()!=provider.is_some(){return Err("Exact provider approval must accompany its CA".into())}
 if let Some(provider)=provider{if provider.is_empty()||provider.len()>16384{return Err("Invalid provider approval bound".into())}doc["artifacts"]["vpn-provider.json"]=json!(digest(provider));}
 if let Some(ca)=ca{if name!="vpn-enrollment.json"||ca.is_empty()||ca.len()>128*1024{return Err("CA may accompany only the exact private native enrollment".into())}doc["artifacts"]["vpn-ca.pem"]=json!(digest(ca));}
 let text=doc.to_string();let hash=digest(text.as_bytes());
 validate(&text,target,&hash,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 let encoded=Zeroizing::new(STANDARD.encode(bytes));
 #[derive(Serialize)]struct PrivateWire<'a>{authorization:&'a str,artifacts:BTreeMap<&'a str,&'a str>}
 let ca_encoded=ca.map(|b|STANDARD.encode(b));let mut artifacts=BTreeMap::from([(name,encoded.as_str())]);if let Some(ca)=ca_encoded.as_deref(){artifacts.insert("vpn-ca.pem",ca);}
 let provider_encoded=provider.map(|b|STANDARD.encode(b));if let Some(provider)=provider_encoded.as_deref(){artifacts.insert("vpn-provider.json",provider);}
 prepared.wire=Zeroizing::new(serde_json::to_vec(&PrivateWire{authorization:&text,artifacts}).map_err(|_|"Cannot encode native VPN authorization")?);
 prepared.document=text;prepared.sha256=hash.clone();prepared.summary=json!({"sha256":hash,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}


pub(super) struct NativeGuestArtifact<'a>{pub bytes:&'a [u8],pub request:&'a Request}
pub(super) fn guest_continuation(mut doc:Value,target:&Target,initial:&str,parent:&str,formation:&str,artifact:NativeGuestArtifact<'_>)->Result<Prepared,String>{
 if target.guest.is_some()||artifact.bytes.is_empty()||artifact.bytes.len()>16384||artifact.request.operation!="guest_create"||artifact.request.validate()!=Ok(true)||doc["requests"][0]["request_sha256"]!=artifact.request.approval_id()||doc["requests"][0]["operation"]!="guest_create"{return Err("Managed guest artifact must authorize only its exact creation request on the physical host".into())}
 let value:Value=serde_json::from_slice(artifact.bytes).map_err(|_|"Malformed public managed guest policy")?;
 for key in ["guest_id","image_sha256","cpu_count","memory_mib","disk_gib"]{if value[key]!=artifact.request.parameters[key]{return Err("Guest policy and exact request differ".into())}}
 let mut prepared=continuation(doc.clone(),target,initial,parent,formation)?;
 doc["artifacts"]=json!({"managed-guest.json":digest(artifact.bytes)});let text=doc.to_string();let hash=digest(text.as_bytes());
 validate(&text,target,&hash,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 prepared.wire=Zeroizing::new(serde_json::to_vec(&json!({"authorization":text,"artifacts":{"managed-guest.json":STANDARD.encode(artifact.bytes)}})).map_err(|_|"Cannot encode exact guest policy")?);
 prepared.document=text;prepared.sha256=hash.clone();prepared.summary=json!({"sha256":hash,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}

#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(Target,Value){let t=Target{kind:"remote".into(),host:Some("127.0.0.1".into()),port:Some(22281),root:"/opt/synergy".into(),guest:None};let d=json!({"version":1,"profile":PROFILE,"target":{"kind":t.kind,"host":t.host,"port":t.port,"root":t.root,"machine_id_sha256":null,"host_key":format!("[127.0.0.1]:22281 ssh-ed25519 {}",STANDARD.encode([b"\0\0\0\x0bssh-ed25519\0\0\0\x20".as_slice(),&[0u8;32]].concat()))},"release_id":"reviewed-master","manifest_sha256":"a".repeat(64),"network_id":"nodenetwork-formation-disposable-test","chain_id":99999,"node_name":"validator-test","sequence":1,"expires_at":1060,"artifacts":{},"requests":[{"operation":"stop","request_sha256":"c".repeat(64)}],"genesis_pins":null});(t,d)}
 #[test]fn guest_authorization_cannot_be_reused_for_host_or_another_creation(){
  let(mut t,mut d)=fixture();let bytes=[b"\0\0\0\x0bssh-ed25519\0\0\0\x20".as_slice(),&[7u8;32]].concat();
  let g=crate::managed_guest::GuestBinding{guest_id:"validator-guest".into(),create_request_sha256:"a".repeat(64),ssh_host_public_key:format!("ssh-ed25519 {}",STANDARD.encode(&bytes)),ssh_host_fingerprint:format!("SHA256:{}",STANDARD.encode(Sha256::digest(&bytes)).trim_end_matches('='))};
  t.guest=Some(g.clone());d["target"]["guest"]=serde_json::to_value(g).unwrap();let raw=d.to_string();let pin=digest(raw.as_bytes());assert!(validate(&raw,&t,&pin,1000).is_ok());
  let mut other=t.clone();other.guest=None;assert!(validate(&raw,&other,&pin,1000).is_err());other=t;other.guest.as_mut().unwrap().create_request_sha256="b".repeat(64);assert!(validate(&raw,&other,&pin,1000).is_err());
 }
 #[test]fn initial_document_set_is_bounded_exact_and_debug_only(){let pins=(0..5).map(|i|format!("{i:064x}")).collect::<Vec<_>>();let five=pins.join(",");assert!(approved_initial(&pins[0],None,Some(&five),true));assert!(!approved_initial(&pins[0],None,Some(&five),false));assert!(!approved_initial(&"f".repeat(64),None,Some(&five),true));assert!(!approved_initial(&pins[0],None,Some(&format!("{five},{}","f".repeat(64))),true));assert!(!approved_initial(&pins[0],None,Some(&format!("{five},{}",pins[0])),true));assert!(!approved_initial(&pins[0],Some(&"e".repeat(64)),Some(&five),true));}
 #[test]fn exact_native_pin_target_expiry_and_request_validation_precede_input_access(){let(t,d)=fixture();let raw=d.to_string();assert!(validate(&raw,&t,&digest(raw.as_bytes()),1000).is_ok());assert!(validate(&raw,&t,&"0".repeat(64),1000).is_err());let other=Target{port:Some(22282),..t.clone()};assert!(validate(&raw,&other,&digest(raw.as_bytes()),1000).is_err());assert!(validate(&raw,&t,&digest(raw.as_bytes()),1060).is_err());for (key,value)in[("artifacts",json!({"../../private-key":"b".repeat(64)})),("requests",json!([{"operation":"shell","request_sha256":"c".repeat(64)}])),("sequence",json!(0))]{let mut bad=d.clone();bad[key]=value;let bytes=bad.to_string();assert!(validate(&bytes,&t,&digest(bytes.as_bytes()),1000).is_err());}}
}
