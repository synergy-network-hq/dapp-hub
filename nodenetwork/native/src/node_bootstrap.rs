//! Streams only an operator-selected, digest-pinned master to the canonical bootstrap.
use super::node_controller::{self, Request, Target};
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,path::{Path,Component},process::Stdio,time::Duration};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
pub(super) const MAX_ARCHIVE:u64=256*1024*1024;
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));

const R5_RELEASE:&str="synergy-linux-389c509e47e55219";
const R5_PIN:&str="43eae3fdc42a2bff9e0ba2fa369d708fb60d14e90c6e18a6f344f5071c6cb23b";
pub(super) fn matches_builtin_release(release:&str,pin:&str)->bool{
    release==R5_RELEASE&&pin==R5_PIN
}
fn authenticate_release(release:&str,pin:&str)->Result<(),String>{
    if matches_builtin_release(release,pin){return Ok(());}
    if cfg!(debug_assertions)&&option_env!("SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256").is_some_and(|approved|approved==pin){return Ok(());}
    Err("The selected release has no independent native approval. Self-declared manifests cannot authorize privileged installation.".into())
}

pub struct Prepared {members:Vec<Member>,pub release:String,pub manifest_sha256:String,public_key:OperatorPublicKey}
impl Prepared {
    pub(super) fn operator_public_key_sha256(&self) -> String { self.public_key.sha256() }
}

const PUBLIC_KEY_LIMIT:usize = 16_384;
const INVALID_PUBLIC_KEY:&str = "Select one OpenSSH Ed25519 public key from a .pub file.";
struct OperatorPublicKey(String);
impl OperatorPublicKey {
    fn sha256(&self) -> String { format!("{:x}", Sha256::digest(self.0.as_bytes())) }
}
struct Member {name:String,size:u64,directory:bool,digest:Option<String>,file:Option<fs::File>}
pub(super) fn safe_member(name:&str)->bool {
    !name.is_empty() && name.len()<=100 && name.is_ascii() && !name.contains('\\')
        && Path::new(name).components().all(|c| matches!(c,Component::Normal(_)))
}
pub(super) fn declared_files(manifest: &Value) -> Result<BTreeMap<String, String>, String> {
    let files: BTreeMap<String, String> = serde_json::from_value(manifest["files"].clone())
        .map_err(|_| "Invalid master file inventory.")?;
    if files.is_empty() || files.len() > 4096 || files.iter().any(|(name, pin)| {
        !safe_member(name) || pin.len() != 64 || !pin.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }) {
        return Err("Invalid master inventory paths or digests.".into());
    }
    Ok(files)
}
pub(super) fn read_bounded(path:&Path,max:usize)->Result<Vec<u8>,String>{
    use std::io::Read;
    let metadata=fs::symlink_metadata(path).map_err(|_|"Selected public input is inaccessible.")?;
    if !metadata.is_file()||metadata.len()>max as u64 {return Err("Selected public input is not a bounded regular file.".into());}
    #[cfg(unix)]
    let file = {
        use rustix::fs::{Mode, OFlags, open};
        fs::File::from(open(path, OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty()).map_err(|_|"Cannot open selected public input.")?)
    };
    #[cfg(not(unix))]
    let file = fs::File::open(path).map_err(|_|"Cannot open selected public input.")?;
    let opened = file.metadata().map_err(|_|"Cannot inspect selected public input.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
            return Err("Selected public input changed while opening.".into());
        }
    }
    if !opened.is_file() || opened.len() != metadata.len() {return Err("Selected public input changed while opening.".into());}
    let mut out = Vec::new();
    file.take(max as u64+1).read_to_end(&mut out).map_err(|_|"Cannot read selected public input.")?;
    if out.len() as u64 != opened.len() {return Err("Selected public input changed while reading.".into());}
    Ok(out)
}
fn parse_operator_public_key(raw:&[u8])->Result<OperatorPublicKey,String>{
    // The pinned bootstrap public_header expects the 68-character OpenSSH encoding.
    // The SSH wire blob is a length-prefixed algorithm and 32 public-key bytes.
    const PREFIX:&[u8] = b"\0\0\0\x0bssh-ed25519\0\0\0\x20";
    let text=std::str::from_utf8(raw).map_err(|_|INVALID_PUBLIC_KEY)?;
    let line=text.strip_suffix("\r\n").or_else(||text.strip_suffix('\n')).unwrap_or(text);
    if line.chars().any(|character| character.is_control() && character != '\t') {
        return Err(INVALID_PUBLIC_KEY.into());
    }
    let mut fields=line.split_ascii_whitespace();
    if fields.next()!=Some("ssh-ed25519") {return Err(INVALID_PUBLIC_KEY.into());}
    let encoded=fields.next().filter(|text|text.len()==68).ok_or(INVALID_PUBLIC_KEY)?;
    let decoded=STANDARD_NO_PAD.decode(encoded).map_err(|_|INVALID_PUBLIC_KEY)?;
    if decoded.len()!=PREFIX.len()+32 || !decoded.starts_with(PREFIX) {
        return Err(INVALID_PUBLIC_KEY.into());
    }
    // Ignore a trailing comment; refuse a second key even if it was pasted on the same line.
    if fields.clone().zip(fields.skip(1)).any(|(label,blob)| {
        ["ssh-","ecdsa-","sk-"].iter().any(|prefix| label.starts_with(prefix))
            && blob.len()>=32 && blob.bytes().all(|byte|byte.is_ascii_alphanumeric() || b"+/=".contains(&byte))
    }) {return Err(INVALID_PUBLIC_KEY.into());}
    Ok(OperatorPublicKey(format!("ssh-ed25519 {encoded}")))
}

fn read_operator_public_key(path:&Path)->Result<OperatorPublicKey,String>{
    parse_operator_public_key(&read_bounded(path,PUBLIC_KEY_LIMIT)?)
}

pub(super) fn review_operator_public_key(path:&Path)->Result<Value,String>{
    let key=read_operator_public_key(path)?;
    Ok(json!({"schema":"nodenetwork-operator-public-key-v1","algorithm":"ssh-ed25519","canonicalSha256":key.sha256()}))
}
fn walk(root:&Path,at:&Path,members:&mut Vec<Member>,files:&BTreeMap<String,String>,total:&mut u64)->Result<(),String>{
    let mut children=fs::read_dir(at).map_err(|_|"Cannot inventory the master folder.")?.collect::<Result<Vec<_>,_>>().map_err(|_|"Cannot inventory the master folder.")?;
    children.sort_by_key(|e|e.file_name());
    for entry in children {
        let path=entry.path();let name=path.strip_prefix(root).map_err(|_|"Master path escaped its root.")?.to_str().ok_or("Master member name is not UTF-8.")?.replace('\\',"/");
        if entry.file_name().to_string_lossy().starts_with("._"){continue;}
        if !safe_member(&name)||members.len()>=8192{return Err("Unsafe or oversized master inventory.".into());}
        let metadata=fs::symlink_metadata(&path).map_err(|_|"Cannot inspect master member.")?;
        if metadata.is_dir(){*total=total.checked_add(512).ok_or("Master archive exceeds its limit.")?;if *total>MAX_ARCHIVE{return Err("Master archive exceeds 256 MiB.".into());}members.push(Member{name,size:0,directory:true,digest:None,file:None});walk(root,&path,members,files,total)?;}
        else if metadata.is_file(){
            #[cfg(unix)] {use std::os::unix::fs::MetadataExt;if metadata.nlink()!=1{return Err("Hard-linked master member refused.".into());}}
            if name!="package.json"&&!files.contains_key(&name){return Err("Master contains an undeclared file.".into());}
            let size=metadata.len();*total=total.checked_add(512+((size+511)/512)*512).ok_or("Master archive exceeds its limit.")?;
            if *total>MAX_ARCHIVE{return Err("Master archive exceeds 256 MiB.".into());}
            members.push(Member{digest:files.get(&name).cloned(),name,size,directory:false,file:None});
        } else{return Err("Master symlinks and special files are forbidden.".into());}
    } Ok(())
}
pub fn prepare(root:&Path,key:&Path,parameters:&Value)->Result<Prepared,String>{
    Request{version:1,operation:"install_preflight".into(),parameters:parameters.clone()}.validate()?;
    if root.file_name().and_then(|s|s.to_str())!=Some("Synergy")||root.ancestors().any(|p|!fs::symlink_metadata(p).is_ok_and(|m|m.is_dir())){return Err("Choose the direct Synergy master directory.".into());}
    let raw=read_bounded(&root.join("package.json"),1_000_000)?;
    let pin=format!("{:x}",Sha256::digest(&raw));
    let manifest:Value=serde_json::from_slice(&raw).map_err(|_|"Invalid master manifest.")?;
    if parameters["manifest_sha256"]!=pin||parameters["release_id"]!=manifest["release_id"]||manifest["format"]!="synergy-universal-linux-v1"||manifest["architecture"]!="x86_64"{return Err("Selected package does not match the reviewed release and manifest pin.".into());}
    authenticate_release(manifest["release_id"].as_str().ok_or("Invalid release identifier.")?,&pin)?;
    let files = declared_files(&manifest)?;
    let mut members=Vec::new();let mut total=1024;walk(root,root,&mut members,&files,&mut total)?;
    if members.iter().filter(|m|!m.directory&&m.name!="package.json").count()!=files.len(){return Err("Master inventory is incomplete.".into());}
    members.sort_by_key(|member|if member.name=="package.json"{0}else{1});
    for member in &mut members {
        if member.directory{continue;}
        use std::io::{Read,Seek};
        let mut file=fs::File::open(root.join(&member.name)).map_err(|_|"Cannot verify master file.")?;
        let mut hash=Sha256::new();let mut buffer=[0u8;65536];loop{let n=file.read(&mut buffer).map_err(|_|"Cannot verify master file.")?;if n==0{break;}hash.update(&buffer[..n]);}
        let actual=format!("{:x}",hash.finalize());let expected=if member.name=="package.json"{&pin}else{member.digest.as_ref().unwrap()};
        if &actual!=expected{return Err("Master file digest mismatch.".into());} file.rewind().map_err(|_|"Cannot rewind verified master file.")?;member.file=Some(file);member.digest=Some(actual);
    }
    Ok(Prepared{members,release:manifest["release_id"].as_str().unwrap().into(),manifest_sha256:pin,public_key:read_operator_public_key(key)?})
}
fn tar_header(member:&Member)->[u8;512]{
    let mut out=[0u8;512];out[..member.name.len()].copy_from_slice(member.name.as_bytes());
    out[100..108].copy_from_slice(b"0000700\0");out[108..116].copy_from_slice(b"0000000\0");out[116..124].copy_from_slice(b"0000000\0");
    out[124..136].copy_from_slice(format!("{:011o}\0",member.size).as_bytes());out[136..148].copy_from_slice(b"00000000000\0");out[148..156].fill(b' ');
    out[156]=if member.directory{b'5'}else{b'0'};out[257..263].copy_from_slice(b"ustar\0");out[263..265].copy_from_slice(b"00");
    let sum:u32=out.iter().map(|v|*v as u32).sum();out[148..156].copy_from_slice(format!("{:06o}\0 ",sum).as_bytes());out
}
fn shell_quote_static(value:&str)->String{format!("'{}'",value.replace('\'',"'\\''"))}
pub fn validate_operator(operator:&str)->Result<(),String>{
    if operator.is_empty()||operator.len()>32||!operator.as_bytes()[0].is_ascii_alphabetic()||!operator.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b)){return Err("Enter the existing administrative SSH account name, without a host, password or command.".into());}Ok(())
}
pub fn script_pin()->String{format!("{:x}",Sha256::digest(BOOTSTRAP.as_bytes()))}
pub async fn execute(target:Target,operator:String,parameters:Value,prepared:Prepared,control_dir:&Path)->Result<Value,String>{
    execute_pinned(target,operator,parameters,prepared,control_dir,None).await
}
async fn execute_pinned(target:Target,operator:String,parameters:Value,prepared:Prepared,control_dir:&Path,known_hosts:Option<&Path>)->Result<Value,String>{
    target.validate()?;validate_operator(&operator)?;
    let _guard=node_controller::SERIAL.lock().await;
    if target.kind=="remote" {node_controller::close_connection(&target,control_dir).await;}
    authenticate_release(&prepared.release,&prepared.manifest_sha256)?;
    let script=format!("NATIVE_AUTHENTICATED_MANIFEST_SHA256=\"{}\"\n{}",prepared.manifest_sha256,BOOTSTRAP);
    let mut command=if target.kind=="local"{
        if !cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local bootstrap requires Linux x86_64.".into());}
        let mut c=tokio::process::Command::new("/usr/bin/sudo");c.args(["-n","/usr/bin/python3","-I","-B","-c",&script]);c
    }else{node_controller::remote_command(&target,control_dir,&operator,&format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {}",shell_quote_static(&script)),known_hosts)?};
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=command.spawn().map_err(|_|"Cannot start restricted bootstrap transport.")?;
    let mut input=child.stdin.take().ok_or("Bootstrap input unavailable.")?;
    let output=child.stdout.take().ok_or("Bootstrap output unavailable.")?;
    let mut header=parameters;header["version"]=json!(1);header["operator_public_key"]=json!(prepared.public_key.0);
    let transfer=async move {
        input.write_all(format!("{}\n",header).as_bytes()).await.map_err(|_|"Cannot send bootstrap header.")?;
        for member in &prepared.members{
            input.write_all(&tar_header(member)).await.map_err(|_|"Cannot send master archive header.")?;
            if member.directory{continue;}
            let mut file=tokio::fs::File::from_std(member.file.as_ref().ok_or("Verified master descriptor is unavailable.")?.try_clone().map_err(|_|"Cannot stream verified master descriptor.")?);
            let mut remaining=member.size;let mut buffer=[0u8;65536];let mut hash=Sha256::new();
            while remaining>0{let limit=buffer.len().min(remaining as usize);let n=file.read(&mut buffer[..limit]).await.map_err(|_|"Cannot read master upload.")?;if n==0{return Err("Master was truncated during upload.");}remaining-=n as u64;hash.update(&buffer[..n]);input.write_all(&buffer[..n]).await.map_err(|_|"Cannot stream master package.")?;}
            if format!("{:x}",hash.finalize())!=*member.digest.as_ref().unwrap(){return Err("Master changed during upload; bootstrap must refuse installation.");}
            let pad=(512-member.size%512)%512;input.write_all(&[0u8;512][..pad as usize]).await.map_err(|_|"Cannot finish archive member.")?;
        }
        input.write_all(&[0u8;1024]).await.map_err(|_|"Cannot finish master archive.")?;drop(input);Ok::<(),&str>(())
    };
    let mut upload=tokio::spawn(transfer);
    let result=tokio::time::timeout(Duration::from_secs(300),bootstrap_transport_reply(output,&mut upload,&mut child)).await;
    upload.abort();
    node_controller::close_connection(&target,control_dir).await;
    match result{Ok(out)=>out.map_err(String::from),Err(_)=>Err("Bootstrap timed out. Inspect target state before retrying; no automatic retry occurred.".into())}
}

// A verified-host refusal can close stdin before the archive is fully sent.
// Preserve that negative envelope; success still requires every upload integrity
// check and a successful transport exit. Stderr remains discarded, never exposed.
async fn bootstrap_transport_reply(output:impl tokio::io::AsyncRead+Unpin,upload:&mut tokio::task::JoinHandle<Result<(),&'static str>>,child:&mut tokio::process::Child)->Result<Value,&'static str>{
 let mut bytes=Vec::new();output.take(1_000_001).read_to_end(&mut bytes).await.map_err(|_|"Cannot read bootstrap response.")?;
 if bytes.len()>1_000_000{return Err("Bootstrap response exceeds its limit.")}
 let reply=node_controller::decode_receipt_reply(&bytes).map_err(|_|"Invalid bootstrap response.")?;
 if reply["version"]!=1||!reply["ok"].is_boolean()||!reply.as_object().is_some_and(|fields|fields.len()==3){return Err("Unsupported bootstrap response.")}
 if reply["ok"]==false{
  if !reply["error"].as_object().is_some_and(|fields|fields.len()==2)||!reply["error"]["code"].is_string()||!reply["error"]["message"].is_string(){return Err("Unsupported bootstrap refusal.")}
  upload.abort();let _=upload.await;let _=child.wait().await;return Ok(reply)
 }
 if !reply["result"].is_object(){return Err("Unsupported bootstrap response.")}
 upload.await.map_err(|_|"Master upload task did not finish.")??;
 let status=child.wait().await.map_err(|_|"Bootstrap did not finish.")?;
 if !status.success(){return Err("Bootstrap transport failed; verify SSH host identity, agent authentication and restricted sudo permissions.")}
 Ok(reply)
}

#[cfg(test)] mod tests {
    fn bootstrap_transport_child(script:&str)->tokio::process::Child{
     let mut command=tokio::process::Command::new("/usr/bin/python3");command.args(["-I","-B","-c",script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);command.spawn().unwrap()
    }
    #[test]
    fn bootstrap_transport_preserves_early_remote_refusal_over_broken_pipe(){
     tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
     let mut child=bootstrap_transport_child("import os,sys,json\nos.close(0)\nprint(json.dumps({'version':1,'ok':False,'error':{'code':'bootstrap_refused','message':'Exact pre-root validation refused'}}),flush=True)\nsys.exit(17)\n");
     let mut input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
     let (finished,completion)=tokio::sync::oneshot::channel();
     let mut upload=tokio::spawn(async move{let result=async{let bytes=[0u8;65536];for _ in 0..128{input.write_all(&bytes).await.map_err(|_|"Cannot stream master package.")?;}Ok(())}.await;let _=finished.send(());result});
     // Force the real closed-stdin upload error to be present before resolving stdout.
     completion.await.unwrap();
     let result=super::bootstrap_transport_reply(output,&mut upload,&mut child).await.unwrap();
     assert_eq!(result["ok"],false);assert_eq!(result["error"]["code"],"bootstrap_refused");assert_eq!(result["error"]["message"],"Exact pre-root validation refused");
     });
    }
    #[test]
    fn bootstrap_transport_success_never_overrides_upload_integrity_failure(){
     tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
     let mut child=bootstrap_transport_child("import sys,json\nsys.stdin.buffer.read()\nprint(json.dumps({'version':1,'ok':True,'result':{}}))\n");
     let mut input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
     let mut upload=tokio::spawn(async move{input.write_all(b"changed bytes").await.unwrap();drop(input);Err("Master changed during upload; bootstrap must refuse installation.")});
     assert_eq!(super::bootstrap_transport_reply(output,&mut upload,&mut child).await.unwrap_err(),"Master changed during upload; bootstrap must refuse installation.");
     });
    }
    #[test]
    fn bootstrap_transport_success_requires_complete_upload_and_successful_exit(){
     tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
     for exit in [0,17]{
      let script=format!("import sys,json\nassert sys.stdin.buffer.read()==b'authenticated master'\nprint(json.dumps({{'version':1,'ok':True,'result':{{'complete':True}}}}))\nsys.exit({exit})\n");
      let mut child=bootstrap_transport_child(&script);let mut input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
      let mut upload=tokio::spawn(async move{input.write_all(b"authenticated master").await.unwrap();drop(input);Ok(())});
      let result=super::bootstrap_transport_reply(output,&mut upload,&mut child).await;
      if exit==0{assert_eq!(result.unwrap()["result"]["complete"],true)}else{assert!(result.unwrap_err().starts_with("Bootstrap transport failed"));}
     }
     });
    }

    #[test]
    fn bootstrap_transport_ambiguous_envelopes_preserve_uncertain_dispatch() {
     tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
      let invalid = [
       r#"{"version":1,"ok":true,"ok":false,"error":{"code":"bootstrap_refused","message":"fixture"}}"#,
       r#"{"version":1,"ok":false,"error":{"code":"one","code":"two","message":"fixture"}}"#,
       r#"{"version":1,"ok":false,"error":{"code":"bootstrap_refused","message":"fixture"},"result":{}}"#,
       r#"{"version":1,"ok":true}"#,
       r#"{"version":1,"ok":true,"result":null}"#,
       r#"{"version":1,"ok":false,"error":{"code":"bootstrap_refused"}}"#,
      ];
      for (index,wire) in invalid.iter().enumerate() {
       let script=format!("import sys\nsys.stdin.buffer.read()\nsys.stdout.write({})\n",serde_json::to_string(wire).unwrap());
       let mut child=bootstrap_transport_child(&script);let input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
       let mut upload=tokio::spawn(async move {drop(input);Ok(())});
       let outcome=super::bootstrap_transport_reply(output,&mut upload,&mut child).await.map_err(String::from);
       assert!(outcome.is_err(),"{wire}");
       let _=upload.await;let _=child.wait().await;
       let base=std::env::temp_dir().canonicalize().unwrap().join(format!("synergy-bootstrap-envelope-{}-{}-{index}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
       let target=json!({"kind":"remote","host":"fixture.invalid","port":22,"root":"/opt/Synergy"});
       let request=json!({"version":1,"operation":"bootstrap"});
       let dispatch=crate::request_journal::Dispatch::begin(&base,&target,"bootstrap",&request).unwrap();
       dispatch.finish(&outcome).unwrap();
       let observed=crate::request_journal::inspect(&base).unwrap();
       assert_eq!(observed["records"][0]["state"],"uncertain");
       assert_eq!(observed["records"][0]["response_ok"],Value::Null);
       assert!(crate::request_journal::Dispatch::begin(&base,&target,"bootstrap",&request).is_err());
       std::fs::remove_dir_all(base).unwrap();
      }
     });
    }

    use super::*;
    const OPENSSH_VECTOR: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea";
    const VECTOR_SHA256: &str = "6442aab9f902438a4cb8c8937e7cd0d0a66737acab731501554caaeb89a59774";

    #[test]
    fn operator_public_key_accepts_owner_and_openssh_fixture_with_only_canonical_digest() {
        // This public test vector passes pinned bootstrap.py::public_header and ssh-keygen -l.
        for value in [OPENSSH_VECTOR.to_string(), format!("{OPENSSH_VECTOR} fixture comment\n"),
            format!("{}  fixture comment métro\r\n",OPENSSH_VECTOR.replace(' ',"\t"))] {
            let parsed = parse_operator_public_key(value.as_bytes()).unwrap();
            assert_eq!(parsed.0, OPENSSH_VECTOR);
            assert_eq!(parsed.sha256(), VECTOR_SHA256);
        }
    }

    #[test]
    fn operator_public_key_rejects_noncanonical_or_ambiguous_inputs() {
        let payload = OPENSSH_VECTOR.split_ascii_whitespace().nth(1).unwrap();
        let mut wrong_type = STANDARD_NO_PAD.decode(payload).unwrap();
        wrong_type[4] = b'x';
        let mut wrong_size = STANDARD_NO_PAD.decode(payload).unwrap();
        wrong_size[18] = 31;
        for value in [String::new(), "ssh-ed25519 AAAA".into(),format!("ssh-ed25519 {}","A".repeat(68)),
            format!("ssh-rsa {payload}"),format!("{OPENSSH_VECTOR}="),
            format!("ssh-ed25519 {}",STANDARD_NO_PAD.encode(wrong_type)),
            format!("ssh-ed25519 {}",STANDARD_NO_PAD.encode(wrong_size)),
            format!("{OPENSSH_VECTOR}\n{OPENSSH_VECTOR}\n"),format!("{OPENSSH_VECTOR} {OPENSSH_VECTOR}"),
            format!("{OPENSSH_VECTOR}\r{OPENSSH_VECTOR}"),format!("{OPENSSH_VECTOR}\n\n"),
            format!("restrict {OPENSSH_VECTOR}"),format!("-----BEGIN OPENSSH {} KEY-----\n", "PRIVATE")] {
            assert!(parse_operator_public_key(value.as_bytes()).is_err());
        }
        assert!(parse_operator_public_key(&[255,0]).is_err());
    }

    #[test]
    fn operator_public_key_reviews_regular_bounded_files_and_returns_no_key_or_comment() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("portal-node-operator-key-{}-{stamp}",std::process::id()));
        fs::create_dir(&folder).unwrap();
        struct Scratch(std::path::PathBuf);
        impl Drop for Scratch { fn drop(&mut self) { let _=fs::remove_dir_all(&self.0); } }
        let _cleanup=Scratch(folder.clone());
        let path=folder.join("operator.pub");
        fs::write(&path,format!("{OPENSSH_VECTOR} fixture comment\n")).unwrap();
        let report=review_operator_public_key(&path).unwrap();
        assert_eq!(report,json!({"schema":"nodenetwork-operator-public-key-v1","algorithm":"ssh-ed25519","canonicalSha256":VECTOR_SHA256}));
        assert!(review_operator_public_key(&folder).is_err());
        assert!(review_operator_public_key(&folder.join("missing.pub")).is_err());
        #[cfg(unix)] {
            let link=folder.join("link.pub");
            std::os::unix::fs::symlink(&path,&link).unwrap();
            assert!(review_operator_public_key(&link).is_err());
        }
        fs::write(&path, vec![b'x'; PUBLIC_KEY_LIMIT+1]).unwrap();
        assert!(review_operator_public_key(&path).is_err());
    }

    #[test]
    #[ignore="Requires a specifically authorized clean disposable Linux target, pinned host key and isolated debug release approval"]
    fn native_bootstrap_streams_authenticated_master_to_disposable_target(){
        let target:Target=serde_json::from_str(&std::env::var("NODENETWORK_TEST_TARGET").expect("disposable target JSON required")).unwrap();
        assert_eq!(target.kind,"remote");
        let operator=std::env::var("NODENETWORK_TEST_OPERATOR").expect("disposable admin account required");
        let pin=std::path::PathBuf::from(std::env::var_os("NODENETWORK_TEST_KNOWN_HOSTS").expect("authenticated disposable host pin required"));
        let master=std::path::PathBuf::from(std::env::var_os("NODENETWORK_TEST_MASTER").expect("approved master required"));
        let public=std::path::PathBuf::from(std::env::var_os("NODENETWORK_TEST_PUBLIC_KEY").expect("public SSH key required"));
        let raw=std::fs::read(master.join("package.json")).unwrap();let manifest:Value=serde_json::from_slice(&raw).unwrap();
        let parameters=json!({"manifest_sha256":format!("{:x}",Sha256::digest(&raw)),"release_id":manifest["release_id"],"network_id":"nodenetwork-isolated-qualification","chain_id":99999,"node_name":"validator-bootstrap-test"});
        let prepared=prepare(&master,&public,&parameters).unwrap();
        let base=if cfg!(target_os="macos"){std::path::PathBuf::from("/private/tmp")}else{std::env::temp_dir().canonicalize().unwrap()};
        let scratch=base.join(format!("nn-bootstrap-{}",std::process::id()));assert!(!scratch.exists());
        struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
        let _cleanup=Cleanup(scratch.clone());
        let response=tauri::async_runtime::block_on(execute_pinned(target,operator,parameters,prepared,&scratch,Some(&pin))).unwrap();
        assert_eq!(response["ok"],true,"bootstrap must return a successful verified result");
        assert_eq!(response["result"]["root"],node_controller::ROOT);
        assert_eq!(response["result"]["stagedRelease"],manifest["release_id"]);
    }
    #[test] fn self_consistent_manifest_never_grants_itself_native_approval(){
        let manifest=json!({"format":"synergy-universal-linux-v1","architecture":"x86_64","release_id":"self-declared","files":{}});
        let pin=format!("{:x}",Sha256::digest(manifest.to_string().as_bytes()));
        assert!(authenticate_release("self-declared",&pin).is_err());
        assert!(authenticate_release(R5_RELEASE,R5_PIN).is_ok());
        assert!(authenticate_release("different-release",R5_PIN).is_err());
    }
    #[test] fn builtin_release_reference_requires_the_exact_owner_id_and_digest(){
        // Testnet v3 613fa6ab build_package.py: R5_RELEASE and R5_MANIFEST_SHA256.
        let release="synergy-linux-389c509e47e55219";
        let pin="43eae3fdc42a2bff9e0ba2fa369d708fb60d14e90c6e18a6f344f5071c6cb23b";
        assert!(matches_builtin_release(release,pin));
        assert!(authenticate_release(release,pin).is_ok());
        assert!(!matches_builtin_release("different-release",pin));
        assert!(!matches_builtin_release(release,&"a".repeat(64)));
        assert!(!matches_builtin_release(release,&pin.to_uppercase()));
    }
    #[test] fn static_tar_and_operator_contract_is_restricted(){
        assert!(safe_member("tools/controller.py"));for name in ["/etc/passwd","../keys","a/../b","a\\b"]{assert!(!safe_member(name));}
        for name in ["root;reboot","-oProxyCommand=bad","root@host",""]{assert!(validate_operator(name).is_err());}assert!(validate_operator("node-admin").is_ok());
        let header=tar_header(&Member{name:"package.json".into(),size:12,directory:false,digest:None,file:None});assert_eq!(&header[257..263],b"ustar\0");assert_eq!(header[156],b'0');
    }
}
