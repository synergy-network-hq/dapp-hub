//! Isolated native coordinator. Never returns provider credentials or setup keys to JS.
use crate::{authorization_lifecycle as lifecycle,node_controller::{Target,Request}};
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::Path,process::Stdio};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
use zeroize::Zeroizing;
const PROVIDER:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/vpn_authorization.py"));
static SERIAL:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
fn hash(b:&[u8])->String{format!("{:x}",Sha256::digest(b))}
fn read(path:&Path,limit:usize,private:bool)->Result<Zeroizing<Vec<u8>>,String>{
 use std::io::Read;
 let mut o=std::fs::OpenOptions::new();o.read(true);
 #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;o.custom_flags(libc::O_NOFOLLOW|libc::O_NONBLOCK);}
 let f=o.open(path).map_err(|_|"Cannot read native-selected VPN input")?;let m=f.metadata().map_err(|_|"Cannot inspect VPN input")?;
 if !m.is_file()||m.len()==0||m.len()>limit as u64{return Err("Invalid bounded VPN input".into())}
 #[cfg(unix)]{use std::os::unix::fs::MetadataExt;if m.nlink()!=1||(private&&(m.mode()&0o077!=0||m.uid()!=unsafe{libc::geteuid()})){return Err("VPN credential must be a private0600 native-owned regular file".into())}}
 let mut b=Zeroizing::new(Vec::new());f.take(limit as u64+1).read_to_end(&mut b).map_err(|_|"Cannot read VPN input")?;
 if b.len()!=m.len() as usize{return Err("VPN input changed while reading".into())}Ok(b)
}
struct Config{raw:String,ca:Zeroizing<Vec<u8>>,policy:Value,pin:String}
fn config(directory:&Path)->Result<Config,String>{
 if !cfg!(all(debug_assertions,unix)){return Err("Native VPN issuer remains unavailable in production".into())}
 let pin=option_env!("SYNERGY_NODENETWORK_QUALIFICATION_VPN_PROVIDER_SHA256").ok_or("This native build has no independently approved isolated VPN provider")?;
 let raw=read(&directory.join("provider.json"),16384,false)?;
 if hash(&raw)!=pin{return Err("Selected VPN provider differs from the compiled independent approval".into())}
 let raw=String::from_utf8(raw.to_vec()).map_err(|_|"Provider approval must be UTF8")?;
 let policy:Value=serde_json::from_str(&raw).map_err(|_|"Invalid provider approval")?;
 let ca=read(&directory.join("ca.pem"),128*1024,false)?;
 if policy["ca_sha256"]!=hash(&ca){return Err("VPN CA bytes differ from the independently approved provider".into())}
 Ok(Config{raw,ca,policy,pin:pin.into()})
}
fn binding(target:&Target,status:&Value)->Result<Value,String>{
 if !status["formation_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())){return Err("Target has no exact approved formation".into())}
 let selected=&status["selection"];
 if !selected["manifest_sha256"].is_string()||!selected["network_id"].is_string()||!selected["chain_id"].is_u64(){return Err("Target selected network is unavailable".into())}
 Ok(json!({"target_sha256":hash(target.journal_identity().to_string().as_bytes()),"manifest_sha256":selected["manifest_sha256"],"formation_sha256":status["formation_sha256"],"network_id":selected["network_id"],"chain_id":selected["chain_id"]}))
}
async fn provider(config:&Config,credential:&[u8],directory:&Path,operation:&str,binding:&Value,local:&Value)->Result<(Value,Zeroizing<String>),String>{
 let token=std::str::from_utf8(credential).map_err(|_|"Provider credential must be ASCII")?.trim_end_matches(['\r','\n']);
 if token.is_empty()||token.len()>4096||!token.bytes().all(|c|(33..=126).contains(&c)){return Err("Private provider credential is invalid".into())}
 #[derive(serde::Serialize)]struct PrivateWire<'a>{policy:&'a str,pin:&'a str,ca:String,token:&'a str,directory:&'a Path,operation:&'a str,binding:&'a Value,local:&'a Value}
 let wire=Zeroizing::new(serde_json::to_vec(&PrivateWire{policy:&config.raw,pin:&config.pin,ca:STANDARD.encode(config.ca.as_slice()),token,directory,operation,binding,local}).map_err(|_|"Cannot encode private provider exchange")?);
 let runner=r#"
import base64,sys
try:
    wire=decode(sys.stdin.buffer.read(256*1024+1))
    ca=base64.b64decode(wire['ca'],validate=True)
    policy=provider_policy(wire['policy'].encode(),wire['pin'],ca,int(time.time()))
    client=HttpsProvider(policy,ca,wire['token'])
    flow=Authorization(wire['directory'],policy,client.request)
    if wire['operation']=='prepare':
        public,secret=flow.prepare(wire['binding'])
        sys.stdout.buffer.write(encode(public)+b'\n'+secret.encode())
    else:
        intent=flow._read('intent.json')
        require(intent['binding']==wire['binding'],'Original target/release/network differs')
        if wire['operation']=='reconcile': result=flow.reconcile(wire['local'])
        elif wire['operation']=='revoke': result=flow.revoke_setup_key()
        elif wire['operation']=='retire': result=flow.retire_bound_peer(wire['local'])
        else: raise ValueError('Unknown native provider operation')
        sys.stdout.buffer.write(encode(result)+b'\n')
except Exception:
    sys.exit(1)
"#;
 let script=format!("{PROVIDER}\n{runner}");
 let mut c=tokio::process::Command::new("/usr/bin/python3");c.args(["-I","-B","-c",&script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=c.spawn().map_err(|_|"Native provider transport is unavailable")?;
 let mut input=child.stdin.take().ok_or("Provider input unavailable")?;let mut output=child.stdout.take().ok_or("Provider response unavailable")?.take(32769);
 let result=tokio::time::timeout(std::time::Duration::from_secs(90),async{
  input.write_all(&wire).await.map_err(|_|"Private provider exchange interrupted")?;drop(input);
  let mut raw=Zeroizing::new(Vec::new());output.read_to_end(&mut raw).await.map_err(|_|"Provider response unavailable")?;
  if raw.len()>32768||!child.wait().await.map_err(|_|"Provider outcome unknown")?.success(){return Err("Provider operation refused or uncertain; use reconciliation, never reissue")}
  let split=raw.iter().position(|c|*c==b'\n').ok_or("Unsupported provider response")?;
  let public=serde_json::from_slice(&raw[..split]).map_err(|_|"Invalid public provider receipt")?;
  let secret=Zeroizing::new(std::str::from_utf8(&raw[split+1..]).map_err(|_|"Invalid private provider response")?.to_string());Ok((public,secret))
 }).await.map_err(|_|"Provider operation timed out; preserve intent and reconcile, never reissue")?;
 result.map_err(String::from)
}
pub async fn execute(base:&Path,target:Target,control:&Path,config_directory:&Path,credential_path:&Path,operation:&str)->Result<Value,String>{
 let _serial=SERIAL.lock().await;
 if !matches!(operation,"enroll"|"reconcile"|"revoke"|"retire"){return Err("Unsupported native VPN workflow".into())}
 let config=config(config_directory)?;let credential=read(credential_path,4098,true)?;
 let(_,status,_)=lifecycle::update_context(base,&target,control).await?;
 let context=binding(&target,&status)?;
 let app=base.join("nodenetwork-vpn-v1");if !app.exists(){#[cfg(unix)]{use std::os::unix::fs::DirBuilderExt;std::fs::DirBuilder::new().mode(0o700).create(&app).map_err(|_|"Cannot protect native VPN state")?;}}
 let directory=app.join(hash(target.journal_identity().to_string().as_bytes()));
 let mut result=lifecycle::execute(base,target.clone(),Request{version:1,operation:"vpn_status".into(),parameters:json!({})},control).await?;
 if result["ok"]!=true{return Err("Read native VPN status before dispatch".into())}
 if operation=="retire"{
  let(public,_)=provider(&config,&credential,&directory,"retire",&context,&result["result"]).await?;
  if result["result"]["retired"]==true{return Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-retirement-v1","retired":true,"absence_verified":true,"peer_id":public["peer_id"]}}))}
  let raw=serde_json::to_vec(&public).map_err(|_|"Cannot encode exact provider retirement")?;
  let request=Request{version:1,operation:"vpn_retire".into(),parameters:json!({})};
  lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-retirement.json",bytes:&raw,ca:None,provider:None}).await?;
  return lifecycle::execute(base,target,request,control).await;
 }
 if operation=="revoke"{
  let(public,_)=provider(&config,&credential,&directory,"revoke",&context,&Value::Null).await?;return Ok(json!({"version":1,"ok":true,"result":public}))
 }
 if operation=="enroll"{
  let current=&result["result"];
  if current["service_registered"]!=true||current["enrollment_recorded"]!=false||current["reconciliation_required"]!=false||current["enrollment_staged"]!=false{return Err("Register a fresh VPN service and reconcile any prior enrollment before issuing one key".into())}
  let(public,secret)=provider(&config,&credential,&directory,"prepare",&context,&Value::Null).await?;
  #[derive(serde::Serialize)]struct Enrollment<'a>{setup_key:&'a str,management_url:&'a Value,hostname:&'a Value,required_peer_ips:&'a Value}
  let mut data=Zeroizing::new(serde_json::to_vec(&Enrollment{setup_key:secret.as_str(),management_url:&config.policy["management_origin"],hostname:&public["name"],required_peer_ips:&config.policy["required_peer_ips"]}).map_err(|_|"Cannot encode private enrollment")?);
  let request=Request{version:1,operation:"vpn_enroll".into(),parameters:json!({})};
  lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-enrollment.json",bytes:&data,ca:Some(config.ca.as_slice()),provider:Some(config.raw.as_bytes())}).await?;
  use zeroize::Zeroize;data.zeroize();
  result=lifecycle::execute(base,target.clone(),request,control).await?;
  if result["ok"]!=true{return Err("Enrollment outcome uncertain; reconcile provider and target, never issue another key".into())}
 }
 if operation=="reconcile"&&result["result"]["enrollment_recorded"]==false&&result["result"]["enrollment_staged"]==true&&result["result"]["reconciliation_required"]==false{
  // The target's durable attempt fence is absent: enrollment never dispatched.
  // Use only its existing exact one-use grant; do not restage/reissue a key.
  result=lifecycle::execute(base,target.clone(),Request{version:1,operation:"vpn_enroll".into(),parameters:json!({})},control).await?;
  if result["ok"]!=true{return Err("Original staged enrollment could not be dispatched; preserve it and reconcile or cancel its exact key".into())}
 }
 if result["result"]["enrollment_recorded"]!=true{return Err("Native enrollment is absent or uncertain; preserve intent for provider reconciliation".into())}
 let(public,_)=provider(&config,&credential,&directory,"reconcile",&context,&result["result"]["enrollment"]).await?;
 if result["result"]["server_bound"]!=true{
  let raw=serde_json::to_vec(&public).map_err(|_|"Cannot encode independently verified binding")?;
  let request=Request{version:1,operation:"vpn_bind".into(),parameters:json!({})};
  lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-server-binding.json",bytes:&raw,ca:None,provider:None}).await?;
  result=lifecycle::execute(base,target,request,control).await?;
 }
 // Remove the consumed setup key only after independent provider+local binding.
 provider(&config,&credential,&directory,"revoke",&context,&Value::Null).await?;
 if let Some(object)=result.get_mut("result").and_then(Value::as_object_mut){object.remove("enrollment");}
 Ok(result)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn context_is_exact_and_rejects_missing_formation(){let t=Target{kind:"remote".into(),host:Some("guest.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};let mut s=json!({"formation_sha256":"a".repeat(64),"selection":{"manifest_sha256":"b".repeat(64),"network_id":"isolated-network","chain_id":999998}});let b=binding(&t,&s).unwrap();assert_eq!(b["target_sha256"],hash(t.journal_identity().to_string().as_bytes()));s["formation_sha256"]=Value::Null;assert!(binding(&t,&s).is_err());}
}
