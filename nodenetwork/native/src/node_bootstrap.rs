//! Streams only an operator-selected, digest-pinned master to the canonical bootstrap.
use super::node_controller::{self, Request, Target};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,path::{Path,Component},process::Stdio,time::Duration};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
const MAX_ARCHIVE:u64=256*1024*1024;
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));

fn authenticate_release(pin:&str)->Result<(),String>{
    if cfg!(debug_assertions)&&option_env!("SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256").is_some_and(|approved|approved==pin){return Ok(());}
    Err("The selected release has no independent native approval. Self-declared manifests cannot authorize privileged installation.".into())
}

pub struct Prepared {members:Vec<Member>,upload_deadline:Duration,pub release:String,pub manifest_sha256:String,pub public_key:String}
struct Member {name:String,size:u64,directory:bool,digest:Option<String>,file:Option<fs::File>}
// Only the authenticated public master stream gets a size-derived allowance.
// Credential transports and normal controller calls retain their own deadlines.
fn archive_upload_deadline(bytes:u64,authenticated_cap:u64)->Result<Duration,String>{
    if !matches!(authenticated_cap,MAX_ARCHIVE|536870912|1073741824)||bytes<1024||bytes>authenticated_cap{
        return Err("Master upload size exceeds its authenticated archive bound.".into());
    }
    let seconds=300u64.checked_add(bytes.div_ceil(512*1024)).filter(|n|*n<=45*60)
        .ok_or("Master upload deadline exceeds its bound.")?;
    Ok(Duration::from_secs(seconds))
}
fn member_archive_bytes(size:u64)->Result<u64,String>{
    size.div_ceil(512).checked_mul(512).and_then(|n|n.checked_add(512))
        .ok_or_else(||"Master archive size overflow.".into())
}
fn public_archive_ssh(command:tokio::process::Command)->Result<tokio::process::Command,String>{
    let source=command.as_std();
    if source.get_program()!=std::ffi::OsStr::new("/usr/bin/ssh"){
        return Err("Public archive transport requires the pinned SSH command.".into());
    }
    // SSH uses its first option value. Prepending cannot become part of the
    // remote command and preserves every original host-pin/identity argument.
    let mut compressed=tokio::process::Command::new(source.get_program());
    compressed.arg("-oCompression=yes").args(source.get_args());
    for (key,value) in source.get_envs(){match value{Some(value)=>{compressed.env(key,value);},None=>{compressed.env_remove(key);}}}
    if let Some(directory)=source.get_current_dir(){compressed.current_dir(directory);}
    Ok(compressed)
}
fn safe_member(name:&str)->bool {
    !name.is_empty() && name.len()<=100 && name.is_ascii() && !name.contains('\\')
        && Path::new(name).components().all(|c| matches!(c,Component::Normal(_)))
}
fn read_bounded(path:&Path,max:usize)->Result<Vec<u8>,String>{
    use std::io::Read;
    let metadata=fs::symlink_metadata(path).map_err(|_|"Selected public input is inaccessible.")?;
    if !metadata.is_file()||metadata.len()>max as u64 {return Err("Selected public input is not a bounded regular file.".into());}
    let mut out=Vec::new();fs::File::open(path).map_err(|_|"Cannot open selected public input.")?.take(max as u64+1).read_to_end(&mut out).map_err(|_|"Cannot read selected public input.")?;
    if out.len()>max{return Err("Selected public input exceeds its bound.".into());} Ok(out)
}
fn public_key(path:&Path)->Result<String,String>{
    let raw=read_bounded(path,16_384)?;
    let text=std::str::from_utf8(&raw).map_err(|_|"Select an SSH public .pub file; never a private key.")?.trim();
    let fields:Vec<_>=text.split_whitespace().collect();
    if fields.len()<2 || fields[0]!="ssh-ed25519"
        || !fields[1].bytes().all(|b|b.is_ascii_alphanumeric()||b"+/=".contains(&b)) || text.contains('\n') {
        return Err("Select one administrative Ed25519 SSH public key. Private keys and authorized_keys options are forbidden.".into());
    }
    Ok(format!("{} {}",fields[0],fields[1]))
}
fn archive_limit(manifest:&Value)->Result<u64,String>{
 let Some(meta)=manifest.get("managed_guest_resources")else{return Ok(MAX_ARCHIVE)};
 let m=meta.as_object().ok_or("Invalid managed guest resources declaration")?;
 let pin=meta["manifest_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 let limit=meta["archive_limit_bytes"].as_u64().ok_or("Missing approved guest archive limit")?;
 if m.len()!=4||meta["version"]!=1||!pin||!matches!(limit,536870912|1073741824){return Err("Unapproved guest archive limit or resource declaration".into())}
 let files=manifest["files"].as_object().ok_or("Missing managed guest file inventory")?;
 for path in ["hosted-machines/images/os.qcow2","lib/guest-tools/bin/qemu-system-x86_64","lib/guest-tools/bin/qemu-img","lib/guest-tools/bin/ssh-keygen","lib/guest-tools/bin/genisoimage","lib/guest-tools/bios.bin","lib/guest-tools/bin/ld-linux-x86-64.so.2"]{if !files.contains_key(path){return Err("Incomplete pinned guest resource inventory".into())}}
 let guest_files:serde_json::Map<String,Value>=files.iter().filter(|(name,_)|name.starts_with("lib/guest-tools/")||name.starts_with("hosted-machines/")).map(|(name,pin)|(name.clone(),pin.clone())).collect();
 if meta["files"].as_object()!=Some(&guest_files){return Err("Declared guest resources differ from the sealed package inventory".into())}
 let mut runtime=0;
 for name in guest_files.keys(){
  if let Some(base)=name.strip_prefix("lib/guest-tools/lib/"){if base.is_empty()||base=="."||base==".."||base.len()>128||!base.bytes().all(|b|b.is_ascii_alphanumeric()||b"._+-".contains(&b)){return Err("Unsafe guest runtime library name".into())}runtime+=1;}
  else if !["hosted-machines/images/os.qcow2","lib/guest-tools/bin/qemu-system-x86_64","lib/guest-tools/bin/qemu-img","lib/guest-tools/bin/ssh-keygen","lib/guest-tools/bin/genisoimage","lib/guest-tools/bios.bin","lib/guest-tools/bin/ld-linux-x86-64.so.2"].contains(&name.as_str()){return Err("Undeclared guest resource path".into())}
 }
 if runtime>127{return Err("Guest runtime library inventory exceeds bound".into())}Ok(limit)
}
fn walk(root:&Path,at:&Path,members:&mut Vec<Member>,files:&BTreeMap<String,String>,total:&mut u64,archive_limit:u64)->Result<(),String>{
    let mut children=fs::read_dir(at).map_err(|_|"Cannot inventory the master folder.")?.collect::<Result<Vec<_>,_>>().map_err(|_|"Cannot inventory the master folder.")?;
    children.sort_by_key(|e|e.file_name());
    for entry in children {
        let path=entry.path();let name=path.strip_prefix(root).map_err(|_|"Master path escaped its root.")?.to_str().ok_or("Master member name is not UTF-8.")?.replace('\\',"/");
        if entry.file_name().to_string_lossy().starts_with("._"){continue;}
        if !safe_member(&name)||members.len()>=8192{return Err("Unsafe or oversized master inventory.".into());}
        let metadata=fs::symlink_metadata(&path).map_err(|_|"Cannot inspect master member.")?;
        if metadata.is_dir(){*total=total.checked_add(512).ok_or("Master archive exceeds its limit.")?;if *total>archive_limit{return Err("Master archive exceeds its authenticated limit.".into());}members.push(Member{name,size:0,directory:true,digest:None,file:None});walk(root,&path,members,files,total,archive_limit)?;}
        else if metadata.is_file(){
            #[cfg(unix)] {use std::os::unix::fs::MetadataExt;if metadata.nlink()!=1{return Err("Hard-linked master member refused.".into());}}
            if name!="package.json"&&!files.contains_key(&name){return Err("Master contains an undeclared file.".into());}
            let size=metadata.len();*total=total.checked_add(member_archive_bytes(size)?).ok_or("Master archive exceeds its limit.")?;
            if *total>archive_limit{return Err("Master archive exceeds its authenticated limit.".into());}
            members.push(Member{digest:files.get(&name).cloned(),name,size,directory:false,file:None});
        } else{return Err("Master symlinks and special files are forbidden.".into());}
    } Ok(())
}
pub fn prepare(root:&Path,key:&Path,parameters:&Value)->Result<Prepared,String>{
    prepare_master(root,parameters,public_key(key)?,true)
}
pub(super) fn prepare_update(root:&Path,selection:&Value)->Result<Prepared,String>{
    if !cfg!(debug_assertions){return Err("Engineering update adoption is disabled in production".into())}
    let manifest:Value=serde_json::from_slice(&read_bounded(&root.join("package.json"),1_000_000)?).map_err(|_|"Invalid update manifest")?;
    let mut parameters=selection.clone();parameters["release_id"]=manifest["release_id"].clone();
    parameters["manifest_sha256"]=json!(format!("{:x}",Sha256::digest(read_bounded(&root.join("package.json"),1_000_000)?)));
    prepare_master(root,&parameters,String::new(),false)
}
fn prepare_master(root:&Path,parameters:&Value,operator_public_key:String,require_build_pin:bool)->Result<Prepared,String>{
    Request{version:1,operation:"install_preflight".into(),parameters:parameters.clone()}.validate()?;
    if root.file_name().and_then(|s|s.to_str())!=Some("synergy")||root.ancestors().any(|p|!fs::symlink_metadata(p).is_ok_and(|m|m.is_dir())){return Err("Choose the direct lowercase synergy master directory.".into());}
    let raw=read_bounded(&root.join("package.json"),1_000_000)?;
    let pin=format!("{:x}",Sha256::digest(&raw));
    let manifest:Value=serde_json::from_slice(&raw).map_err(|_|"Invalid master manifest.")?;
    if parameters["manifest_sha256"]!=pin||parameters["release_id"]!=manifest["release_id"]||manifest["format"]!="synergy-universal-linux-v1"||manifest["architecture"]!="x86_64"{return Err("Selected package does not match the reviewed release and manifest pin.".into());}
    if require_build_pin{authenticate_release(&pin)?;}
    let files:BTreeMap<String,String>=serde_json::from_value(manifest["files"].clone()).map_err(|_|"Invalid master file inventory.")?;
    if files.is_empty()||files.len()>4096||files.iter().any(|(name,pin)|!safe_member(name)||pin.len()!=64||!pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("Invalid master inventory paths or digests.".into());}
    let authenticated_cap=archive_limit(&manifest)?;
    let mut members=Vec::new();let mut total=1024;walk(root,root,&mut members,&files,&mut total,authenticated_cap)?;
    let upload_deadline=archive_upload_deadline(total,authenticated_cap)?;
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
    Ok(Prepared{members,upload_deadline,release:manifest["release_id"].as_str().unwrap().into(),manifest_sha256:pin,public_key:operator_public_key})
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
pub(super) async fn execute_pinned(target:Target,operator:String,parameters:Value,prepared:Prepared,control_dir:&Path,known_hosts:Option<&Path>)->Result<Value,String>{
    execute_transport(target,operator,parameters,prepared,control_dir,known_hosts,None).await
}
pub(super) async fn execute_update(target:Target,operator:String,context:Value,prepared:Prepared,control_dir:&Path,known_hosts:Option<&Path>)->Result<Value,String>{
    if !cfg!(debug_assertions)||context["release_id"]!=prepared.release||context["manifest_sha256"]!=prepared.manifest_sha256{return Err("Update does not match the exact native review".into())}
    execute_transport(target,operator,json!({}),prepared,control_dir,known_hosts,Some(context)).await
}
async fn execute_transport(target:Target,operator:String,parameters:Value,prepared:Prepared,control_dir:&Path,known_hosts:Option<&Path>,update:Option<Value>)->Result<Value,String>{
    target.validate()?;validate_operator(&operator)?;
    if target.guest.is_some()&&operator!="synergy"{return Err("Managed guest bootstrap uses its approved synergy account".into())}
    let _guard=node_controller::SERIAL.lock().await;
    if target.kind=="remote" {node_controller::close_connection_checked(&target,control_dir,"synergy-nodenetwork").await?;node_controller::close_connection_checked(&target,control_dir,&operator).await?;}
    if update.is_none(){authenticate_release(&prepared.manifest_sha256)?;}
    let bootstrap_pin=if update.is_none()&&target.kind=="remote"&&target.guest.is_none()&&known_hosts.is_none(){Some(node_controller::bootstrap_host_pin(&target,control_dir)?)}else{None};
    let known_hosts=known_hosts.or(bootstrap_pin.as_deref());
    let script=if let Some(context)=&update{format!("NATIVE_AUTHENTICATED_UPDATE_CONTEXT=__import__('json').loads({})\n{}",serde_json::to_string(&context.to_string()).map_err(|_|"Cannot encode reviewed update")?,BOOTSTRAP)}else{format!("NATIVE_AUTHENTICATED_MANIFEST_SHA256=\"{}\"\n{}",prepared.manifest_sha256,BOOTSTRAP)};
    let arguments=if update.is_some(){format!(" --stage-engineering-update {} {}",prepared.release,prepared.manifest_sha256)}else{String::new()};
    let mut command=if target.kind=="local"{
        if !cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local bootstrap requires Linux x86_64.".into());}
        let mut c=tokio::process::Command::new("/usr/bin/sudo");c.args(["-n","/usr/bin/python3","-I","-B","-c",&script]);if update.is_some(){c.args(["--stage-engineering-update",&prepared.release,&prepared.manifest_sha256]);}c
    }else{public_archive_ssh(node_controller::remote_command(&target,control_dir,&operator,&(format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {}",shell_quote_static(&script))+&arguments),known_hosts)?)?};
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=command.spawn().map_err(|_|"Cannot start restricted bootstrap transport.")?;
    let mut input=child.stdin.take().ok_or("Bootstrap input unavailable.")?;
    let output=child.stdout.take().ok_or("Bootstrap output unavailable.")?;
    let mut header=parameters;header["version"]=json!(1);header["operator_public_key"]=json!(prepared.public_key);
    let upload_deadline=prepared.upload_deadline;
    let transfer=async move {
        if update.is_none(){input.write_all(format!("{}\n",header).as_bytes()).await.map_err(|_|"Cannot send bootstrap header.")?;}
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
    let result=tokio::time::timeout(upload_deadline,bootstrap_transport_reply(output,&mut upload,&mut child)).await;
    upload.abort();
    node_controller::close_connection_checked(&target,control_dir,&operator).await?;
    match result{Ok(out)=>out.map_err(String::from),Err(_)=>Err("Bootstrap timed out. Inspect target state before retrying; no automatic retry occurred.".into())}
}

// A verified-host refusal can close stdin before the archive is fully sent.
// Preserve that negative envelope; success still requires every upload integrity
// check and a successful transport exit. Stderr remains discarded, never exposed.
async fn bootstrap_transport_reply(output:impl tokio::io::AsyncRead+Unpin,upload:&mut tokio::task::JoinHandle<Result<(),&'static str>>,child:&mut tokio::process::Child)->Result<Value,&'static str>{
 let mut bytes=Vec::new();output.take(1_000_001).read_to_end(&mut bytes).await.map_err(|_|"Cannot read bootstrap response.")?;
 if bytes.len()>1_000_000{return Err("Bootstrap response exceeds its limit.")}
 let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid bootstrap response.")?;
 if reply["version"]!=1||!reply["ok"].is_boolean(){return Err("Unsupported bootstrap response.")}
 if reply["ok"]==false{
  if !reply["error"]["code"].is_string()||!reply["error"]["message"].is_string(){return Err("Unsupported bootstrap refusal.")}
  upload.abort();let _=upload.await;let _=child.wait().await;return Ok(reply)
 }
 upload.await.map_err(|_|"Master upload task did not finish.")??;
 let status=child.wait().await.map_err(|_|"Bootstrap did not finish.")?;
 if !status.success(){return Err("Bootstrap transport failed; verify SSH host identity, agent authentication and restricted sudo permissions.")}
 Ok(reply)
}

#[cfg(test)] mod tests {
    #[test]fn public_archive_upload_deadline_is_bounded_by_authenticated_size(){
     assert_eq!(super::archive_upload_deadline(1024,MAX_ARCHIVE).unwrap().as_secs(),301);
     assert_eq!(super::archive_upload_deadline(512*1024,MAX_ARCHIVE).unwrap().as_secs(),301);
     assert_eq!(super::archive_upload_deadline(512*1024+1,MAX_ARCHIVE).unwrap().as_secs(),302);
     assert_eq!(super::archive_upload_deadline(MAX_ARCHIVE,MAX_ARCHIVE).unwrap().as_secs(),812);
     assert_eq!(super::archive_upload_deadline(536870912,536870912).unwrap().as_secs(),1324);
     assert_eq!(super::archive_upload_deadline(1073741824,1073741824).unwrap().as_secs(),2348);
     for (bytes,cap) in [(0,MAX_ARCHIVE),(1023,MAX_ARCHIVE),(MAX_ARCHIVE+1,MAX_ARCHIVE),
        (536870913,536870912),(1073741825,1073741824),(u64::MAX,1073741824),(1024,u64::MAX)]{
      assert!(super::archive_upload_deadline(bytes,cap).is_err());
     }
     assert_eq!(super::member_archive_bytes(0).unwrap(),512);
     assert_eq!(super::member_archive_bytes(513).unwrap(),1536);
     assert!(super::member_archive_bytes(u64::MAX).is_err());
    }
    #[test]fn public_archive_compression_preserves_every_pinned_ssh_argument(){
     let mut original=tokio::process::Command::new("/usr/bin/ssh");
     original.args(["-F","/dev/null","-oStrictHostKeyChecking=yes","-oForwardAgent=no",
       "-oUserKnownHostsFile=/pinned/public-hosts","-oControlPath=/owned/socket","-oCompression=no",
       "--","admin@verified-host","fixed bootstrap command"]);
     original.env("PUBLIC_TEST","retained").env_remove("REMOVED_TEST").current_dir("/");
     let before:Vec<_>=original.as_std().get_args().map(|arg|arg.to_owned()).collect();
     let result=super::public_archive_ssh(original).unwrap();
     let after:Vec<_>=result.as_std().get_args().map(|arg|arg.to_owned()).collect();
     assert_eq!(after[0],"-oCompression=yes");assert_eq!(&after[1..],before);
     assert_eq!(result.as_std().get_current_dir(),Some(std::path::Path::new("/")));
     let env:Vec<_>=result.as_std().get_envs().collect();
     assert!(env.contains(&(std::ffi::OsStr::new("PUBLIC_TEST"),Some(std::ffi::OsStr::new("retained")))));
     assert!(env.contains(&(std::ffi::OsStr::new("REMOVED_TEST"),None)));
     assert!(super::public_archive_ssh(tokio::process::Command::new("/bin/sh")).is_err());
    }
    fn bootstrap_transport_child(script:&str)->tokio::process::Child{
     let mut command=tokio::process::Command::new("/usr/bin/python3");command.args(["-I","-B","-c",script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);command.spawn().unwrap()
    }
    #[tokio::test(flavor="current_thread")]
    async fn bootstrap_transport_preserves_early_remote_refusal_over_broken_pipe(){
     let mut child=bootstrap_transport_child("import os,sys,json\nos.close(0)\nprint(json.dumps({'version':1,'ok':False,'error':{'code':'bootstrap_refused','message':'Exact pre-root validation refused'}}),flush=True)\nsys.exit(17)\n");
     let mut input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
     let (finished,completion)=tokio::sync::oneshot::channel();
     let mut upload=tokio::spawn(async move{let result=async{let bytes=[0u8;65536];for _ in 0..128{input.write_all(&bytes).await.map_err(|_|"Cannot stream master package.")?;}Ok(())}.await;let _=finished.send(());result});
     // Force the real closed-stdin upload error to be present before resolving stdout.
     completion.await.unwrap();
     let result=super::bootstrap_transport_reply(output,&mut upload,&mut child).await.unwrap();
     assert_eq!(result["ok"],false);assert_eq!(result["error"]["code"],"bootstrap_refused");assert_eq!(result["error"]["message"],"Exact pre-root validation refused");
    }
    #[tokio::test(flavor="current_thread")]
    async fn bootstrap_transport_success_never_overrides_upload_integrity_failure(){
     let mut child=bootstrap_transport_child("import sys,json\nsys.stdin.buffer.read()\nprint(json.dumps({'version':1,'ok':True,'result':{}}))\n");
     let mut input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
     let mut upload=tokio::spawn(async move{input.write_all(b"changed bytes").await.unwrap();drop(input);Err("Master changed during upload; bootstrap must refuse installation.")});
     assert_eq!(super::bootstrap_transport_reply(output,&mut upload,&mut child).await.unwrap_err(),"Master changed during upload; bootstrap must refuse installation.");
    }
    #[tokio::test(flavor="current_thread")]
    async fn bootstrap_transport_success_requires_complete_upload_and_successful_exit(){
     for exit in [0,17]{
      let script=format!("import sys,json\nassert sys.stdin.buffer.read()==b'authenticated master'\nprint(json.dumps({{'version':1,'ok':True,'result':{{'complete':True}}}}))\nsys.exit({exit})\n");
      let mut child=bootstrap_transport_child(&script);let mut input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
      let mut upload=tokio::spawn(async move{input.write_all(b"authenticated master").await.unwrap();drop(input);Ok(())});
      let result=super::bootstrap_transport_reply(output,&mut upload,&mut child).await;
      if exit==0{assert_eq!(result.unwrap()["result"]["complete"],true)}else{assert!(result.unwrap_err().starts_with("Bootstrap transport failed"));}
     }
    }
    #[test]fn original_rollback_authorization_globals_preserve_bounded_exact_utf8_without_argument_embedding(){
     use std::io::Write;
     let raw=format!("{{\"public\":\"{}雪\"}}","x".repeat(64000));let sha=format!("{:x}",Sha256::digest(raw.as_bytes()));let prefix=super::bare_authorization_globals(&sha);
     assert!(!prefix.contains(&raw));assert!(prefix.len()<512);
     let script=prefix+"assert len(NATIVE_AUTHENTICATED_BARE_AUTHORIZATION_JSON.encode('utf-8')) <= 65536\nassert __import__('hashlib').sha256(NATIVE_AUTHENTICATED_BARE_AUTHORIZATION_JSON.encode('utf-8')).hexdigest() == NATIVE_AUTHENTICATED_BARE_AUTHORIZATION_SHA256\n";
     let mut child=std::process::Command::new("/usr/bin/python3").args(["-I","-B","-c",&script]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).spawn().unwrap();child.stdin.take().unwrap().write_all(raw.as_bytes()).unwrap();assert!(child.wait().unwrap().success());
    }
    #[test]fn guest_archive_cap_is_only_extended_for_exact_declared_master_resources(){
     let mut m=serde_json::json!({"files":{}});assert_eq!(super::archive_limit(&m).unwrap(),super::MAX_ARCHIVE);
     // Exact four-field shape emitted by canonical build_package.py, including its resource file map.
     for path in ["hosted-machines/images/os.qcow2","lib/guest-tools/bin/qemu-system-x86_64","lib/guest-tools/bin/qemu-img","lib/guest-tools/bin/ssh-keygen","lib/guest-tools/bin/genisoimage","lib/guest-tools/bios.bin","lib/guest-tools/bin/ld-linux-x86-64.so.2","lib/guest-tools/lib/libc.so.6"]{m["files"][path]=serde_json::json!("a".repeat(64));}
     let guest_files=m["files"].clone();m["files"]["bin/synergy-node"]=serde_json::json!("b".repeat(64));
     m["managed_guest_resources"]=serde_json::json!({"version":1,"manifest_sha256":"a".repeat(64),"archive_limit_bytes":536870912,"files":guest_files});
     assert_eq!(super::archive_limit(&m).unwrap(),536870912);
     let mut b=m.clone();b["managed_guest_resources"]["archive_limit_bytes"]=serde_json::json!(1073741824);assert_eq!(super::archive_limit(&b).unwrap(),1073741824);
     for path in ["lib/guest-tools/lib/..","lib/guest-tools/bin/arbitrary"]{let mut b=m.clone();b["files"][path]=serde_json::json!("a".repeat(64));b["managed_guest_resources"]["files"][path]=serde_json::json!("a".repeat(64));assert!(super::archive_limit(&b).is_err());}
     let mut b=m.clone();b["managed_guest_resources"].as_object_mut().unwrap().remove("files");assert!(super::archive_limit(&b).is_err());
     let mut b=m.clone();b["managed_guest_resources"]["files"]["lib/guest-tools/lib/libc.so.6"]=serde_json::json!("c".repeat(64));assert!(super::archive_limit(&b).is_err());
     let mut b=m.clone();b["managed_guest_resources"]["files"]["bin/synergy-node"]=serde_json::json!("b".repeat(64));assert!(super::archive_limit(&b).is_err());
     let mut b=m.clone();b["files"].as_object_mut().unwrap().remove("lib/guest-tools/bin/ld-linux-x86-64.so.2");b["managed_guest_resources"]["files"].as_object_mut().unwrap().remove("lib/guest-tools/bin/ld-linux-x86-64.so.2");assert!(super::archive_limit(&b).is_err());
     m["managed_guest_resources"]["archive_limit_bytes"]=serde_json::json!(u64::MAX);assert!(super::archive_limit(&m).is_err());
    }

    use super::*;
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
        assert_eq!(response["result"]["rootDeletionGuardActive"],true);
        assert_eq!(response["result"]["stagedRelease"],manifest["release_id"]);
    }
    #[test] fn self_consistent_manifest_never_grants_itself_native_approval(){
        let manifest=json!({"format":"synergy-universal-linux-v1","architecture":"x86_64","release_id":"self-declared","files":{}});
        let pin=format!("{:x}",Sha256::digest(manifest.to_string().as_bytes()));
        assert!(authenticate_release(&pin).is_err());
        assert!(authenticate_release("43eae3fdc42a2bff9e0ba2fa369d708fb60d14e90c6e18a6f344f5071c6cb23b").is_err());
    }
    #[test] fn static_tar_and_operator_contract_is_restricted(){
        assert!(safe_member("tools/controller.py"));for name in ["/etc/passwd","../keys","a/../b","a\\b"]{assert!(!safe_member(name));}
        for name in ["root;reboot","-oProxyCommand=bad","root@host",""]{assert!(validate_operator(name).is_err());}assert!(validate_operator("node-admin").is_ok());
        let header=tar_header(&Member{name:"package.json".into(),size:12,directory:false,digest:None,file:None});assert_eq!(&header[257..263],b"ustar\0");assert_eq!(header[156],b'0');
    }
}

#[cfg(test)]mod update_tests{
 use super::*;
 #[test]fn native_update_inventory_derives_digest_and_rejects_payload_substitution(){
  let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-update-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
  struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(base.clone());
  let root=base.join("synergy");fs::create_dir_all(root.join("tools")).unwrap();fs::write(root.join("tools/example.py"),b"verified").unwrap();
  let manifest=json!({"format":"synergy-universal-linux-v1","architecture":"x86_64","release_id":"new-reviewed-release","files":{"tools/example.py":format!("{:x}",Sha256::digest(b"verified"))}});
  let bytes=serde_json::to_vec(&manifest).unwrap();fs::write(root.join("package.json"),&bytes).unwrap();
  let selection=json!({"release_id":"old","manifest_sha256":"a".repeat(64),"network_id":"nodenetwork-formation-disposable-test","chain_id":99999,"node_name":"validator-test"});
  let prepared=prepare_update(&root,&selection).unwrap();assert_eq!(prepared.release,"new-reviewed-release");assert_eq!(prepared.manifest_sha256,format!("{:x}",Sha256::digest(bytes)));
  assert!(prepared.public_key.is_empty());fs::write(root.join("tools/example.py"),b"tampered").unwrap();assert!(prepare_update(&root,&selection).is_err());
 }
}

pub(super) fn bare_rollback_scope(target:&Target,release:&str,pin:Option<&str>,debug:bool)->Result<String,String>{
    target.validate()?;
    if !debug||target.guest.is_some()||target.kind!="remote"||target.host.as_deref()!=Some("127.0.0.1")||target.port!=Some(22280)||option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN").is_none(){return Err("Bare bootstrap rollback has no independent isolated native target approval".into())}
    let pin=pin.filter(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).ok_or("No independently compiled old master approval")?;
    if release.is_empty()||release.len()>128||!release.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)){return Err("Invalid old release reference".into())}Ok(pin.into())
}
fn bare_authorization_globals(sha:&str)->String{
 // Keep the bounded original public document off command arguments; only this
 // exact native-verified digest is injected into the executable script.
 format!("NATIVE_AUTHENTICATED_BARE_AUTHORIZATION_SHA256=\"{sha}\"\nNATIVE_AUTHENTICATED_BARE_AUTHORIZATION_JSON=__import__('sys').stdin.buffer.read(65537).decode('utf-8')\n")
}
pub(super) async fn execute_bare_rollback(target:Target,operator:&str,release:&str,review:Option<&str>,authorization:Option<&str>,control:&Path)->Result<Value,String>{
    let pin=bare_rollback_scope(&target,release,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_BARE_ROLLBACK_MANIFEST_SHA256"),cfg!(debug_assertions))?;
    validate_operator(operator)?;
    if review.is_some_and(|s|s.len()!=64||!s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("Invalid exact rollback review".into())}
    let _guard=node_controller::SERIAL.lock().await;
    node_controller::close_connection_checked(&target,control,"synergy-nodenetwork").await?;
    node_controller::close_connection_checked(&target,control,operator).await?;
    let authorization_globals=if let Some(raw)=authorization{
     let sha=crate::bare_rollback::verified_original(raw,&target,release,&pin)?;
     bare_authorization_globals(&sha)
    }else{String::new()};
    let script=format!("NATIVE_AUTHENTICATED_MANIFEST_SHA256=\"{pin}\"\n{authorization_globals}{BOOTSTRAP}");
    let flag=if review.is_some(){"--bare-rollback-apply"}else{"--bare-rollback-preflight"};
    let remote=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} {} {} {}{}",shell_quote_static(&script),flag,release,pin,review.map(|s|format!(" {s}")).unwrap_or_default());
    let mut command=node_controller::remote_command(&target,control,operator,&remote,None)?;
    command.stdin(if authorization.is_some(){Stdio::piped()}else{Stdio::null()}).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let result=async{
        let mut child=command.spawn().map_err(|_|"Cannot open approved rollback admin transport")?;
        if let Some(raw)=authorization{let mut input=child.stdin.take().ok_or("Original authorization input unavailable")?;input.write_all(raw.as_bytes()).await.map_err(|_|"Original authorization transport interrupted")?;drop(input);}
        let output=child.stdout.take().ok_or("Rollback output unavailable")?;
        let mut bytes=Vec::new();output.take(65537).read_to_end(&mut bytes).await.map_err(|_|"Cannot read rollback response")?;
        if bytes.len()>65536{return Err("Rollback response exceeds bound".into())}
        let status=child.wait().await.map_err(|_|"Rollback admin transport interrupted")?;
        if !status.success(){return Err("Rollback transport interrupted; do not repeat apply".into())}
        let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Malformed rollback response")?;
        if reply["version"]!=1||!reply["ok"].is_boolean(){return Err("Unsupported rollback response".into())}Ok(reply)
    };
    let out=match tokio::time::timeout(Duration::from_secs(180),result).await{Ok(value)=>value,Err(_)=>Err("Rollback outcome uncertain; do not replay apply".into())};
    node_controller::close_connection_checked(&target,control,operator).await?;out
}
