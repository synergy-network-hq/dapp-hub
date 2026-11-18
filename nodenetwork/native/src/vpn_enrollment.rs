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
fn enrollment_controller_refusal(reply:&Value)->String{
 // Only fixed public codes/messages produced by the sealed controller survive.
 // Arbitrary remote error strings can contain secrets and are never reflected.
 match reply["error"]["code"].as_str(){
  Some("vpn_reconciliation_required")=>"vpn_reconciliation_required: VPN enrollment did not return a verified receipt. Read VPN diagnostics and reconcile the original intent; never issue another key.".into(),
  Some("authorization_required")=>"authorization_required: Controller refused the original VPN authorization. Read target authorization and diagnostics; never reissue a key.".into(),
  _=>"Enrollment outcome uncertain; read VPN diagnostics and reconcile provider and target, never issue another key".into(),
 }
}

fn state_directory(base:&Path,target:&Target)->Result<std::path::PathBuf,String>{
 let physical=hash(target.journal_identity().to_string().as_bytes());
 let name=if let Some(pin)=lifecycle::incarnation(base,&target.journal_identity())?{format!("{physical}-{pin}")}else{physical};
 Ok(base.join("nodenetwork-vpn-v1").join(name))
}
/// Local immutable provider receipts are never inferred from target booleans.
/// The provider wrote retired.json only after exact peer GET404 and list absence.
pub(super) fn require_terminal(base:&Path,target:&Target,doc:&Value)->Result<(),String>{
 let directory=state_directory(base,target)?;
 if !directory.exists()&&!directory.is_symlink(){return Ok(())}
 for path in directory.ancestors(){if !path.symlink_metadata().is_ok_and(|m|m.is_dir()){return Err("Unsafe original provider state ancestry".into())}}
 let load=|name:&str|->Result<Value,String>{serde_json::from_slice(&read(&directory.join(name),32768,true)?).map_err(|_|"Invalid original provider terminal receipt".into())};
 let intent=load("intent.json")?;let bound=load("bound.json")?;let retired=load("retired.json")?;let deletion=load("retire-intent.json")?;
 let expected=json!({"target_sha256":hash(target.journal_identity().to_string().as_bytes()),"manifest_sha256":doc["manifest_sha256"],"formation_sha256":doc["artifacts"]["formation-context.json"],"network_id":doc["network_id"],"chain_id":doc["chain_id"]});
 let identifier=|v:&Value|v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=253&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_.-".contains(&b)));
 let pin=|v:&Value|v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 if [&intent["account_id"],&intent["name"],&bound["peer_id"],&bound["name"],&bound["hostname"],&bound["provider_account_id"]].iter().any(|v|!identifier(v))||bound["provider_account_id"]!=intent["account_id"]||bound["new_peer_verified"]!=true||bound["one_off_usage_verified"]!=true||bound["ip"].as_str().is_none_or(|s|s.parse::<std::net::IpAddr>().is_err())||bound["wireguard_public_key"].as_str().and_then(|s|STANDARD.decode(s).ok()).is_none_or(|b|b.len()!=32)||[&intent["provider_sha256"],&deletion["enrollment_sha256"],&deletion["binding_sha256"]].iter().any(|v|!pin(v)){return Err("Original provider retirement lacks exact typed attribution and commitments".into())}

 if intent["binding"]!=expected||bound["binding"]!=expected||deletion["binding"]!=expected||retired["format"]!="synergy-vpn-retirement-v1"||retired["retired"]!=true||retired["absence_verified"]!=true||retired["account_id"]!=intent["account_id"]||retired["peer_name"]!=intent["name"]||retired["peer_id"]!=bound["peer_id"]||retired["peer_name"]!=bound["name"]||retired["hostname"]!=bound["hostname"]||retired["ip"]!=bound["ip"]||deletion["peer_id"]!=bound["peer_id"]||retired["enrollment_sha256"]!=deletion["enrollment_sha256"]||retired["binding_sha256"]!=deletion["binding_sha256"]{return Err("Original provider peer is not exactly retired; reconcile without issuing new access".into())}
 Ok(())
}
pub async fn execute(base:&Path,target:Target,control:&Path,config_directory:&Path,credential_path:&Path,operation:&str)->Result<Value,String>{
 let _serial=SERIAL.lock().await;
 if !matches!(operation,"enroll"|"reconcile"|"revoke"|"retire"){return Err("Unsupported native VPN workflow".into())}
 let config=config(config_directory)?;
 let credential=crate::vpn_credential::load(read(credential_path,16384,true)?,&config.pin,config.policy["profile"]=="nodenetwork-controlled-canary-v1",control).await?;
 let original=lifecycle::bare_initial(base,&target)?.ok_or("VPN target requires its original native authorization receipt")?;
 let doc=crate::operator_authorization::verify_initial(&original,&target)?;
 let status=lifecycle::execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if status["ok"]!=true{return Err("VPN target authorization is unavailable".into())}
 let context=binding(&target,&status["result"],&doc,&hash(original.as_bytes()))?;
 let app=base.join("nodenetwork-vpn-v1");if !app.exists(){#[cfg(unix)]{use std::os::unix::fs::DirBuilderExt;std::fs::DirBuilder::new().mode(0o700).create(&app).map_err(|_|"Cannot protect native VPN state")?;}}
 let directory=state_directory(base,&target)?;
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
  if result["ok"]!=true{return Err(enrollment_controller_refusal(&result))}
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
 pub(super) fn fixture()->(Target,Value,Value,String){
  let t=Target{kind:"remote".into(),host:Some("guest.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};
  let doc=json!({"target":t.journal_identity(),"release_id":"original","manifest_sha256":"a".repeat(64),"network_id":"isolated-network","chain_id":999998,"node_name":"validator-test","artifacts":{"formation-context.json":"b".repeat(64)}});
  let selection=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});let pin=hash(doc.to_string().as_bytes());
  let status=json!({"schema":"nodenetwork-engineering-authorization-status-v1","target":doc["target"],"initial_sha256":pin,"selection":selection,"formation_sha256":"b".repeat(64)});(t,doc,status,pin)
 }
 fn upgrade(s:&mut Value){let origin=s["selection"].clone();s["initial_selection"]=origin;s["selection"]["release_id"]=json!("upgraded");s["selection"]["manifest_sha256"]=json!("c".repeat(64));s["update"]=json!({"initial_sha256":s["initial_sha256"],"formation_sha256":s["formation_sha256"],"previous_selection":s["initial_selection"],"selection":s["selection"]});}
 #[test]fn controller_enrollment_refusal_preserves_only_public_categories(){
  let error=json!({"error":{"code":"vpn_reconciliation_required","message":"secret-token-not-public"}});
  let public=enrollment_controller_refusal(&error);assert!(public.starts_with("vpn_reconciliation_required:"));assert!(!public.contains("secret-token"));
  assert!(enrollment_controller_refusal(&json!({"error":{"code":"authorization_required"}})).starts_with("authorization_required:"));
  let error=json!({"error":{"code":"untrusted-secret-code","message":"untrusted-secret-message"}});assert!(!enrollment_controller_refusal(&error).contains("untrusted-secret"));
 }
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

#[cfg(test)]mod reinstallation_tests{
 use super::*;
 fn write(path:&Path,value:&Value){std::fs::write(path,value.to_string()).unwrap();#[cfg(unix)]{use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(path,std::fs::Permissions::from_mode(0o600)).unwrap();}}
 #[test]fn original_provider_must_be_exactly_retired_and_new_incarnation_has_separate_state(){
  let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-vpn-retired-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
  struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(base.clone());std::fs::create_dir(&base).unwrap();
  let(t,doc,status,pin)=super::tests::fixture();let binding=super::binding(&t,&status,&doc,&pin).unwrap();
  assert!(require_terminal(&base,&t,&doc).is_ok());let directory=state_directory(&base,&t).unwrap();std::fs::create_dir_all(&directory).unwrap();assert!(require_terminal(&base,&t,&doc).is_err());
  let intent=json!({"binding":binding,"account_id":"account","name":"exact","provider_sha256":"c".repeat(64)});let bound=json!({"binding":binding,"peer_id":"peer","name":"exact","hostname":"host","ip":"100.64.0.2","provider_account_id":"account","wireguard_public_key":STANDARD.encode([3u8;32]),"new_peer_verified":true,"one_off_usage_verified":true});
  let deletion=json!({"binding":binding,"peer_id":"peer","enrollment_sha256":"a".repeat(64),"binding_sha256":"b".repeat(64)});
  let retired=json!({"format":"synergy-vpn-retirement-v1","retired":true,"absence_verified":true,"account_id":"account","peer_id":"peer","peer_name":"exact","hostname":"host","ip":"100.64.0.2","enrollment_sha256":"a".repeat(64),"binding_sha256":"b".repeat(64)});
  for(n,v)in[("intent.json",&intent),("bound.json",&bound),("retire-intent.json",&deletion),("retired.json",&retired)]{write(&directory.join(n),v)}assert!(require_terminal(&base,&t,&doc).is_ok());
  for key in["retired","absence_verified","peer_id","peer_name","account_id","ip","enrollment_sha256","binding_sha256"]{let mut wrong=retired.clone();wrong[key]=Value::Null;write(&directory.join("retired.json"),&wrong);assert!(require_terminal(&base,&t,&doc).is_err(),"{key}");}write(&directory.join("retired.json"),&retired);
  // Matching absent JSON fields must never count as attribution (Null != proof).
  for key in["account_id","name","peer_id","hostname","ip","enrollment_sha256","binding_sha256","provider_account_id","wireguard_public_key","new_peer_verified","one_off_usage_verified","provider_sha256"]{
   for(n,v)in[("intent.json",&intent),("bound.json",&bound),("retire-intent.json",&deletion),("retired.json",&retired)]{let mut missing=v.clone();missing.as_object_mut().unwrap().remove(key);write(&directory.join(n),&missing)}assert!(require_terminal(&base,&t,&doc).is_err(),"missing {key}");
  }
  for(n,v)in[("intent.json",&intent),("bound.json",&bound),("retire-intent.json",&deletion),("retired.json",&retired)]{write(&directory.join(n),v)}
  let mut foreign=doc.clone();foreign["manifest_sha256"]=json!("f".repeat(64));assert!(require_terminal(&base,&t,&foreign).is_err());
  let app=base.join("nodenetwork-engineering-v1");std::fs::create_dir(&app).unwrap();#[cfg(unix)]{use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(&app,std::fs::Permissions::from_mode(0o700)).unwrap();}
  write(&app.join(format!("incarnation-{}.json",hash(t.journal_identity().to_string().as_bytes()))),&json!({"initial_sha256":"f".repeat(64),"target_sha256":hash(t.journal_identity().to_string().as_bytes())}));assert_ne!(state_directory(&base,&t).unwrap(),directory);assert!(directory.join("retired.json").exists());
 }
}
