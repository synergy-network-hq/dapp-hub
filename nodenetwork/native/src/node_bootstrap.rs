//! Streams only an operator-selected, digest-pinned master to the canonical bootstrap.
use super::node_controller::{self, Request, Target};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,path::{Path,Component},process::Stdio,time::Duration};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
const MAX_ARCHIVE:u64=256*1024*1024;
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));

const R5_RELEASE:&str="synergy-linux-389c509e47e55219";
const R5_PIN:&str="43eae3fdc42a2bff9e0ba2fa369d708fb60d14e90c6e18a6f344f5071c6cb23b";
fn authenticate_release(release:&str,pin:&str)->Result<(),String>{
    if release==R5_RELEASE&&pin==R5_PIN{return Ok(());}
    if cfg!(debug_assertions)&&option_env!("SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256").is_some_and(|approved|approved==pin){return Ok(());}
    Err("The selected release has no independent native approval. Self-declared manifests cannot authorize privileged installation.".into())
}

pub struct Prepared {members:Vec<Member>,pub release:String,pub manifest_sha256:String,pub public_key:String}
struct Member {name:String,size:u64,directory:bool,digest:Option<String>,file:Option<fs::File>}
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
    let files:BTreeMap<String,String>=serde_json::from_value(manifest["files"].clone()).map_err(|_|"Invalid master file inventory.")?;
    if files.is_empty()||files.len()>4096||files.iter().any(|(name,pin)|!safe_member(name)||pin.len()!=64||!pin.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("Invalid master inventory paths or digests.".into());}
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
    Ok(Prepared{members,release:manifest["release_id"].as_str().unwrap().into(),manifest_sha256:pin,public_key:public_key(key)?})
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
    let mut header=parameters;header["version"]=json!(1);header["operator_public_key"]=json!(prepared.public_key);
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
    let response=async {let mut bytes=Vec::new();output.take(1_000_001).read_to_end(&mut bytes).await.map_err(|_|"Cannot read bootstrap response.")?;if bytes.len()>1_000_000{return Err("Bootstrap response exceeds its limit.");}Ok::<Vec<u8>,&str>(bytes)};
    let mut upload=tokio::spawn(transfer);
    let result=tokio::time::timeout(Duration::from_secs(300),async {let bytes=response.await?;(&mut upload).await.map_err(|_|"Master upload task did not finish.")??;let status=child.wait().await.map_err(|_|"Bootstrap did not finish.")?;if !status.success(){return Err("Bootstrap transport failed; verify SSH host identity, agent authentication and restricted sudo permissions.");}let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid bootstrap response.")?;if reply["version"]!=1||!reply["ok"].is_boolean(){return Err("Unsupported bootstrap response.");}Ok(reply)}).await;
    upload.abort();
    node_controller::close_connection(&target,control_dir).await;
    match result{Ok(out)=>out.map_err(String::from),Err(_)=>Err("Bootstrap timed out. Inspect target state before retrying; no automatic retry occurred.".into())}
}

#[cfg(test)] mod tests {
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
        assert_eq!(response["result"]["stagedRelease"],manifest["release_id"]);
    }
    #[test] fn self_consistent_manifest_never_grants_itself_native_approval(){
        let manifest=json!({"format":"synergy-universal-linux-v1","architecture":"x86_64","release_id":"self-declared","files":{}});
        let pin=format!("{:x}",Sha256::digest(manifest.to_string().as_bytes()));
        assert!(authenticate_release("self-declared",&pin).is_err());
        assert!(authenticate_release(R5_RELEASE,R5_PIN).is_ok());
        assert!(authenticate_release("different-release",R5_PIN).is_err());
    }
    #[test] fn static_tar_and_operator_contract_is_restricted(){
        assert!(safe_member("tools/controller.py"));for name in ["/etc/passwd","../keys","a/../b","a\\b"]{assert!(!safe_member(name));}
        for name in ["root;reboot","-oProxyCommand=bad","root@host",""]{assert!(validate_operator(name).is_err());}assert!(validate_operator("node-admin").is_ok());
        let header=tar_header(&Member{name:"package.json".into(),size:12,directory:false,digest:None,file:None});assert_eq!(&header[257..263],b"ustar\0");assert_eq!(header[156],b'0');
    }
}
