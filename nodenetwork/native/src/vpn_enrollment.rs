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
// Provider intent is anchored to the immutable installation origin. A current
// release adoption authorizes operations but must not rewrite that identity.
fn binding(target:&Target,status:&Value,doc:&Value,initial_sha256:&str)->Result<Value,String>{
 let origin=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});
 let selected=&status["selection"];
 let target_identity=target.journal_identity();
 if status["schema"]!="nodenetwork-engineering-authorization-status-v1"||status["initial_sha256"]!=initial_sha256||status["target"]!=doc["target"]||target_identity.as_object().unwrap().iter().any(|(k,v)|if k=="host"{doc["target"][k].as_str().map(str::to_ascii_lowercase)!=v.as_str().map(str::to_ascii_lowercase)}else{&doc["target"][k]!=v})||status.get("initial_selection").unwrap_or(selected)!=&origin||["network_id","chain_id","node_name"].iter().any(|k|selected[k]!=origin[k])||status["formation_sha256"]!=doc["artifacts"]["formation-context.json"]{return Err("VPN origin differs from the independently approved target, network or formation".into())}
 if selected!=&origin{
  let adoption=&status["update"];
  if adoption["initial_sha256"]!=status["initial_sha256"]||adoption["formation_sha256"]!=status["formation_sha256"]||!["selection","previous_selection"].iter().any(|key|&adoption[key]==selected){return Err("VPN current release lacks its exact native-reviewed adoption".into())}
 }
 for value in [&origin["manifest_sha256"],&selected["manifest_sha256"],&status["formation_sha256"]]{if !value.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("VPN release or formation commitment is unavailable".into())}}
 if !selected["release_id"].is_string()||!selected["network_id"].is_string()||!selected["chain_id"].is_u64(){return Err("Target selected network is unavailable".into())}
 Ok(json!({"target_sha256":hash(target_identity.to_string().as_bytes()),"manifest_sha256":origin["manifest_sha256"],"formation_sha256":status["formation_sha256"],"network_id":origin["network_id"],"chain_id":origin["chain_id"]}))
}
fn cleanup_action(operation:&str)->Result<Option<&str>,String>{match operation{"revoke"|"retire"=>Ok(Some(operation)),"prepare"|"reconcile"=>Ok(None),_=>Err("Unsupported native provider action".into())}}
async fn provider(config:&Config,credential:&[u8],directory:&Path,operation:&str,binding:&Value,local:&Value)->Result<(Value,Zeroizing<String>),String>{
 let token=std::str::from_utf8(credential).map_err(|_|"Provider credential must be ASCII")?.trim_end_matches(['\r','\n']);
 if token.is_empty()||token.len()>4096||!token.bytes().all(|c|(33..=126).contains(&c)){return Err("Private provider credential is invalid".into())}
 #[derive(serde::Serialize)]struct PrivateWire<'a>{policy:&'a str,pin:&'a str,ca:String,token:&'a str,directory:&'a Path,operation:&'a str,cleanup_action:Option<&'a str>,binding:&'a Value,local:&'a Value}
 let wire=Zeroizing::new(serde_json::to_vec(&PrivateWire{policy:&config.raw,pin:&config.pin,ca:STANDARD.encode(config.ca.as_slice()),token,directory,operation,cleanup_action:cleanup_action(operation)?,binding,local}).map_err(|_|"Cannot encode private provider exchange")?);
 let runner=r#"
import base64,sys
try:
    wire=decode(sys.stdin.buffer.read(256*1024+1))
    ca=base64.b64decode(wire['ca'],validate=True)
    policy=provider_policy(wire['policy'].encode(),wire['pin'],ca,int(time.time()),cleanup_action=wire['cleanup_action'])
    client=HttpsProvider(policy,ca,wire['token'])
    flow=Authorization(wire['directory'],policy,client.request,cleanup_action=wire['cleanup_action'])
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
 let original=lifecycle::bare_initial(base,&target)?.ok_or("VPN target requires its original native authorization receipt")?;
 let doc=crate::operator_authorization::verify_initial(&original,&target)?;
 let status=lifecycle::execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if status["ok"]!=true{return Err("VPN target authorization is unavailable".into())}
 let context=binding(&target,&status["result"],&doc,&hash(original.as_bytes()))?;
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
 fn fixture()->(Target,Value,Value,String){
  let t=Target{kind:"remote".into(),host:Some("guest.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};
  let doc=json!({"target":t.journal_identity(),"release_id":"original","manifest_sha256":"a".repeat(64),"network_id":"isolated-network","chain_id":999998,"node_name":"validator-test","artifacts":{"formation-context.json":"b".repeat(64)}});
  let selection=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});let pin=hash(doc.to_string().as_bytes());
  let status=json!({"schema":"nodenetwork-engineering-authorization-status-v1","target":doc["target"],"initial_sha256":pin,"selection":selection,"formation_sha256":"b".repeat(64)});(t,doc,status,pin)
 }
 fn upgrade(s:&mut Value){let origin=s["selection"].clone();s["initial_selection"]=origin;s["selection"]["release_id"]=json!("upgraded");s["selection"]["manifest_sha256"]=json!("c".repeat(64));s["update"]=json!({"initial_sha256":s["initial_sha256"],"formation_sha256":s["formation_sha256"],"previous_selection":s["initial_selection"],"selection":s["selection"]});}
 #[test]fn authenticated_upgrade_preserves_exact_original_provider_intent_binding(){
  let(t,doc,mut status,pin)=fixture();let original=binding(&t,&status,&doc,&pin).unwrap();upgrade(&mut status);assert_eq!(binding(&t,&status,&doc,&pin).unwrap(),original);assert_eq!(original["manifest_sha256"],doc["manifest_sha256"]);
  let mut mixed_case=doc.clone();mixed_case["target"]["host"]=json!("GUEST.EXAMPLE");let mut same=status.clone();same["target"]=mixed_case["target"].clone();assert_eq!(binding(&t,&same,&mixed_case,&pin).unwrap(),original);
  // During a reviewed update the still-current previous selection is also valid.
  let adopted=status["selection"].clone();status["selection"]=status["initial_selection"].clone();assert_eq!(binding(&t,&status,&doc,&pin).unwrap(),original);status["selection"]=adopted;
 }
 #[test]fn forged_adoption_or_changed_origin_scope_never_rebinds_existing_vpn(){
  let(t,doc,mut status,pin)=fixture();upgrade(&mut status);
  for field in ["initial_sha256","formation_sha256","selection","previous_selection"]{let mut bad=status.clone();if field=="previous_selection"{bad["update"]["selection"]=Value::Null;}bad["update"][field]=Value::Null;assert!(binding(&t,&bad,&doc,&pin).is_err(),"{field}");}
  for field in ["target","initial_selection","initial_sha256","formation_sha256"]{let mut bad=status.clone();bad[field]=Value::Null;assert!(binding(&t,&bad,&doc,&pin).is_err(),"{field}");}
  for field in ["network_id","chain_id","node_name"]{let mut bad=status.clone();bad["selection"][field]=Value::Null;bad["update"]["selection"]=bad["selection"].clone();assert!(binding(&t,&bad,&doc,&pin).is_err(),"{field}");}
  let mut wrong=t.clone();wrong.host=Some("substituted.example".into());assert!(binding(&wrong,&status,&doc,&pin).is_err());
  let mut no_origin=status;no_origin.as_object_mut().unwrap().remove("initial_selection");assert!(binding(&t,&no_origin,&doc,&pin).is_err());
 }
}

#[cfg(test)]mod cleanup_tests{
 use super::*;
 #[test]fn only_exact_cleanup_actions_can_use_expired_approval_mode(){
  assert_eq!(cleanup_action("revoke").unwrap(),Some("revoke"));assert_eq!(cleanup_action("retire").unwrap(),Some("retire"));
  for op in ["prepare","reconcile"]{assert_eq!(cleanup_action(op).unwrap(),None)}for op in ["enroll","delete","","Revoke"]{assert!(cleanup_action(op).is_err())}
 }
}
