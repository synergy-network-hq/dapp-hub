//! Host-relative guest management. SSH is management transport, never native authority.
use crate::{commands,guest_hosts,node_controller::{self,Target}};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use base64::{engine::general_purpose::STANDARD,Engine};
use std::{path::{Path,PathBuf}};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};

#[derive(Clone,Debug,Deserialize,Serialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct GuestBinding{pub guest_id:String,pub create_request_sha256:String,pub ssh_host_public_key:String,pub ssh_host_fingerprint:String}
impl GuestBinding{
 pub fn validate(&self)->Result<(),String>{
  let id=&self.guest_id;
  if id.is_empty()||id.len()>32||!id.as_bytes()[0].is_ascii_lowercase()||!id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')||self.create_request_sha256.len()!=64||!self.create_request_sha256.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("Invalid managed guest creation binding".into())}
  let encoded=self.ssh_host_public_key.strip_prefix("ssh-ed25519 ").ok_or("Unsupported guest management SSH key")?;
  let bytes=STANDARD.decode(encoded).map_err(|_|"Malformed guest SSH key")?;
  if bytes.len()!=51||bytes[..19]!=*b"\0\0\0\x0bssh-ed25519\0\0\0 "||STANDARD.encode(&bytes)!=encoded||self.ssh_host_fingerprint!=format!("SHA256:{}",STANDARD.encode(Sha256::digest(&bytes)).trim_end_matches('=')){return Err("Guest SSH key and fingerprint differ".into())}Ok(())
 }
}
fn quote(s:&str)->String{format!("'{}'",s.replace('\'',"'\\''"))}
fn alias(target:&Target)->String{format!("synergy-guest-{:x}",Sha256::digest(target.journal_identity().to_string().as_bytes()))}
fn header(binding:&GuestBinding)->Result<String,String>{
 binding.validate()?;let mut value=json!({"guest_id":binding.guest_id,"create_request_sha256":binding.create_request_sha256,"ssh_host_fingerprint":binding.ssh_host_fingerprint});value.sort_all_objects();
 let result=format!("SYNERGY-GUEST-SSH/1 {value}");if result.len()+1>1024{return Err("Guest channel header exceeds bound".into())}Ok(result)
}
fn proxy_command(binding:&GuestBinding,args:&[String])->Result<String,String>{
 // OpenSSH executes `exec PROXY`; a bare brace/pipeline is not a command
 // following exec. The explicit shell owns only this fixed, quoted pipeline.
 let pipeline=format!("{{ /usr/bin/printf '%s\\n' {}; /bin/cat; }} | {}",quote(&header(binding)?),args.iter().map(|s|quote(s)).collect::<Vec<_>>().join(" "));
 Ok(format!("/bin/sh -c {}",quote(&pipeline)))
}
fn pin_file(directory:&Path,target:&Target,binding:&GuestBinding)->Result<PathBuf,String>{
 let bytes=format!("{} {}\n",alias(target),binding.ssh_host_public_key);let file=directory.join(format!("guest-{:x}.known-hosts",Sha256::digest(bytes.as_bytes())));
 if file.exists()||file.is_symlink(){let m=std::fs::symlink_metadata(&file).map_err(|_|"Guest host pin unavailable")?;
  #[cfg(unix)]{use std::os::unix::fs::MetadataExt;if m.uid()!=unsafe{libc::geteuid()}||m.mode()&0o777!=0o600||m.nlink()!=1{return Err("Guest host pin ownership changed".into())}}
  if !m.is_file()||m.len()>2048||std::fs::read(&file).map_err(|_|"Cannot read public guest pin")?!=bytes.as_bytes(){return Err("Public guest SSH identity changed".into())}
 }else{use std::io::Write;let mut o=std::fs::OpenOptions::new();o.write(true).create_new(true);
  #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;o.mode(0o600);}
  o.open(&file).map_err(|_|"Cannot save public guest pin")?.write_all(bytes.as_bytes()).map_err(|_|"Cannot save public guest pin")?;
 }Ok(file)
}
pub(super) fn remote_command(target:&Target,directory:&Path,account:&str,remote:&str)->Result<tokio::process::Command,String>{
 target.validate()?;if !matches!(account,"synergy"|"synergy-nodenetwork"){return Err("Guest account must match the approved managed image".into())}
 #[cfg(unix)]node_controller::protect_control_directory(directory)?;
 let binding=target.guest.as_ref().ok_or("Missing managed guest binding")?;
 let mut physical=target.clone();physical.guest=None;
 let pin=pin_file(directory,target,binding)?;
 let host_socket=node_controller::control_socket(&physical,directory,"synergy-nodenetwork");
 let args=["/usr/bin/ssh".to_owned(),"-F".into(),"/dev/null".into(),"-T".into(),"-S".into(),host_socket.to_string_lossy().into_owned(),"-oControlMaster=no".into(),"-oProxyCommand=/usr/bin/false".into(),"-oBatchMode=yes".into(),"-oStrictHostKeyChecking=yes".into(),"-oForwardAgent=no".into(),"-oClearAllForwardings=yes".into(),"-p".into(),physical.port.unwrap_or(22).to_string(),"--".into(),format!("synergy-nodenetwork@{}",physical.host.as_deref().ok_or("Missing physical host")?.trim_matches(['[',']'])),"/usr/bin/true".into()];
 let proxy=proxy_command(binding,&args)?;
 let mut c=tokio::process::Command::new("/usr/bin/ssh");
 c.args(["-F","/dev/null","-T","-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oUpdateHostKeys=no","-oPasswordAuthentication=no","-oKbdInteractiveAuthentication=no","-oForwardAgent=no","-oClearAllForwardings=yes","-oHostKeyAlgorithms=ssh-ed25519","-oGlobalKnownHostsFile=/dev/null","-oConnectTimeout=10","-oServerAliveInterval=15","-oServerAliveCountMax=2","-oControlMaster=auto","-oControlPersist=600"])
 .arg("-o").arg(format!("UserKnownHostsFile={}",pin.display())).arg("-o").arg(format!("HostKeyAlias={}",alias(target))).arg("-o").arg(format!("ControlPath={}",node_controller::control_socket(target,directory,account).display())).arg("-o").arg(format!("ProxyCommand={}",proxy.replace('%',"%%")))
 .arg("--").arg(format!("{account}@managed-guest.invalid")).arg(remote);
 Ok(c)
}
// Fixed read-only command: no bootstrap, credential issue or service mutation.
const CONNECTION_PROBE:&str="/bin/sh -c '/usr/bin/sudo -n /usr/bin/true >/dev/null 2>&1 || exit 77; /usr/bin/printf \"SYNERGY-GUEST-READY/1\\n\"'";
async fn probe_command(mut command:tokio::process::Command)->&'static str{
 use tokio::io::AsyncReadExt;
 use std::process::Stdio;
 command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let Ok(mut child)=command.spawn() else{return "guest_ssh_unavailable"};
 let Some(output)=child.stdout.take() else{return "guest_ssh_unavailable"};
 let result=tokio::time::timeout(std::time::Duration::from_secs(20),async{
  let mut bytes=Vec::new();output.take(1025).read_to_end(&mut bytes).await.ok()?;
  if bytes.len()>1024{return None}
  let status=child.wait().await.ok()?;
  Some(match status.code(){
   Some(0) if bytes==b"SYNERGY-GUEST-READY/1\n"=>"ready",
   Some(77)=>"guest_sudo_unavailable",
   _=>"guest_ssh_unavailable",
  })
 }).await;
 match result{Ok(Some(code))=>code,_=>"guest_ssh_unavailable"}
}
pub(crate) async fn connection_probe(target:&Target,current:&Value,directory:&Path)->Result<&'static str,String>{
 if target.kind!="remote"||target.guest.is_some(){return Err("Choose the physical hosting target for guest connection diagnostics".into())}
 if current["phase"]!="created"||current["service_state"]!="active"||current["pid"].as_u64().is_none_or(|p|p==0)||current["ssh_identity_verified"]!=true{return Ok("guest_inactive")}
 let binding:GuestBinding=serde_json::from_value(json!({"guest_id":current["guest_id"],"create_request_sha256":current["request_sha256"],"ssh_host_public_key":current["ssh_host_public_key"],"ssh_host_fingerprint":current["ssh_host_fingerprint"]})).map_err(|_|"Incomplete guest connection binding")?;
 binding.validate()?;
 let _serial=node_controller::SERIAL.lock().await;
 let check=tokio::time::timeout(std::time::Duration::from_secs(3),tokio::process::Command::new("/usr/bin/ssh")
  .args(["-F","/dev/null","-S"]).arg(node_controller::control_socket(target,directory,"synergy-nodenetwork"))
  .args(["-O","check","--"]).arg(target.host.as_deref().ok_or("Missing physical host")?)
  .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status()).await;
 if !matches!(check,Ok(Ok(status)) if status.success()){return Ok("physical_mux_unavailable")}
 let mut guest=target.clone();guest.guest=Some(binding);
 let command=remote_command(&guest,directory,"synergy",CONNECTION_PROBE)?;
 // Guest channel rechecks the same active creation receipt; inner SSH proves
 // its pinned host key before the fixed sudo probe. No account is provisioned.
 Ok(probe_command(command).await)
}

#[tauri::command]
pub async fn portal_nodenetwork_select_guest(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target,guest_id:String)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;
 if target.guest.is_some()||target.kind!="remote"{return Err("Select the physical hosting machine, not another guest".into())}
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let reply=commands::controller(&app,target.clone(),node_controller::Request{version:1,operation:"guest_status".into(),parameters:json!({"guest_id":guest_id})},&control).await?;
 if reply["ok"]!=true{return Err("Hosting machine did not authenticate this guest".into())}
 let status=guest_hosts::status(&reply["result"],&guest_id)?;
 if status["phase"]!="created"||status["service_state"]!="active"||status["pid"].as_u64().is_none_or(|p|p==0)||status["ssh_identity_verified"]!=true{return Err("Guest is not an attributed active managed instance".into())}
 let binding:GuestBinding=serde_json::from_value(json!({"guest_id":guest_id,"create_request_sha256":status["request_sha256"],"ssh_host_public_key":status["ssh_host_public_key"],"ssh_host_fingerprint":status["ssh_host_fingerprint"]})).map_err(|_|"Incomplete guest binding")?;binding.validate()?;
 let message=format!("Hosting machine: {}\nGuest: {}\nCreation request: {}\nGuest SSH key: {}\n\nSelect this host-relative managed guest. Its loopback endpoint is on the hosting machine, never this Portal device. Every channel rechecks the host receipt and proves the guest SSH key. This does not install software, grant membership or prove boot/VPN readiness.",target.label(),binding.guest_id,binding.create_request_sha256,binding.ssh_host_fingerprint);
 let yes=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Select authenticated managed guest").buttons(MessageDialogButtons::OkCancelCustom("Select this guest".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Guest selection interrupted")?;
 if !yes{return Ok(None)}let mut selected=target;selected.guest=Some(binding);Ok(Some(selected.journal_identity()))
}

#[cfg(test)]mod tests{
 use super::*;
 fn binding()->GuestBinding{let bytes=[b"\0\0\0\x0bssh-ed25519\0\0\0 ".as_slice(),&[7u8;32]].concat();GuestBinding{guest_id:"validator-guest".into(),create_request_sha256:"a".repeat(64),ssh_host_public_key:format!("ssh-ed25519 {}",STANDARD.encode(&bytes)),ssh_host_fingerprint:format!("SHA256:{}",STANDARD.encode(Sha256::digest(bytes)).trim_end_matches('='))}}
 fn target()->Target{Target{kind:"remote".into(),host:Some("host.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:Some(binding())}}
 #[test]fn exact_guest_binding_changes_journal_and_never_becomes_portal_loopback(){let t=target();assert!(t.validate().is_ok());assert_eq!(t.journal_identity()["host"],"host.example");assert_eq!(t.journal_identity()["guest"]["guest_id"],"validator-guest");let mut physical=t.clone();physical.guest=None;assert_ne!(t.journal_identity(),physical.journal_identity());let mut wrong=t.clone();wrong.guest.as_mut().unwrap().ssh_host_fingerprint="SHA256:changed".into();assert!(wrong.validate().is_err());wrong=t;wrong.kind="local".into();wrong.host=None;wrong.port=None;assert!(wrong.validate().is_err());}
 #[test]fn guest_proxy_can_only_reuse_physical_mux_and_pins_inner_identity(){
  let directory=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-guest-proxy-{}",std::process::id()));assert!(!directory.exists());std::fs::create_dir(&directory).unwrap();
  #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(&directory,std::fs::Permissions::from_mode(0o700)).unwrap();}
  struct Clean(PathBuf);impl Drop for Clean{fn drop(&mut self){std::fs::remove_dir_all(&self.0).unwrap();}}let _clean=Clean(directory.clone());
  let t=target();let command=remote_command(&t,&directory,"synergy","/usr/bin/true").unwrap();let args:Vec<_>=command.as_std().get_args().map(|s|s.to_string_lossy().into_owned()).collect();
  let proxy=args.iter().find(|s|s.starts_with("ProxyCommand=")).unwrap();assert!(proxy.contains("-oControlMaster=no"));assert!(proxy.contains("-oProxyCommand=/usr/bin/false"));assert!(proxy.contains("-oForwardAgent=no"));assert!(proxy.contains("SYNERGY-GUEST-SSH/1 "));assert!(!proxy.contains("-W"));assert!(!proxy.contains("ssh_host_public_key"));assert!(args.iter().any(|s|s=="-oStrictHostKeyChecking=yes"));assert!(args.iter().any(|s|s.starts_with("HostKeyAlias=synergy-guest-")));
  let mut host=t.clone();host.guest=None;assert_ne!(node_controller::control_socket(&host,&directory,"synergy-nodenetwork"),node_controller::control_socket(&t,&directory,"synergy-nodenetwork"));assert!(remote_command(&t,&directory,"root","anything").is_err());
  let pin=pin_file(&directory,&t,t.guest.as_ref().unwrap()).unwrap();std::fs::write(pin,b"changed public key").unwrap();assert!(remote_command(&t,&directory,"synergy","/usr/bin/true").is_err());
 }
 #[tokio::test(flavor="current_thread")]
 async fn guest_connection_probe_classifies_only_fixed_bounded_read_results(){
  for (exit,stdout,expected) in [(0,"SYNERGY-GUEST-READY/1\n","ready"),(77,"","guest_sudo_unavailable"),(255,"","guest_ssh_unavailable"),(0,"foreign bytes","guest_ssh_unavailable"),(17,"private remote error","guest_ssh_unavailable")]{
   let mut command=tokio::process::Command::new("/usr/bin/python3");
   command.args(["-I","-B","-c",&format!("import sys\nsys.stdout.write({stdout:?})\nsys.stderr.write('SECRET STDERR')\nsys.exit({exit})")]);
   assert_eq!(probe_command(command).await,expected);
  }
  let mut command=tokio::process::Command::new("/usr/bin/python3");command.args(["-I","-B","-c","print('x'*1025)"]);
  assert_eq!(probe_command(command).await,"guest_ssh_unavailable");
 }
 #[tokio::test(flavor="current_thread")]
 async fn guest_connection_inactive_refuses_before_any_transport(){
  let mut physical=target();physical.guest=None;
  assert_eq!(connection_probe(&physical,&json!({"phase":"created","service_state":"inactive","pid":0,"ssh_identity_verified":true}),Path::new("/nonexistent")).await.unwrap(),"guest_inactive");
  assert!(connection_probe(&target(),&json!({}),Path::new("/nonexistent")).await.is_err());
  assert!(!CONNECTION_PROBE.contains("bootstrap"));assert!(!CONNECTION_PROBE.contains("controller.py"));assert!(!CONNECTION_PROBE.contains("setup-key"));
 }
 #[test]fn openssh_exec_proxy_shell_preserves_exact_header_and_binary_stream(){
  use std::{io::Write,process::{Command,Stdio}};
  let g=binding();
  let script="import sys,signal; signal.alarm(3); data=sys.stdin.buffer.read(4096); sys.stdout.buffer.write(data)";
  let consumer=vec!["/usr/bin/python3".to_owned(),"-I".into(),"-B".into(),"-c".into(),script.into(),"harmless ' quoted % argument".into()];
  let proxy=proxy_command(&g,&consumer).unwrap();assert!(proxy.starts_with("/bin/sh -c '"));
  // Match OpenSSH's percent expansion before its `exec PROXY` shell call.
  let configured=proxy.replace('%',"%%");let expanded=configured.replace("%%","%");
  let raw=b"SSH-2.0-offline-client\r\n\0binary\xff'$(must-not-execute)";
  for shell in ["/bin/sh","/bin/bash"]{
   let mut child=Command::new(shell).args(["-c",&format!("exec {expanded}")])
    .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
   child.stdin.take().unwrap().write_all(raw).unwrap();
   let output=child.wait_with_output().unwrap();assert!(output.status.success());assert!(output.stderr.is_empty());
   let expected=[header(&g).unwrap().as_bytes(),b"\n",raw].concat();assert_eq!(output.stdout,expected);
  }
 }
 #[test]fn header_has_only_canonical_current_receipt_scope(){let g=binding();let line=header(&g).unwrap();let value:Value=serde_json::from_str(line.strip_prefix("SYNERGY-GUEST-SSH/1 ").unwrap()).unwrap();assert_eq!(value.as_object().unwrap().len(),3);assert_eq!(value["create_request_sha256"],g.create_request_sha256);let mut bad=g;bad.guest_id="../host".into();assert!(header(&bad).is_err());}
}
