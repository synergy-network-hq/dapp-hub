//! Local public-identity/agent readiness only. Never loads credentials or contacts a host.
use crate::node_controller::Target;
use base64::{engine::general_purpose::STANDARD_NO_PAD,Engine};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::Path,process::Stdio,time::Duration};
use tokio::io::AsyncReadExt;
const LIMIT:usize=128*1024;
fn projection(selected:Option<&str>,code:Option<i32>,raw:&[u8])->Value{
 let selected_sha=selected.map(|s|format!("{:x}",Sha256::digest(s.as_bytes())));
 let parsed=(||{
  if raw.len()>LIMIT{return None}
  let text=std::str::from_utf8(raw).ok()?;
  if code==Some(1)&&(text.trim().is_empty()||text.trim()=="The agent has no identities."){return Some((0,false))}
  if code!=Some(0){return None}
  let lines:Vec<_>=text.lines().collect();if lines.is_empty()||lines.len()>128{return None}
  let mut present=false;
  for line in &lines{
   if line.len()>16384||line.bytes().any(|b|b<32&&b!=b'\t'){return None}
   let mut f=line.split_ascii_whitespace();let kind=f.next()?;let blob=f.next()?;
   if !["ssh-","ecdsa-","sk-"].iter().any(|p|kind.starts_with(p))||blob.len()>12000{return None}
   // Agent rows are public SSH blobs. No comment or other identity is projected.
   let decoded=base64::engine::general_purpose::STANDARD.decode(blob).or_else(|_|STANDARD_NO_PAD.decode(blob)).ok()?;
   if decoded.len()<8{return None}
   let size=u32::from_be_bytes(decoded[..4].try_into().ok()?)as usize;
   if size!=kind.len()||decoded.get(4..4+size)!=Some(kind.as_bytes())||decoded.len()<=4+size{return None}
   if kind=="ssh-ed25519"&&(decoded.len()!=51||decoded.get(15..19)!=Some(&32u32.to_be_bytes()[..])){return None}
   if selected.is_some_and(|s|s==format!("{kind} {blob}")){present=true}
  }Some((lines.len(),present))
 })();
 let (agent_state,count,present)=match parsed{Some((0,_))=>("empty",Some(0),Some(false)),Some((n,p))=>("available",Some(n),Some(p)),None=>("unavailable",None,None)};
 let blocker=if selected.is_none(){Some("selected_identity_unavailable")}else if agent_state=="unavailable"{Some("agent_unavailable")}else if agent_state=="empty"{Some("agent_empty")}else if present!=Some(true){Some("selected_identity_not_loaded")}else{None};
 json!({"schema":"nodenetwork-operator-auth-status-v1","selected_identity_sha256":selected_sha,"agent_state":agent_state,"agent_identity_count":count,"selected_identity_present":present,"ready":blocker.is_none(),"blocker":blocker,"remote_contacted":false,"mutation_performed":false})
}
pub(super) async fn status(target:&Target,directory:&Path)->Result<Value,String>{
 target.validate()?;
 if target.kind!="remote"||target.guest.is_some(){return Err("Local operator readiness currently requires a physical remote target; no host was contacted".into())}
 let selected=crate::node_bootstrap::controller_operator_identity(target,directory)?.map(|p|crate::node_bootstrap::selected_operator_key(&p)).transpose()?;
 let mut command=tokio::process::Command::new("/usr/bin/ssh-add");
 command.arg("-L").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let observed=async{
  let mut child=command.spawn().ok()?;
  let mut raw=Vec::new();child.stdout.take()?.take((LIMIT+1)as u64).read_to_end(&mut raw).await.ok()?;
  if raw.len()>LIMIT{return None}let exit=child.wait().await.ok()?;Some((exit.code(),raw))
 };
 let result=tokio::time::timeout(Duration::from_secs(5),observed).await.ok().flatten();
 Ok(match result{Some((code,raw))=>projection(selected.as_deref(),code,&raw),None=>projection(selected.as_deref(),None,&[])})
}
#[cfg(test)]mod tests{
 use super::*;
 fn key_with(byte:u8)->String{let mut blob=b"\0\0\0\x0bssh-ed25519\0\0\0\x20".to_vec();blob.extend([byte;32]);format!("ssh-ed25519 {}",STANDARD_NO_PAD.encode(blob))}
 fn key()->String{key_with(7)}
 #[test]fn operator_auth_empty_missing_and_wrong_agent_never_report_ready(){
  let k=key();let empty=projection(Some(&k),Some(1),b"The agent has no identities.\n");assert_eq!(empty["blocker"],"agent_empty");assert_eq!(empty["ready"],false);
  assert_eq!(projection(None,Some(1),b"")["blocker"],"selected_identity_unavailable");
  let other=format!("{} private-comment\n",key_with(8));assert_eq!(projection(Some(&k),Some(0),other.as_bytes())["blocker"],"selected_identity_not_loaded");
 }
 #[test]fn operator_auth_request_is_local_read_and_rejects_parameters(){
  let mut request=crate::node_controller::Request{version:1,operation:"operator_auth_status".into(),parameters:json!({})};assert_eq!(request.validate(),Ok(false));
  request.parameters=json!({"socket":"foreign"});assert!(request.validate().is_err());
 }
 #[test]fn operator_auth_exact_public_identity_only_and_bounded_failure(){
  let k=key();let v=projection(Some(&k),Some(0),format!("{k} SECRET-COMMENT\n").as_bytes());assert_eq!(v["ready"],true);assert!(!v.to_string().contains("SECRET"));assert!(!v.to_string().contains(&k));
  for raw in [vec![b'x';LIMIT+1],b"garbage\n".to_vec(),format!("{k}\0\n").into_bytes()]{assert_eq!(projection(Some(&k),Some(0),&raw)["blocker"],"agent_unavailable")}
  assert_eq!(projection(Some(&k),Some(2),b"private error")["agent_state"],"unavailable");
 }
}
