//! Explicit local OS credential activation. The trusted local OS user owns ~/.ssh.
//! This detects ordinary replacement races; it does not isolate a hostile same-UID process.
use crate::node_controller::Target;
use base64::{engine::general_purpose::STANDARD,Engine};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::Read,path::{Path,PathBuf}};
#[cfg(target_os="macos")]
use std::{process::Stdio,time::Duration};
use std::os::unix::fs::{MetadataExt,OpenOptionsExt};
const REFUSED:&str="The selected existing SSH credential could not be safely bound. No credential was loaded.";
const LIFE:u64=3600;
#[derive(Clone,PartialEq,Eq,Debug)]
struct Stamp{dev:u64,ino:u64,len:u64,mode:u32,uid:u32,links:u64,mtime:(i64,i64),ctime:(i64,i64)}
fn stamp(m:&fs::Metadata)->Stamp{Stamp{dev:m.dev(),ino:m.ino(),len:m.len(),mode:m.mode(),uid:m.uid(),links:m.nlink(),mtime:(m.mtime(),m.mtime_nsec()),ctime:(m.ctime(),m.ctime_nsec())}}
fn owned(path:&Path,directory:bool,private:bool)->Result<Stamp,String>{
 let m=fs::symlink_metadata(path).map_err(|_|REFUSED)?;
 if m.file_type().is_symlink()||m.uid()!=unsafe{libc::geteuid()}||m.mode()&0o022!=0||directory!=m.is_dir()||(!directory&&(!m.is_file()||m.nlink()!=1))||private&&m.mode()&0o777!=if directory{0o700}else{0o600}{return Err(REFUSED.into())}Ok(stamp(&m))
}
fn open(path:&Path,private:bool)->Result<(File,Stamp),String>{let before=owned(path,false,private)?;let f=OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK).open(path).map_err(|_|REFUSED)?;if stamp(&f.metadata().map_err(|_|REFUSED)?)!=before{return Err(REFUSED.into())}Ok((f,before))}
fn public_text(path:&Path)->Result<String,String>{let(f,s)=open(path,false)?;if s.len>65536{return Err(REFUSED.into())}let mut v=String::new();f.take(65537).read_to_string(&mut v).map_err(|_|REFUSED)?;if v.len()>65536||owned(path,false,false)?!=s{return Err(REFUSED.into())}Ok(v)}
// Read only the armored public prefix, one source byte at a time. Never decode/decrypt
// the encrypted private field. A final base64 character may share unused padding bits.
struct Prefix<R>{r:R,bits:u32,count:u8,source:usize}
impl<R:Read> Prefix<R>{
 fn byte(&mut self)->Result<u8,String>{loop{if self.count>=8{self.count-=8;return Ok(((self.bits>>self.count)&255)as u8)}let mut c=[0];self.r.read_exact(&mut c).map_err(|_|REFUSED)?;self.source+=1;if self.source>8192{return Err(REFUSED.into())}if matches!(c[0],b'\n'|b'\r'){continue}let n=match c[0]{b'A'..=b'Z'=>c[0]-b'A',b'a'..=b'z'=>c[0]-b'a'+26,b'0'..=b'9'=>c[0]-b'0'+52,b'+'=>62,b'/'=>63,_=>return Err(REFUSED.into())};self.bits=(self.bits<<6)|u32::from(n);self.count+=6;}}
 fn bytes(&mut self,n:usize)->Result<Vec<u8>,String>{if n>2048{return Err(REFUSED.into())}(0..n).map(|_|self.byte()).collect()}
 fn number(&mut self)->Result<u32,String>{Ok(u32::from_be_bytes(self.bytes(4)?.try_into().map_err(|_|REFUSED)?))}
 fn string(&mut self)->Result<Vec<u8>,String>{let n=self.number()? as usize;self.bytes(n)}
}
fn container_public<R:Read>(mut r:R)->Result<(Vec<u8>,bool),String>{
 let mut header=[0;36];r.read_exact(&mut header).map_err(|_|REFUSED)?;if &header!=b"-----BEGIN OPENSSH PRIVATE KEY-----\n"{return Err(REFUSED.into())}
 let mut p=Prefix{r,bits:0,count:0,source:0};if p.bytes(15)?!=b"openssh-key-v1\0"{return Err(REFUSED.into())}
 let cipher=p.string()?;let kdf=p.string()?;let options=p.string()?;
 let bcrypt=options.get(..4).map(|v|u32::from_be_bytes(v.try_into().expect("four bytes"))as usize).is_some_and(|n|n>0&&n<=1024&&options.len()==n+8&&options[options.len()-4..]!=[0;4]);
 if !((cipher==b"none"&&kdf==b"none"&&options.is_empty())||(cipher==b"aes256-ctr"&&kdf==b"bcrypt"&&bcrypt)){return Err(REFUSED.into())}
 if p.number()?!=1{return Err(REFUSED.into())}let key=p.string()?;
 if key.len()!=51||!key.starts_with(b"\0\0\0\x0bssh-ed25519\0\0\0\x20"){return Err(REFUSED.into())}Ok((key,cipher!=b"none"))
}
struct Binding{path:PathBuf,file:File,stamp:Stamp,parents:Vec<(PathBuf,Stamp)>,selected:String,encrypted:bool}
impl Binding{fn unchanged(&self)->Result<(),String>{if stamp(&self.file.metadata().map_err(|_|REFUSED)?)!=self.stamp||owned(&self.path,false,true)?!=self.stamp{return Err(REFUSED.into())}for(p,s)in &self.parents{if owned(p,true,p.file_name().is_some_and(|n|n==".ssh"||n=="config.d"))?!=*s{return Err(REFUSED.into())}}Ok(())}}
fn mapping(home:&Path,target:&Target,selected:&str)->Result<Binding,String>{
 if target.kind!="remote"||target.guest.is_some(){return Err(REFUSED.into())}target.validate()?;
 let ssh=home.join(".ssh");let mut parents=vec![(home.to_owned(),owned(home,true,false)?),(ssh.clone(),owned(&ssh,true,true)?)];
 let main=public_text(&ssh.join("config"))?;let mut include=false;let mut section=false;
 for line in main.lines(){let f=line.split('#').next().unwrap_or("").split_ascii_whitespace().collect::<Vec<_>>();if f.is_empty(){continue}if f[0].eq_ignore_ascii_case("Host")||f[0].eq_ignore_ascii_case("Match"){section=true}if f[0].eq_ignore_ascii_case("Include"){if section||f.len()!=2||f[1]!="~/.ssh/config.d/*"{return Err(REFUSED.into())}include=true}}
 let mut configs=vec![(main,true)];
 let snippets=ssh.join("config.d");if include&&snippets.exists(){parents.push((snippets.clone(),owned(&snippets,true,true)?));let mut paths=fs::read_dir(&snippets).map_err(|_|REFUSED)?.map(|e|e.map(|e|e.path()).map_err(|_|REFUSED)).collect::<Result<Vec<_>,_>>()?;if paths.len()>64{return Err(REFUSED.into())}paths.sort();for p in paths{if p.file_name().is_some_and(|n|n.to_string_lossy().starts_with('.')){continue}configs.push((public_text(&p)?,false));}}
 let mut candidates=Vec::new();
 for(text,root_config)in configs{let mut host=None::<String>;let mut port=22u16;let mut ids=Vec::<String>::new();let mut block=false;
  let mut flush=|host:&Option<String>,port:u16,ids:&mut Vec<String>|{if host.as_deref()==target.host.as_deref()&&port==target.port.unwrap_or(22){candidates.append(ids)}else{ids.clear()}};
  for line in text.lines().chain(["Host __end__"]){let line=line.split('#').next().unwrap_or("").trim();if line.is_empty(){continue}let fields:Vec<_>=line.split_ascii_whitespace().collect();let key=fields[0].to_ascii_lowercase();if key=="host"{flush(&host,port,&mut ids);host=None;port=22;block=fields.len()==2&&!fields[1].contains(['*','?','!']);continue}if key=="match"{return Err(REFUSED.into())}if key=="include"{if !root_config||fields.len()!=2||fields[1]!="~/.ssh/config.d/*"{return Err(REFUSED.into())}continue}if !block{continue}match key.as_str(){"hostname"=>{if fields.len()!=2||host.is_some(){return Err(REFUSED.into())}host=Some(fields[1].to_ascii_lowercase())},"port"=>{if fields.len()!=2{return Err(REFUSED.into())}port=fields[1].parse().map_err(|_|REFUSED)?},"identityfile"=>{if fields.len()!=2{return Err(REFUSED.into())}ids.push(fields[1].to_owned())},_=>{}}
  }
 }
 let mut found=None;
 for name in candidates{let Some(name)=name.strip_prefix("~/.ssh/").or_else(||name.strip_prefix(ssh.to_str()?).and_then(|n|n.strip_prefix('/')) )else{continue};if name.is_empty()||!name.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)){continue}let path=ssh.join(name);let side=public_text(&path.with_file_name(format!("{name}.pub")))?;let side=side.split_ascii_whitespace().take(2).collect::<Vec<_>>().join(" ");if side!=selected{continue}let(mut file,s)=open(&path,true)?;if s.len==0||s.len>1024*1024{return Err(REFUSED.into())}let(raw,encrypted)=container_public(&mut file)?;let expected=selected.strip_prefix("ssh-ed25519 ").ok_or(REFUSED)?;if STANDARD.decode(expected).map_err(|_|REFUSED)?!=raw{return Err(REFUSED.into())}let bound=Binding{path,file,stamp:s,parents:parents.clone(),selected:selected.into(),encrypted};bound.unchanged()?;if found.is_some(){return Err(REFUSED.into())}found=Some(bound);
 }found.ok_or_else(||REFUSED.into())
}
#[cfg(target_os="macos")]
fn activation_command(path:&Path,encrypted:bool)->tokio::process::Command{
 let mut command=tokio::process::Command::new("/usr/bin/ssh-add");if encrypted{command.arg("--apple-use-keychain");}command.args(["-k","-t","3600"]).arg(path).env("SSH_ASKPASS_REQUIRE","force").env("SSH_ASKPASS","/usr/bin/false").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);command
}
#[cfg(any(target_os="macos",test))]
fn load_outcome(success:bool,unchanged:bool,ready:bool)->&'static str{if !unchanged{"changed"}else if success&&ready{"loaded"}else{"unavailable"}}
fn selected_ready(v:&Value,sha:&str)->bool{v["ready"]==true&&v["selected_identity_sha256"]==sha}
fn result(selected:&str,outcome:&str)->Value{json!({"schema":"nodenetwork-operator-credential-load-v1","selected_identity_sha256":format!("{:x}",Sha256::digest(selected.as_bytes())),"outcome":outcome,"ready":matches!(outcome,"loaded"|"already_loaded"),"lifetime_seconds":if outcome=="loaded"{Some(LIFE)}else{None},"load_attempted":matches!(outcome,"loaded"|"unavailable"|"changed"),"remote_contacted":false,"credentials_created":false,"automatic_retry":false})}
pub(super) struct Review{binding:Binding}
impl Review{pub(super) fn public_sha(&self)->String{format!("{:x}",Sha256::digest(self.binding.selected.as_bytes()))}}
pub(super) fn review(home:&Path,target:&Target,directory:&Path)->Result<Review,String>{let path=crate::node_bootstrap::controller_operator_identity(target,directory)?.ok_or(REFUSED)?;let key=crate::node_bootstrap::selected_operator_key(&path)?;Ok(Review{binding:mapping(home,target,&key)?})}
pub(super) async fn already_loaded(target:&Target,directory:&Path)->Result<Option<Value>,String>{let v=crate::operator_auth::status(target,directory).await?;if v["ready"]==true{let path=crate::node_bootstrap::controller_operator_identity(target,directory)?.ok_or(REFUSED)?;let key=crate::node_bootstrap::selected_operator_key(&path)?;if selected_ready(&v,&format!("{:x}",Sha256::digest(key.as_bytes()))){return Ok(Some(result(&key,"already_loaded")))}}Ok(None)}
#[cfg(target_os="macos")]
pub(super) async fn load(review:Review,home:&Path,target:&Target,directory:&Path)->Result<Value,String>{
 let fresh=self::review(home,target,directory)?;if fresh.public_sha()!=review.public_sha()||fresh.binding.path!=review.binding.path||fresh.binding.stamp!=review.binding.stamp{return Err(REFUSED.into())}review.binding.unchanged()?;
 if let Some(v)=already_loaded(target,directory).await?{return Ok(v)}
 // Force a failing noninteractive askpass, never a terminal or new passphrase/store.
 let mut command=activation_command(&review.binding.path,review.binding.encrypted);
 let status=tokio::time::timeout(Duration::from_secs(15),command.status()).await;
 if review.binding.unchanged().is_err()||!self::review(home,target,directory).is_ok_and(|v|v.public_sha()==review.public_sha()&&v.binding.path==review.binding.path&&v.binding.stamp==review.binding.stamp){return Ok(result(&review.binding.selected,"changed"))}
 let observed=crate::operator_auth::status(target,directory).await?;
 Ok(result(&review.binding.selected,load_outcome(matches!(status,Ok(Ok(s)) if s.success()),true,selected_ready(&observed,&review.public_sha()))))
}
#[cfg(not(target_os="macos"))]
pub(super) async fn load(_:Review,_:&Path,_:&Target,_:&Path)->Result<Value,String>{Err("Existing Keychain credential activation is available only on macOS; no credential was loaded".into())}
#[cfg(test)]mod tests{
 use super::*;use std::io::Cursor;use std::os::unix::fs::{PermissionsExt,symlink};
 fn blob(n:u8)->Vec<u8>{let mut v=b"\0\0\0\x0bssh-ed25519\0\0\0\x20".to_vec();v.extend([n;32]);v}
 fn field(v:&mut Vec<u8>,s:&[u8]){v.extend((s.len()as u32).to_be_bytes());v.extend(s)}
 fn container(n:u8)->(Vec<u8>,usize){let mut v=b"openssh-key-v1\0".to_vec();field(&mut v,b"aes256-ctr");field(&mut v,b"bcrypt");let mut options=Vec::new();field(&mut options,b"public-salt");options.extend(16u32.to_be_bytes());field(&mut v,&options);v.extend(1u32.to_be_bytes());field(&mut v,&blob(n));let public_end=v.len();field(&mut v,b"SYNTHETIC-ENCRYPTED-PAYLOAD-DO-NOT-READ");let mut out=b"-----BEGIN OPENSSH PRIVATE KEY-----\n".to_vec();out.extend(STANDARD.encode(&v).as_bytes());(out,36+(public_end*8).div_ceil(6))}
 struct Fixture{home:PathBuf,target:Target,key:String}
 impl Fixture{fn new()->Self{use std::sync::atomic::{AtomicU64,Ordering};static N:AtomicU64=AtomicU64::new(0);let home=std::env::temp_dir().join(format!("operator-credential-{}-{}",std::process::id(),N.fetch_add(1,Ordering::Relaxed)));fs::create_dir(&home).unwrap();fs::set_permissions(&home,fs::Permissions::from_mode(0o700)).unwrap();fs::create_dir(home.join(".ssh")).unwrap();fs::set_permissions(home.join(".ssh"),fs::Permissions::from_mode(0o700)).unwrap();let key=format!("ssh-ed25519 {}",STANDARD.encode(blob(7)));let v=Self{home,target:Target{kind:"remote".into(),host:Some("example.test".into()),port:Some(5619),root:"/opt/synergy".into(),guest:None},key};v.write("config",b"Host selected\n HostName example.test\n Port 5619\n IdentityFile ~/.ssh/existing-key\n");v.write("existing-key.pub",v.key.as_bytes());v.write("existing-key",&container(7).0);v}
 fn write(&self,name:&str,v:&[u8]){let p=self.home.join(".ssh").join(name);fs::write(&p,v).unwrap();fs::set_permissions(p,fs::Permissions::from_mode(0o600)).unwrap()}}
 impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.home);}}
 #[test]fn operator_credential_reads_only_public_container_prefix(){let(raw,end)=container(7);let mut c=Cursor::new(raw);assert_eq!(container_public(&mut c).unwrap(),(blob(7),true));assert_eq!(c.position()as usize,end);assert!(c.position()<c.get_ref().len()as u64);for mut bad in [b"bad".to_vec(),container(7).0]{if bad.len()>36{bad[36]=b'!'}assert!(container_public(Cursor::new(bad)).is_err())}}
 #[test]fn operator_credential_real_container_pin_not_sidecar_and_exact_target(){let f=Fixture::new();assert!(mapping(&f.home,&f.target,&f.key).is_ok());f.write("existing-key",&container(8).0);assert!(mapping(&f.home,&f.target,&f.key).is_err());f.write("existing-key",&container(7).0);let mut wrong=f.target.clone();wrong.port=Some(22);assert!(mapping(&f.home,&wrong,&f.key).is_err());f.write("config",b"Host selected\n HostName example.test\n Port 5619\n IdentityFile ~/.ssh/existing-key\n IdentityFile ~/.ssh/existing-key\n");assert!(mapping(&f.home,&f.target,&f.key).is_err())}
 #[test]fn operator_credential_links_modes_parents_and_replacement_refuse(){let f=Fixture::new();let b=mapping(&f.home,&f.target,&f.key).unwrap();f.write("existing-key",&container(8).0);assert!(b.unchanged().is_err());f.write("existing-key",&container(7).0);let p=f.home.join(".ssh/existing-key");fs::set_permissions(&p,fs::Permissions::from_mode(0o644)).unwrap();assert!(mapping(&f.home,&f.target,&f.key).is_err());fs::remove_file(&p).unwrap();symlink("existing-key.pub",&p).unwrap();assert!(mapping(&f.home,&f.target,&f.key).is_err());fs::remove_file(p).unwrap();f.write("existing-key",&container(7).0);fs::set_permissions(f.home.join(".ssh"),fs::Permissions::from_mode(0o755)).unwrap();assert!(mapping(&f.home,&f.target,&f.key).is_err());fs::set_permissions(f.home.join(".ssh"),fs::Permissions::from_mode(0o700)).unwrap();fs::rename(f.home.join(".ssh"),f.home.join("real-ssh")).unwrap();symlink("real-ssh",f.home.join(".ssh")).unwrap();assert!(mapping(&f.home,&f.target,&f.key).is_err())}
 #[test]fn operator_credential_ignores_unincluded_snippets_and_rejects_foreign_ready(){let f=Fixture::new();fs::create_dir(f.home.join(".ssh/config.d")).unwrap();fs::set_permissions(f.home.join(".ssh/config.d"),fs::Permissions::from_mode(0o700)).unwrap();let config=public_text(&f.home.join(".ssh/config")).unwrap();f.write("config.d/selected",config.as_bytes());f.write("config",b"# no active include\n");assert!(mapping(&f.home,&f.target,&f.key).is_err());f.write("config",b"Include ~/.ssh/config.d/*\n");assert!(mapping(&f.home,&f.target,&f.key).is_ok());assert!(!selected_ready(&json!({"ready":true,"selected_identity_sha256":"other"}),"original"));assert!(!selected_ready(&json!({"ready":false,"selected_identity_sha256":"original"}),"original"));assert!(selected_ready(&json!({"ready":true,"selected_identity_sha256":"original"}),"original"));}
 #[test]fn operator_credential_result_never_calls_failure_ready_or_extends_noop(){for(s,u,r)in [(false,true,true),(true,true,false),(false,true,false),(true,false,true)]{assert_ne!(load_outcome(s,u,r),"loaded")}let v=result("public","already_loaded");assert_eq!(v["load_attempted"],false);assert_eq!(v["lifetime_seconds"],Value::Null);assert_eq!(v["ready"],true);let mut q=crate::node_controller::Request{version:1,operation:"operator_auth_load".into(),parameters:json!({})};assert_eq!(q.validate(),Ok(true));q.parameters=json!({"path":"foreign","socket":"foreign","lifetime":0});assert!(q.validate().is_err())}
 #[cfg(target_os="macos")]
 #[test]fn operator_credential_os_command_has_fixed_arguments_no_socket_or_prompt_override(){let c=activation_command(Path::new("/owned/existing-key"),true);let c=c.as_std();assert_eq!(c.get_program(),"/usr/bin/ssh-add");assert_eq!(c.get_args().map(|a|a.to_str().unwrap()).collect::<Vec<_>>(),["--apple-use-keychain","-k","-t","3600","/owned/existing-key"]);let e=c.get_envs().collect::<Vec<_>>();assert_eq!(e.len(),2);assert!(e.contains(&(std::ffi::OsStr::new("SSH_ASKPASS_REQUIRE"),Some(std::ffi::OsStr::new("force")))));assert!(e.contains(&(std::ffi::OsStr::new("SSH_ASKPASS"),Some(std::ffi::OsStr::new("/usr/bin/false")))));let plain=activation_command(Path::new("/owned/existing-key"),false);assert_eq!(plain.as_std().get_args().map(|a|a.to_str().unwrap()).collect::<Vec<_>>(),["-k","-t","3600","/owned/existing-key"]);}
}
