//! Streams only an operator-selected, digest-pinned master to the canonical bootstrap.
use super::node_controller::{self, Request, Target};
use serde_json::{json,Value};
use base64::{Engine,engine::general_purpose::STANDARD_NO_PAD};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,fs,path::{Path,Component},process::Stdio,time::Duration};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
pub(super) const MAX_ARCHIVE:u64=256*1024*1024;
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));

pub(super) fn matches_builtin_release(_release:&str,pin:&str)->bool{authenticate_release(pin).is_ok()}
fn authenticate_release(pin:&str)->Result<(),String>{
    if cfg!(debug_assertions)&&option_env!("SYNERGY_NODENETWORK_QUALIFICATION_MANIFEST_SHA256").is_some_and(|approved|approved==pin){return Ok(());}
    Err("The selected release has no independent native approval. Self-declared manifests cannot authorize privileged installation.".into())
}

pub struct Prepared {members:Vec<Member>,upload_deadline:Duration,pub release:String,pub manifest_sha256:String,pub public_key:String}
const PUBLIC_KEY_LIMIT:usize = 16_384;
const INVALID_PUBLIC_KEY:&str = "Select one OpenSSH Ed25519 public key from a .pub file.";
struct OperatorPublicKey(String);
impl OperatorPublicKey {
    fn sha256(&self) -> String { format!("{:x}", Sha256::digest(self.0.as_bytes())) }
}
impl Prepared { pub(super) fn operator_public_key_sha256(&self)->String { format!("{:x}",Sha256::digest(self.public_key.as_bytes())) } }
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

pub(super) fn selected_operator_key(path:&Path)->Result<String,String>{ public_key(path) }
fn operator_identity_path(target:&Target,directory:&Path)->Result<std::path::PathBuf,String>{
 target.validate()?;
 if target.kind!="remote"||target.guest.is_some(){return Err("Operator selection requires a physical remote target".into())}
 Ok(directory.join(format!("operator-{:x}.pub",Sha256::digest(target.journal_identity().to_string().as_bytes()))))
}
pub(super) fn controller_operator_identity(target:&Target,directory:&Path)->Result<Option<std::path::PathBuf>,String>{
 let path=operator_identity_path(target,directory)?;
 if !path.exists()&&!path.is_symlink(){return Ok(None)}
 let m=fs::symlink_metadata(&path).map_err(|_|"Selected operator public identity unavailable")?;
 #[cfg(unix)]{use std::os::unix::fs::MetadataExt;if m.uid()!=unsafe{libc::geteuid()}||m.mode()&0o777!=0o600||m.nlink()!=1{return Err("Selected operator public identity ownership changed".into())}}
 if !m.is_file()||m.file_type().is_symlink(){return Err("Selected operator public identity is not a regular file".into())}
 let raw=read_bounded(&path,PUBLIC_KEY_LIMIT)?;let canonical=parse_operator_public_key(&raw)?.0;
 if raw!=format!("{canonical}\n").as_bytes(){return Err("Selected operator public identity is not canonical".into())}
 Ok(Some(path))
}
pub(super) fn require_selected_operator_identity(target:&Target,directory:&Path,key:&str)->Result<(),String>{
 let canonical=parse_operator_public_key(key.as_bytes())?;
 if canonical.0!=key{return Err("Operator public identity must be canonical".into())}
 if let Some(path)=controller_operator_identity(target,directory)?{
  if read_bounded(&path,PUBLIC_KEY_LIMIT)?!=format!("{key}\n").as_bytes(){return Err("Bootstrap public key differs from the existing target selection; no bootstrap was sent".into())}
 }Ok(())
}
pub(super) fn retain_operator_identity(target:&Target,directory:&Path,key:&str)->Result<Value,String>{
 #[cfg(unix)]node_controller::protect_control_directory(directory)?;
 let canonical=parse_operator_public_key(key.as_bytes())?;
 if canonical.0!=key{return Err("Operator public identity must be canonical".into())}
 let path=operator_identity_path(target,directory)?;let raw=format!("{key}\n");
 if let Some(existing)=controller_operator_identity(target,directory)?{
  if read_bounded(&existing,PUBLIC_KEY_LIMIT)?!=raw.as_bytes(){return Err("Target already has a different selected operator public identity".into())}
 }else{
  use std::io::Write;
  let pending=path.with_extension("pending");let mut options=fs::OpenOptions::new();options.write(true).create_new(true);
  #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
  let result=(||{let mut file=options.open(&pending).map_err(|_|"Operator identity publication requires reconciliation")?;
   file.write_all(raw.as_bytes()).and_then(|_|file.sync_all()).map_err(|_|"Cannot persist public operator identity")?;
   fs::hard_link(&pending,&path).map_err(|_|"Operator identity changed during publication")?;
   fs::remove_file(&pending).and_then(|_|fs::File::open(directory)?.sync_all()).map_err(|_|"Cannot complete public operator identity publication")?;Ok::<(),String>(())})();
  result?;
 }
 Ok(json!({"schema":"nodenetwork-operator-public-key-v1","algorithm":"ssh-ed25519","canonicalSha256":canonical.sha256()}))
}

pub(super) fn review_operator_public_key_bytes(key:&str)->Result<Value,String>{
 let key=parse_operator_public_key(key.as_bytes())?;
 Ok(json!({"schema":"nodenetwork-operator-public-key-v1","algorithm":"ssh-ed25519","canonicalSha256":key.sha256()}))
}
#[cfg(test)]
pub(super) fn review_operator_public_key(path:&Path)->Result<Value,String>{
    let key=read_operator_public_key(path)?;
    Ok(json!({"schema":"nodenetwork-operator-public-key-v1","algorithm":"ssh-ed25519","canonicalSha256":key.sha256()}))
}
fn public_key(path:&Path)->Result<String,String>{Ok(read_operator_public_key(path)?.0)}
pub(super) fn archive_limit(manifest:&Value)->Result<u64,String>{
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
// Lossless transport encoding only. Python stdlib zlib is mandatory and failure
// precedes execution; no unverified/plaintext fallback or stdin consumption.
pub(super) fn bootstrap_script(script:&str)->Result<String,String>{
 use std::io::Write;
 if script.is_empty()||script.len()>2*1024*1024{return Err("Authenticated bootstrap source exceeds bound".into())}
 let mut encoder=flate2::write::ZlibEncoder::new(Vec::new(),flate2::Compression::default());
 encoder.write_all(script.as_bytes()).map_err(|_|"Cannot encode authenticated bootstrap")?;
 let compressed=encoder.finish().map_err(|_|"Cannot encode authenticated bootstrap")?;
 let encoded=base64::engine::general_purpose::STANDARD.encode(compressed);
 let digest=format!("{:x}",Sha256::digest(script.as_bytes()));let length=script.len();
 let loader=format!("# NATIVE_AUTHENTICATED_MANIFEST_SHA256=encoded-source\nimport base64,hashlib,zlib\n_z=zlib.decompressobj()\n_b=_z.decompress(base64.b64decode('{encoded}',validate=True),{length}+1)\nif not (_z.eof and not _z.unused_data and not _z.unconsumed_tail and len(_b)=={length} and hashlib.sha256(_b).hexdigest()=='{digest}'): raise SystemExit('Authenticated bootstrap encoding refused')\nexec(compile(_b,'<authenticated-node-bootstrap>','exec'),globals())");
 if loader.len()>96*1024{return Err("Encoded authenticated bootstrap exceeds remote argument budget".into())}Ok(loader)
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
pub(super) async fn execute_update(target:Target,operator:String,mut context:Value,prepared:Prepared,control_dir:&Path,known_hosts:Option<&Path>)->Result<Value,String>{
    if !cfg!(debug_assertions)||context["release_id"]!=prepared.release||context["manifest_sha256"]!=prepared.manifest_sha256{return Err("Update does not match the exact native review".into())}
    let reconcile=context.as_object_mut().and_then(|value|value.remove("reconcile_only")).and_then(|value|value.as_bool()).unwrap_or(false);
    execute_transport(target,operator,json!({}),prepared,control_dir,known_hosts,Some((context,reconcile))).await
}
fn update_replacement_wire(context:&Value)->Result<(Value,Option<Vec<u8>>),String>{
 let mut context=context.clone();let proof=context.as_object_mut().ok_or("Invalid update review")?.remove("superseded_upgrade");
 let wire=proof.map(|proof|->Result<Vec<u8>,String>{
  if proof["context"]["selection"]!=context["selection"]||proof["context"]["target"]!=context["target"]||proof["context"]["initial_sha256"]!=context["initial_sha256"]||proof["context"]["parent_sha256"]!=context["parent_sha256"]||proof["context"]["formation_sha256"]!=context["formation_sha256"]||proof["context"]["expires_at"]!=context["expires_at"]{return Err("Replacement proof changes its native review".into())}
  let mut raw=serde_json::to_vec(&proof).map_err(|_|"Cannot encode replacement proof")?;
  if raw.len()+1>2*1024*1024{return Err("Replacement proof exceeds bound".into())}raw.push(b'\n');Ok(raw)
 }).transpose()?;Ok((context,wire))
}
async fn execute_transport(target:Target,operator:String,parameters:Value,prepared:Prepared,control_dir:&Path,known_hosts:Option<&Path>,update:Option<(Value,bool)>)->Result<Value,String>{
    target.validate()?;validate_operator(&operator)?;
    if target.guest.is_some()&&operator!="synergy"{return Err("Managed guest bootstrap uses its approved synergy account".into())}
    let _guard=node_controller::SERIAL.lock().await;
    if target.kind=="remote" {node_controller::close_connection_checked(&target,control_dir,"synergy-nodenetwork").await?;node_controller::close_connection_checked(&target,control_dir,&operator).await?;}
    if update.is_none(){authenticate_release(&prepared.manifest_sha256)?;}
    let bootstrap_pin=if update.is_none()&&target.kind=="remote"&&target.guest.is_none()&&known_hosts.is_none(){Some(node_controller::bootstrap_host_pin(&target,control_dir)?)}else{None};
    let known_hosts=known_hosts.or(bootstrap_pin.as_deref());
    let expected_release=prepared.release.clone();let expected_manifest=prepared.manifest_sha256.clone();let is_update=update.is_some();
    let reconcile=update.as_ref().is_some_and(|(_,reconcile)|*reconcile);
    let update_flag=if reconcile{"--reconcile-engineering-update"}else{"--stage-engineering-update"};
    let (script_context,replacement_wire)=if let Some((context,_))=&update{update_replacement_wire(context)?}else{(Value::Null,None)};
    let replacement_globals=if replacement_wire.is_some(){
     if reconcile{return Err("A staged replacement cannot use reconcile-only mode".into())}authenticate_release(&prepared.manifest_sha256)?;
     format!("NATIVE_AUTHENTICATED_SUPERSEDED_UPGRADE=True\nNATIVE_AUTHENTICATED_MANIFEST_SHA256=\"{}\"\n",prepared.manifest_sha256)
    }else{String::new()};
    let script=if update.is_some(){format!("{replacement_globals}NATIVE_AUTHENTICATED_UPDATE_CONTEXT=__import__('json').loads({})\n{}",serde_json::to_string(&script_context.to_string()).map_err(|_|"Cannot encode reviewed update")?,BOOTSTRAP)}else{format!("NATIVE_AUTHENTICATED_MANIFEST_SHA256=\"{}\"\n{}",prepared.manifest_sha256,BOOTSTRAP)};
 let script=bootstrap_script(&script)?;
    let arguments=if update.is_some(){format!(" {update_flag} {} {}",prepared.release,prepared.manifest_sha256)}else{String::new()};
    let mut command=if target.kind=="local"{
        if !cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local bootstrap requires Linux x86_64.".into());}
        let mut c=tokio::process::Command::new("/usr/bin/sudo");c.args(["-n","/usr/bin/python3","-I","-B","-c",&script]);if update.is_some(){c.args([update_flag,&prepared.release,&prepared.manifest_sha256]);}c
    }else{public_archive_ssh(node_controller::remote_command(&target,control_dir,&operator,&(format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {}",shell_quote_static(&script))+&arguments),known_hosts)?)?};
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=command.spawn().map_err(|_|"Cannot start restricted bootstrap transport.")?;
    let mut input=child.stdin.take().ok_or("Bootstrap input unavailable.")?;
    let output=child.stdout.take().ok_or("Bootstrap output unavailable.")?;
    let mut header=parameters;header["version"]=json!(1);header["operator_public_key"]=json!(prepared.public_key);
    let upload_deadline=if reconcile{std::time::Duration::from_secs(60)}else{prepared.upload_deadline};
    let transfer=async move {
        if reconcile{drop(input);return Ok::<(),&str>(())}
        if update.is_none(){input.write_all(format!("{}\n",header).as_bytes()).await.map_err(|_|"Cannot send bootstrap header.")?;}
        if let Some(wire)=replacement_wire{input.write_all(&wire).await.map_err(|_|"Cannot send exact staged replacement proof")?;}
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
    match result{Ok(out)=>{let reply=out.map_err(String::from)?;if !is_update{validate_bootstrap_acknowledgement(&reply,&expected_release,&expected_manifest).map_err(String::from)?;}Ok(reply)},Err(_)=>Err("Bootstrap timed out. Inspect target state before retrying; no automatic retry occurred.".into())}
}

fn validate_bootstrap_acknowledgement(reply:&Value,release:&str,manifest:&str)->Result<(),&'static str>{
 const UNCERTAIN:&str="Bootstrap acknowledgement differs from the reviewed master or enrollment scope. Inspect the target before another change; no automatic retry occurred.";
 if reply["ok"]==false{return Ok(())}
 let result=&reply["result"];
 let records=["system-account:synergy-nodenetwork","/etc/ssh/sshd_config.d/synergy-nodenetwork.conf","/etc/sudoers.d/synergy-nodenetwork","/etc/systemd/system/synergy-installation-guard.service","/etc/systemd/system/multi-user.target.wants/synergy-installation-guard.service"];
 if !result.as_object().is_some_and(|fields|fields.len()==10)
  ||result["root"]!=node_controller::ROOT||result["stagedRelease"]!=release||result["manifestSha256"]!=manifest
  ||result["rootDeletionGuardActive"]!=true||result["controllerEnrolled"]!=true||result["softwareInstalled"]!=false||result["activationAuthorized"]!=false
  ||result["communityEnrollment"]!=false||result["operatorAuthorizationRequired"]!=true
  ||!result["hostManagedRecords"].as_array().is_some_and(|items|items.len()==records.len()&&records.iter().all(|record|items.contains(&json!(record)))){
  return Err(UNCERTAIN)
 }
 Ok(())
}

// A verified-host refusal can close stdin before the archive is fully sent.
// Preserve that negative envelope; success still requires every upload integrity
// check and a successful transport exit. Stderr remains discarded, never exposed.
fn bootstrap_transport_exit(status:std::process::ExitStatus)->Result<(),&'static str>{
 if status.success(){return Ok(())}
 Err(match status.code(){
  Some(255)=>"Bootstrap SSH session unavailable. Inspect the pinned target and reconcile its state before another confirmation; no automatic retry occurred.",
  Some(_)=>"Bootstrap transport failed during remote execution. Inspect target state and restricted SSH/sudo permissions before another confirmation; no automatic retry occurred.",
  None=>"Bootstrap transport interrupted. Inspect and reconcile target state before another confirmation; no automatic retry occurred.",
 })
}

async fn bootstrap_transport_reply(output:impl tokio::io::AsyncRead+Unpin,upload:&mut tokio::task::JoinHandle<Result<(),&'static str>>,child:&mut tokio::process::Child)->Result<Value,&'static str>{
 let mut bytes=Vec::new();output.take(1_000_001).read_to_end(&mut bytes).await.map_err(|_|"Cannot read bootstrap response.")?;
 if bytes.len()>1_000_000{return Err("Bootstrap response exceeds its limit.")}
 let reply=match node_controller::decode_receipt_reply(&bytes){
  Ok(reply)=>reply,
  Err(_)=>{
   // A closed SSH session commonly has empty stdout. Classify its actual
   // exit before calling that a malformed acknowledgement; never expose stderr.
   upload.abort();let _=upload.await;
   let status=child.wait().await.map_err(|_|"Bootstrap transport exit status unavailable; inspect target before another confirmation.")?;
   bootstrap_transport_exit(status)?;
   return Err("Invalid bootstrap response from a completed session. Inspect target state before another confirmation; no automatic retry occurred.")
  }
 };
 if reply["version"]!=1||!reply["ok"].is_boolean()||!reply.as_object().is_some_and(|fields|fields.len()==3){return Err("Unsupported bootstrap response.")}
 if reply["ok"]==false{
  if !reply["error"].as_object().is_some_and(|fields|fields.len()==2)||!reply["error"]["code"].is_string()||!reply["error"]["message"].is_string(){return Err("Unsupported bootstrap refusal.")}
  upload.abort();let _=upload.await;let _=child.wait().await;return Ok(reply)
 }
 if !reply["result"].is_object(){return Err("Unsupported bootstrap response.")}
 upload.await.map_err(|_|"Master upload task did not finish.")??;
 let status=child.wait().await.map_err(|_|"Bootstrap did not finish.")?;
 bootstrap_transport_exit(status)?;
 Ok(reply)
}

// Fixed, read-only proof. No renderer-selected commands, paths, units or accounts.
const CLEAN_BOOTSTRAP_PROOF:&str=r#"
import os,sys,json,pwd,grp,subprocess,fnmatch
from pathlib import Path
ROOTS=('/opt/synergy','/opt/Synergy')
PATTERNS=('synergy-node*.service','synergy-validator*.service','synergy-vpn*.service','synergy-canary-*.service','synergy-posy-*.service','synergy-installation-guard*.service','synergy-guest-*.service')
def require(ok):
    if not ok: raise ValueError('Bootstrap absence is not proven')
def bounded(path,limit):
    with open(path,'rb') as f: data=f.read(limit+1)
    require(len(data)<=limit)
    return data
def rooted(value,roots):
    return any(value==r or value.startswith(r+'/') for r in roots)
def clean(roots,etc,proc,mountinfo,accounts,units,service_dirs=None,ancestors=None):
    require(all(not os.path.lexists(r) for r in roots))
    require(accounts())
    for directory in ('ssh/sshd_config.d','sudoers.d'):
        d=etc/directory
        if d.exists():
            entries=list(d.iterdir());require(len(entries)<=4096)
            require(not any('synergy-nodenetwork' in p.name for p in entries))
    for base in (service_dirs if service_dirs is not None else (etc/'systemd/system',Path('/run/systemd/system'),Path('/usr/lib/systemd/system'),Path('/lib/systemd/system'))):
        if not base.exists():continue
        count=0
        for current,dirs,files in os.walk(base,followlinks=False):
            require(len(Path(current).relative_to(base).parts)<=4)
            for name in dirs+files:
                count+=1;require(count<=20000)
                p=Path(current)/name
                require(not any(fnmatch.fnmatchcase(name,pattern) for pattern in PATTERNS))
                if p.is_symlink():require(not any(r in os.readlink(p) for r in roots))
    require(units())
    def mounts(data):
        for line in data.decode('utf-8','strict').splitlines():
            fields=line.split();require(len(fields)>=6)
            # Reject root mounts, submounts and bind sources, including escapes.
            decoded=[__import__('re').sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),v) for v in fields]
            require(not any(rooted(part,roots) for v in decoded for part in __import__('re').split(r'[=,:]',v)))
    mounts(bounded(mountinfo,4*1024*1024))
    if ancestors is None:
        ancestors=set();pid=os.getpid()
        while pid>1 and pid not in ancestors:
            ancestors.add(pid)
            status=bounded(Path('/proc')/str(pid)/'status',65536).decode()
            pid=int(next(line.split()[1] for line in status.splitlines() if line.startswith('PPid:')))
    entries=list(proc.iterdir());require(len(entries)<=32768)
    for entry in entries:
        if not entry.name.isdecimal():continue
        try:
            command=bounded(entry/'cmdline',262144)
            args=command.split(b'\0')
            require(not any(rooted(a.decode('utf-8','replace'),roots) for a in args))
            for leaf in ('exe','cwd'):
                require(not rooted(os.readlink(entry/leaf).removesuffix(' (deleted)'),roots))
            mounts(bounded(entry/'mountinfo',4*1024*1024))
            mappings=bounded(entry/'maps',8*1024*1024).decode('utf-8','replace')
            require(not any(rooted(line.split(None,5)[-1].removesuffix(' (deleted)'),roots) for line in mappings.splitlines()))
            descriptors=list((entry/'fd').iterdir());require(len(descriptors)<=65536)
            for descriptor in descriptors:
                try:require(not rooted(os.readlink(descriptor).removesuffix(' (deleted)'),roots))
                except FileNotFoundError:continue
            if int(entry.name) not in ancestors:
                require(not any(m in command for m in (b'NATIVE_AUTHENTICATED_MANIFEST_SHA256=',b'--stage-engineering-update',b'--bare-bootstrap-',b'synergy-node',b'/opt/synergy',b'/opt/Synergy')))
        except (FileNotFoundError,ProcessLookupError):continue
    require(all(not os.path.lexists(r) for r in roots))
def accounts_absent():
    for lookup in (pwd.getpwnam,grp.getgrnam):
        try:lookup('synergy-nodenetwork')
        except KeyError:continue
        return False
    return True
def units_absent():
    for verb in ('list-unit-files','list-units'):
        result=subprocess.run(['/usr/bin/systemctl',verb,'--all','--no-legend','--no-pager','--plain',*PATTERNS],capture_output=True,text=True,timeout=8,check=False)
        require(isinstance(result.stdout,str) and len(result.stdout)<=2_000_000 and not result.stderr)
        require(result.returncode==0 or (verb=='list-unit-files' and result.returncode==1))
        if result.returncode!=0:require(result.stdout=='')
        for line in result.stdout.splitlines():
            parts=line.split()
            require(verb=='list-units' and len(parts)>=4 and any(fnmatch.fnmatchcase(parts[0],p) for p in PATTERNS)
                    and parts[1]=='not-found' and parts[2:4] in (['inactive','dead'],['failed','failed']))
            fields=('LoadState','ActiveState','SubState','MainPID','ControlPID','FragmentPath',
                    'SourcePath','DropInPaths','UnitFileState','Triggers','TriggeredBy','Job')
            detail=subprocess.run(['/usr/bin/systemctl','show',parts[0],'--property='+','.join(fields)],capture_output=True,text=True,timeout=8,check=False)
            require(detail.returncode==0 and not detail.stderr and isinstance(detail.stdout,str) and len(detail.stdout)<=65536)
            values={}
            for row in detail.stdout.splitlines():
                key,separator,value=row.partition('=');require(separator and key in fields and key not in values);values[key]=value
            require(set(values)==set(fields) and values['LoadState']=='not-found'
                    and (values['ActiveState'],values['SubState']) in (('inactive','dead'),('failed','failed'))
                    and values['MainPID']==values['ControlPID']=='0' and all(values[k]=='' for k in fields[5:]))
    return True
if __name__=='__main__':
    try:
        require(os.geteuid()==0)
        challenge=sys.argv[1];require(len(challenge)==64 and all(c in '0123456789abcdef' for c in challenge))
        clean(ROOTS,Path('/etc'),Path('/proc'),Path('/proc/self/mountinfo'),accounts_absent,units_absent)
        print(json.dumps({'schema':'nodenetwork-bootstrap-absence-v1','challenge':challenge,'absent':True},separators=(',',':')))
    except Exception:
        sys.stderr.write('Exact clean bootstrap absence could not be verified.\n');sys.exit(1)
"#;
pub(super) async fn prove_clean_bootstrap(target:&Target,operator:&str,prepared:&Prepared,control:&Path,known_hosts:Option<&Path>,challenge:&str)->Result<(),String>{
    target.validate()?;validate_operator(operator)?;authenticate_release(&prepared.manifest_sha256)?;
    if target.kind!="remote"{return Err("Uncertain bootstrap absence currently requires a pinned remote Linux target".into())}
    let _guard=node_controller::SERIAL.lock().await;
    node_controller::close_connection_checked(target,control,operator).await?;
    let pin=if target.guest.is_none()&&known_hosts.is_none(){Some(node_controller::bootstrap_host_pin(target,control)?)}else{None};
    let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} {}",shell_quote_static(CLEAN_BOOTSTRAP_PROOF),shell_quote_static(challenge));
    let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts.or(pin.as_deref()))?;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=cmd.spawn().map_err(|_|"Cannot start pinned read-only bootstrap reconciliation")?;
    let output=child.stdout.take().ok_or("Absence proof output unavailable")?;
    let result=async{let mut bytes=Vec::new();output.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Absence proof read failed")?;
        if bytes.len()>4096||!child.wait().await.map_err(|_|"Absence proof exit unavailable")?.success(){return Err("Exact clean bootstrap absence was not proven")}
        let expected=json!({"schema":"nodenetwork-bootstrap-absence-v1","challenge":challenge,"absent":true});
        if serde_json::from_slice::<Value>(&bytes).ok()!=Some(expected){return Err("Bootstrap absence response differs from this exact read-only challenge")}
        Ok(())};
    let result=tokio::time::timeout(Duration::from_secs(60),result).await.map_err(|_|"Bootstrap absence proof timed out; journal remains uncertain".to_string()).and_then(|r|r.map_err(String::from));
    drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}

pub(super) fn upgrade_verifier(folder:&Path)->Result<Value,String>{
 let raw=read_bounded(&folder.join("package.json"),1024*1024)?;
 let pin=format!("{:x}",Sha256::digest(&raw));authenticate_release(&pin)?;
 let manifest:Value=serde_json::from_slice(&raw).map_err(|_|"Invalid independently approved verifier manifest")?;
 const SOURCE:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/conformance.py"));
 if manifest["files"]["tools/conformance.py"]!=format!("{:x}",Sha256::digest(SOURCE.as_bytes())){return Err("Selected verifier master does not contain this exact native conformance implementation".into())}
 Ok(json!({"verifier_manifest_json":String::from_utf8(raw).map_err(|_|"Invalid verifier UTF-8")?,"verifier_conformance":SOURCE,"verifier_sha256":pin}))
}
fn decode_upgrade_proof(reply:Value,expected:Value)->Result<Value,String>{
 if reply==json!({"version":1,"ok":true,"result":expected}){return Ok(expected)}
 let phase=reply["error"]["code"].as_str().and_then(|code|code.strip_prefix("upgrade_proof_")).and_then(|code|code.strip_suffix("_refused"));
 if reply.as_object().is_some_and(|v|v.len()==3)&&reply["version"]==1&&reply["ok"]==false&&reply["error"].as_object().is_some_and(|v|v.len()==2)&&reply["error"]["message"]=="Read-only upgrade proof refused"{
  let label=match phase{Some("entry")=>Some("input and freshness"),Some("verifier")=>Some("independent verifier"),Some("engine")=>Some("sealed controller engine"),Some("scope")=>Some("exact authorization and adoption scope"),Some("receipt")=>Some("installed release seal"),Some("outcome")=>Some("upgrade intent and partial absence"),Some("audit")=>Some("exact grant and audit state"),Some("package")=>Some("original staged package"),Some("guest")=>Some("managed guest compatibility"),Some("processes")=>Some("owned service and process quiescence"),Some("conformance")=>Some("full installed conformance"),_=>None};
  if let Some(label)=label{return Err(format!("Read-only upgrade proof refused at {label}; no replacement stage was sent"))}
 }
 Err("Unchanged upgrade outcome not proven; original journal remains uncertain".into())
}
pub(super) async fn prove_upgrade_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:Value,verifier_pin:&str)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;authenticate_release(verifier_pin)?;
 if target.kind!="remote"{return Err("Upgrade non-application proof requires its pinned remote engineering target".into())}
 let script=format!("NATIVE_AUTHENTICATED_MANIFEST_SHA256={}\n{}",serde_json::to_string(verifier_pin).unwrap(),BOOTSTRAP);
 let script=bootstrap_script(&script)?;
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} --upgrade-not-applied-proof",shell_quote_static(&script));
 let _guard=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(target,control,operator).await?;
 let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts)?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=cmd.spawn().map_err(|_|"Cannot start pinned read-only upgrade proof".to_string())?;
 let result=async{
  let bytes=serde_json::to_vec(&wire).map_err(|_|"Cannot encode public upgrade proof".to_string())?;
  if bytes.len()>2*1024*1024{return Err("Upgrade proof input exceeds bound".into())}
  let mut input=child.stdin.take().ok_or_else(||"Upgrade proof input unavailable".to_string())?;
  input.write_all(&bytes).await.map_err(|_|"Upgrade proof input interrupted".to_string())?;input.shutdown().await.map_err(|_|"Upgrade proof input interrupted".to_string())?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or_else(||"Upgrade proof output unavailable".to_string())?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Upgrade proof output interrupted".to_string())?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Upgrade proof exit unavailable".to_string())?.success(){return Err("Unchanged upgrade outcome not proven; preserve original uncertainty".into())}
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Unsupported upgrade proof reply".to_string())?;
  let expected=json!({"schema":"nodenetwork-upgrade-not-applied-v1","challenge":wire["challenge"],"request_sha256":Request{version:1,operation:"upgrade".into(),parameters:wire["request"]["parameters"].clone()}.approval_id(),"old_manifest_sha256":wire["context"]["selection"]["manifest_sha256"],"candidate_manifest_sha256":wire["request"]["parameters"]["manifest_sha256"],"not_applied":true,"mutation_performed":false});
  decode_upgrade_proof(reply,expected)
 };
 let result=tokio::time::timeout(Duration::from_secs(60),result).await.map_err(|_|"Upgrade proof timed out; journal remains uncertain".to_string()).and_then(std::convert::identity);
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}

fn decode_update_commission_grant(reply:Value,context:&Value,challenge:&str,now:u64)->Result<Value,String>{
 let invalid=||"Exact expired commission grant preservation was not proven".to_string();
 let envelope=reply.as_object().ok_or_else(invalid)?;
 if reply["version"]==1&&reply["ok"]==false&&envelope.len()==3{
  let error=reply["error"].as_object().ok_or_else(invalid)?;
  if error.len()==2{for (phase,label) in [("grant_scope","exact expired commissioning grant scope"),("grant_artifacts","unchanged approved commissioning artifacts"),("grant_audit","unused commissioning audit"),("grant_state","unpublished commissioning state"),("requests","outstanding operator requests and commissioning preservation")]{
   let code=format!("engineering_update_{phase}_refused");let message=format!("Engineering update refused at {label}. Inspect and reconcile the exact target; no validator was activated.");
   if reply["error"]["code"]==code&&reply["error"]["message"]==message{return Err(format!("{code}: {message}"))}
  }}
 }
 if envelope.len()!=3||reply["version"]!=1||reply["ok"]!=true{return Err(invalid())}
 let r=&reply["result"];let fields=r.as_object().ok_or_else(invalid)?;
 if fields.len()!=6||!["schema","challenge","parent_sha256","authorization_sequence","preservation","mutation_performed"].iter().all(|k|fields.contains_key(*k))||r["schema"]!="nodenetwork-update-commission-grant-v1"||r["challenge"]!=challenge||r["parent_sha256"]!=context["parent_sha256"]||r["mutation_performed"]!=false||r["authorization_sequence"].as_u64().is_none_or(|n|n==0||n>=(1u64<<53)){return Err(invalid())}
 if !r["preservation"].is_null(){
  let p=&r["preservation"];let fields=p.as_object().ok_or_else(invalid)?;
  let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
  if fields.len()!=4||!["request_sha256","grant_sha256","expires_at","commissioning_sha256"].iter().all(|k|fields.contains_key(*k))||p["request_sha256"]!=request.approval_id()||p["expires_at"].as_u64().is_none_or(|n|n==0||n>now)||["grant_sha256","commissioning_sha256"].iter().any(|k|p[*k].as_str().is_none_or(|v|v.len()!=64||!v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))){return Err(invalid())}
 }
 Ok(r.clone())
}
pub(super) fn same_update_commission_review(before:&Value,after:&Value)->bool{
 ["parent_sha256","authorization_sequence","preservation"].iter().all(|key|before[*key]==after[*key])
}
pub(super) async fn inspect_update_commission_grant(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,context:&Value)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;
 let initial=context["initial_sha256"].as_str().ok_or("Initial scope unavailable")?;
 let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Clock unavailable")?;
 let challenge=format!("{:x}",Sha256::digest(format!("{}:{}:{}",context,now.as_nanos(),std::process::id()).as_bytes()));
 let wire=json!({"context":context,"challenge":challenge});
 let script=bootstrap_script(&format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256={}\n{}",serde_json::to_string(initial).unwrap(),BOOTSTRAP))?;
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} --inspect-update-commission-grant",shell_quote_static(&script));
 let _guard=node_controller::SERIAL.lock().await;
 let mut cmd=if target.kind=="local"{
  if !cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local update grant inspection requires Linux x86_64".into())}
  let mut cmd=tokio::process::Command::new("/usr/bin/sudo");cmd.args(["-n","/usr/bin/python3","-I","-B","-c",&script,"--inspect-update-commission-grant"]);cmd
 }else{
  node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;
  node_controller::close_connection_checked(target,control,operator).await?;
  node_controller::remote_command(target,control,operator,&command,known_hosts)?
 };
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=cmd.spawn().map_err(|_|"Cannot inspect exact retained update grant")?;
 let result=async{
  let bytes=serde_json::to_vec(&wire).map_err(|_|"Cannot encode update grant inspection")?;
  if bytes.len()>65536{return Err("Update grant inspection exceeds bound".to_string())}
  let mut input=child.stdin.take().ok_or("Inspection input unavailable")?;
  input.write_all(&bytes).await.map_err(|_|"Inspection input interrupted")?;input.shutdown().await.map_err(|_|"Inspection input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Inspection output unavailable")?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Inspection output interrupted")?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Inspection exit unavailable")?.success(){return Err("Update grant inspection refused; no update dispatched".into())}
  let reply=serde_json::from_slice(&bytes).map_err(|_|"Invalid update grant inspection")?;
  decode_update_commission_grant(reply,context,&challenge,now.as_secs())
 };
 let result=tokio::time::timeout(Duration::from_secs(60),result).await.map_err(|_|"Update grant inspection timed out; no update dispatched".to_string()).and_then(|r|r);
 drop(child);if target.kind=="remote"{node_controller::close_connection_checked(target,control,operator).await?;}result
}

pub(super) async fn prove_continuation_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;
 let initial=wire["context"]["initial_sha256"].as_str().ok_or("Initial scope unavailable")?;
 let script=format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256={}\n{}",serde_json::to_string(initial).unwrap(),BOOTSTRAP);
 let script=bootstrap_script(&script)?;
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} --continuation-not-applied-proof",shell_quote_static(&script));
 let _guard=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(target,control,operator).await?;
 let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts)?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=cmd.spawn().map_err(|_|"Cannot start pinned continuation proof")?;
 let result=async{
  let bytes=serde_json::to_vec(wire).map_err(|_|"Cannot encode continuation proof")?;if bytes.len()>131072{return Err("Continuation proof exceeds bound")}
  let mut input=child.stdin.take().ok_or("Proof input unavailable")?;input.write_all(&bytes).await.map_err(|_|"Proof input interrupted")?;input.shutdown().await.map_err(|_|"Proof input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Proof output unavailable")?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Proof output interrupted")?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Proof exit unavailable")?.success(){return Err("Continuation nonapplication not proven; preserve pending intent")}
  let pending:Value=serde_json::from_str(wire["pending_json"].as_str().ok_or("Pending document unavailable")?).map_err(|_|"Pending document malformed")?;
  let expected=json!({"schema":"nodenetwork-continuation-not-applied-v1","challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"request_sha256":pending["requests"][0]["request_sha256"],"parent_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
  if serde_json::from_slice::<Value>(&bytes).ok()!=Some(json!({"version":1,"ok":true,"result":expected})){return Err("Exact continuation proof mismatch; pending intent preserved")}
  Ok(expected)
 };
 let result=tokio::time::timeout(Duration::from_secs(60),result).await.map_err(|_|"Continuation proof timed out; no local intent released".to_string()).and_then(|r|r.map_err(String::from));
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}

pub(super) async fn prove_treasury_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;
 let initial=wire["context"]["initial_sha256"].as_str().ok_or("Original initial approval absent")?;
 let script=bootstrap_script(&format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256={}\n{}",serde_json::to_string(initial).unwrap(),BOOTSTRAP))?;
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} --treasury-send-not-applied-proof",shell_quote_static(&script));
 let _serial=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;node_controller::close_connection_checked(target,control,operator).await?;
 let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts)?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);let mut child=cmd.spawn().map_err(|_|"Cannot start pinned read-only proof")?;
 let result=async{
  let remote=json!({"context":wire["context"],"challenge":wire["challenge"]});let bytes=serde_json::to_vec(&remote).map_err(|_|"Cannot encode commission proof")?;if bytes.len()>65536{return Err("Commission proof input exceeds bound")}
  let mut input=child.stdin.take().ok_or("Commission proof input unavailable")?;input.write_all(&bytes).await.map_err(|_|"Commission proof input interrupted")?;input.shutdown().await.map_err(|_|"Commission proof input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Commission proof output unavailable")?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Commission proof output interrupted")?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Commission proof exit unavailable")?.success(){return Err("Treasury phase unavailable; original request remains fenced")}
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid commission proof; original request remains fenced")?;
  decode_treasury_not_applied(&reply,wire)
 };
 let result=tokio::time::timeout(Duration::from_secs(120),result).await.map_err(|_|"Commission proof timed out; original request remains fenced".to_string()).and_then(|r|r.map_err(String::from));
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}
fn decode_treasury_not_applied(reply:&Value,wire:&Value)->Result<Value,&'static str>{
 let expected=json!({"schema":"nodenetwork-treasury-send-not-applied-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"nonce":wire["context"]["nonce"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
 if *reply!=json!({"version":1,"ok":true,"result":expected}){return Err("Exact treasury nonapplication proof unavailable; original request remains fenced")}Ok(expected)
}

pub(super) async fn inspect_treasury_phase(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;
 let initial=wire["context"]["initial_sha256"].as_str().ok_or("Original initial approval absent")?;
 let script=bootstrap_script(&format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256={}\n{}",serde_json::to_string(initial).unwrap(),BOOTSTRAP))?;
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} --treasury-send-phase-proof",shell_quote_static(&script));
 let _serial=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;node_controller::close_connection_checked(target,control,operator).await?;
 let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts)?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);let mut child=cmd.spawn().map_err(|_|"Cannot start pinned read-only proof")?;
 let result=async{
  let remote=json!({"context":wire["context"],"challenge":wire["challenge"]});let bytes=serde_json::to_vec(&remote).map_err(|_|"Cannot encode commission proof")?;if bytes.len()>65536{return Err("Commission proof input exceeds bound")}
  let mut input=child.stdin.take().ok_or("Commission proof input unavailable")?;input.write_all(&bytes).await.map_err(|_|"Commission proof input interrupted")?;input.shutdown().await.map_err(|_|"Commission proof input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Commission proof output unavailable")?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Commission proof output interrupted")?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Commission proof exit unavailable")?.success(){return Err("Treasury phase unavailable; original request remains fenced")}
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid commission proof; original request remains fenced")?;
  decode_treasury_phase(&reply,wire)
 };
 let result=tokio::time::timeout(Duration::from_secs(120),result).await.map_err(|_|"Commission proof timed out; original request remains fenced".to_string()).and_then(|r|r.map_err(String::from));
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}
#[cfg(test)]#[test]fn treasury_nonapplication_decoder_rejects_foreign_or_applied_claims(){
 let wire=json!({"challenge":"a".repeat(64),"context":{"request_sha256":"b".repeat(64),"nonce":0,"authorization":{"sha256":"c".repeat(64)}}});let v=json!({"schema":"nodenetwork-treasury-send-not-applied-v1","challenge":"a".repeat(64),"request_sha256":"b".repeat(64),"nonce":0,"authorization_sha256":"c".repeat(64),"not_applied":true,"mutation_performed":false});let reply=|v:Value|json!({"version":1,"ok":true,"result":v});assert!(decode_treasury_not_applied(&reply(v.clone()),&wire).is_ok());
 for(k,val)in[("challenge",json!("d".repeat(64))),("nonce",json!(1)),("authorization_sha256",json!("d".repeat(64))),("request_sha256",json!("d".repeat(64))),("mutation_performed",json!(true)),("not_applied",json!(false)),("extra",json!("private"))]{let mut bad=v.clone();bad[k]=val;assert!(decode_treasury_not_applied(&reply(bad),&wire).is_err(),"{k}")}
}
fn decode_treasury_phase(reply:&Value,wire:&Value)->Result<Value,&'static str>{
 let fail="Unsupported treasury phase observation; original request remains fenced";
 let v=&reply["result"];let files=&v["files"];
 let pin=|v:&Value|v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 if !files.as_object().is_some_and(|o|o.len()==4&&["request","prepared","admission","dispatch"].iter().all(|k|o.get(*k).is_some_and(|v|v.is_null()||pin(v))))||!matches!(v["grant_state"].as_str(),Some("absent"|"exact"|"different"))||!matches!(v["audit_state"].as_str(),Some("not_consumed"|"consumed"))||!matches!(v["reservation"].as_str(),Some("absent"|"partial"|"complete_inventory_unverified"))||!(v["request_matches"].is_null()||v["request_matches"].is_boolean()){return Err(fail)}
 let empty="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
 let absent=["request","prepared","admission","dispatch"].iter().all(|k|files[*k].is_null());
 let complete=["request","prepared","admission"].iter().all(|k|files[*k].as_str().is_some_and(|h|h!=empty));
 if (v["reservation"]=="absent"&&!absent)||(v["reservation"]=="complete_inventory_unverified")!=complete||files["request"].is_null()!=v["request_matches"].is_null()||(!files["request"].is_null()&&v["request_matches"].as_bool()!=Some(files["request"]==v["request_sha256"])){return Err(fail)}
 let expected=json!({"schema":"nodenetwork-treasury-send-phase-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"nonce":wire["context"]["nonce"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"grant_state":v["grant_state"],"audit_state":v["audit_state"],"reservation":v["reservation"],"files":files,"request_matches":v["request_matches"],"mutation_performed":false});
 if *reply!=json!({"version":1,"ok":true,"result":expected}){return Err(fail)}Ok(expected)
}

pub(super) async fn prove_commission_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;
 let initial=wire["context"]["initial_sha256"].as_str().ok_or("Original initial approval absent")?;
 let script=bootstrap_script(&format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256={}\n{}",serde_json::to_string(initial).unwrap(),BOOTSTRAP))?;
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} --commission-outcome-proof",shell_quote_static(&script));
 let _serial=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;node_controller::close_connection_checked(target,control,operator).await?;
 let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts)?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);let mut child=cmd.spawn().map_err(|_|"Cannot start pinned read-only proof")?;
 let result=async{
  let remote=json!({"context":wire["context"],"challenge":wire["challenge"]});let bytes=serde_json::to_vec(&remote).map_err(|_|"Cannot encode commission proof")?;if bytes.len()>65536{return Err("Commission proof input exceeds bound")}
  let mut input=child.stdin.take().ok_or("Commission proof input unavailable")?;input.write_all(&bytes).await.map_err(|_|"Commission proof input interrupted")?;input.shutdown().await.map_err(|_|"Commission proof input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Commission proof output unavailable")?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Commission proof output interrupted")?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Commission proof exit unavailable")?.success(){return Err("Commission nonapplication not proven; original request remains fenced")}
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid commission proof; original request remains fenced")?;
  decode_commission_proof(&reply,wire)
 };
 let result=tokio::time::timeout(Duration::from_secs(120),result).await.map_err(|_|"Commission proof timed out; original request remains fenced".to_string()).and_then(|r|r.map_err(String::from));
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}
#[cfg(test)]#[test]fn treasury_phase_decoder_is_bound_and_never_an_outcome(){
 let wire=json!({"challenge":"a".repeat(64),"context":{"request_sha256":"b".repeat(64),"nonce":0,"authorization":{"sha256":"c".repeat(64)}}});
 let v=json!({"schema":"nodenetwork-treasury-send-phase-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"nonce":0,"authorization_sha256":"c".repeat(64),"grant_state":"exact","audit_state":"not_consumed","reservation":"absent","files":{"request":null,"prepared":null,"admission":null,"dispatch":null},"request_matches":null,"mutation_performed":false});
 let reply=|v:Value|json!({"version":1,"ok":true,"result":v});assert!(decode_treasury_phase(&reply(v.clone()),&wire).is_ok());
 let mut partial=v.clone();partial["reservation"]=json!("partial");assert!(decode_treasury_phase(&reply(partial.clone()),&wire).is_ok());partial["files"]["request"]=json!("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");partial["request_matches"]=json!(false);assert!(decode_treasury_phase(&reply(partial),&wire).is_ok());
 for(k,val)in[("challenge",json!("d".repeat(64))),("nonce",json!(1)),("authorization_sha256",json!("d".repeat(64))),("request_sha256",json!("d".repeat(64))),("mutation_performed",json!(true)),("reservation",json!("complete_inventory_unverified")),("request_matches",json!(false)),("extra",json!("private"))]{let mut bad=v.clone();bad[k]=val;assert!(decode_treasury_phase(&reply(bad),&wire).is_err(),"{k}")}
}
fn decode_commission_proof(reply:&Value,wire:&Value)->Result<Value,&'static str>{
 let readiness=reply["result"]["readiness_sha256"].as_str().filter(|p|p.len()==64&&p.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).ok_or("Commission nonapplication not proven; original request remains fenced")?;
 let expected=json!({"schema":"nodenetwork-commission-not-applied-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"readiness_sha256":readiness,"not_applied":true,"mutation_performed":false});
 if *reply!=json!({"version":1,"ok":true,"result":expected}){return Err("Exact commission nonapplication proof mismatch; original request remains fenced")}Ok(expected)
}

pub(super) async fn prove_transport_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value)->Result<Value,String>{prove_artifact_not_applied(target,operator,control,known_hosts,wire,false).await}
pub(super) async fn prove_readiness_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value)->Result<Value,String>{prove_artifact_not_applied(target,operator,control,known_hosts,wire,true).await}
async fn prove_artifact_not_applied(target:&Target,operator:&str,control:&Path,known_hosts:Option<&Path>,wire:&Value,readiness:bool)->Result<Value,String>{
 target.validate()?;validate_operator(operator)?;
 let initial=wire["context"]["initial_sha256"].as_str().ok_or("Initial scope unavailable")?;
 let script=format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256={}\n{}",serde_json::to_string(initial).unwrap(),BOOTSTRAP);
 let script=bootstrap_script(&script)?;
 let flag=if readiness{"--prove-readiness-not-applied"}else{"--prove-transport-not-applied"};
 let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} {flag}",shell_quote_static(&script));
 let _guard=node_controller::SERIAL.lock().await;
 node_controller::close_connection_checked(target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(target,control,operator).await?;
 let mut cmd=node_controller::remote_command(target,control,operator,&command,known_hosts)?;
 cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=cmd.spawn().map_err(|_|"Cannot start pinned continuation proof")?;
 let result=async{
  let mut remote=wire.clone();remote.as_object_mut().ok_or("Malformed transport proof")?.remove("intent");
  let bytes=serde_json::to_vec(&remote).map_err(|_|"Cannot encode continuation proof")?;if bytes.len()>131072{return Err("Continuation proof exceeds bound")}
  let mut input=child.stdin.take().ok_or("Proof input unavailable")?;input.write_all(&bytes).await.map_err(|_|"Proof input interrupted")?;input.shutdown().await.map_err(|_|"Proof input interrupted")?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or("Proof output unavailable")?.take(4097).read_to_end(&mut bytes).await.map_err(|_|"Proof output interrupted")?;
  if bytes.len()>4096||!child.wait().await.map_err(|_|"Proof exit unavailable")?.success(){return Err("Continuation nonapplication not proven; preserve pending intent")}
  let expected=json!({"schema":if readiness{"nodenetwork-readiness-not-applied-v1"}else{"nodenetwork-transport-not-applied-v1"},"challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"dispatch_sha256":wire["context"]["dispatch_sha256"],"parent_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
  if serde_json::from_slice::<Value>(&bytes).ok()!=Some(json!({"version":1,"ok":true,"result":expected})){return Err("Exact continuation proof mismatch; pending intent preserved")}
  Ok(expected)
 };
 let result=tokio::time::timeout(Duration::from_secs(60),result).await.map_err(|_|"Continuation proof timed out; no local intent released".to_string()).and_then(|r|r.map_err(String::from));
 drop(child);node_controller::close_connection_checked(target,control,operator).await?;result
}

#[cfg(test)] mod tests {
    #[test]fn commission_proof_decoder_is_closed_and_never_accepts_applied_or_partial(){
      let wire=serde_json::json!({"challenge":"a".repeat(64),"context":{"request_sha256":"b".repeat(64),"authorization":{"sha256":"c".repeat(64)}}});
      let proof=serde_json::json!({"schema":"nodenetwork-commission-not-applied-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"readiness_sha256":"d".repeat(64),"not_applied":true,"mutation_performed":false});
      let reply=serde_json::json!({"version":1,"ok":true,"result":proof});assert_eq!(super::decode_commission_proof(&reply,&wire).unwrap(),proof);
      for field in ["challenge","request_sha256","authorization_sha256","readiness_sha256","not_applied","mutation_performed"]{let mut bad=reply.clone();bad["result"][field]=serde_json::Value::Null;assert!(super::decode_commission_proof(&bad,&wire).is_err());}
      let mut extra=reply.clone();extra["result"]["commissioned"]=serde_json::json!(true);assert!(super::decode_commission_proof(&extra,&wire).is_err());
      let private=serde_json::json!({"version":1,"ok":false,"error":{"message":"private raw output"}});assert!(!super::decode_commission_proof(&private,&wire).unwrap_err().contains("private"));
    }

    #[test]fn compressed_bootstrap_roundtrip_preserves_exact_source_globals_stdin_and_fail_closed(){
     use std::io::Write;use sha2::Digest;
     let source=format!("__name__='fixture'\nNATIVE_TEST_PIN='{}'\n{}\nimport sys\nassert NATIVE_TEST_PIN=='{}'\nassert sys.argv[1:] == ['fixed-flag']\nassert sys.stdin.buffer.read()==b'exact stdin'\nprint('verified-source-{}')\n", "a".repeat(64),super::BOOTSTRAP,"a".repeat(64),super::script_pin());
     let encoded=super::bootstrap_script(&source).unwrap();assert!(encoded.len()<64*1024);assert!(encoded.contains("NATIVE_AUTHENTICATED_MANIFEST_SHA256="));
     let run=|loader:&str|{let mut child=std::process::Command::new("python3").args(["-I","-B","-c",loader,"fixed-flag"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().unwrap();child.stdin.take().unwrap().write_all(b"exact stdin").unwrap();child.wait_with_output().unwrap()};
     let output=run(&encoded);assert!(output.status.success());assert_eq!(String::from_utf8(output.stdout).unwrap().trim(),format!("verified-source-{}",super::script_pin()));
     let pin=format!("{:x}",sha2::Sha256::digest(source.as_bytes()));
     for changed in [encoded.replace(&pin,&"0".repeat(64)),encoded.replacen("base64.b64decode('","base64.b64decode('A",1),format!("import builtins\n_original_import=__import__\ndef reject(name,*a,**k):\n if name=='zlib': raise ImportError('unavailable')\n return _original_import(name,*a,**k)\nbuiltins.__import__=reject\n{encoded}")]{let output=run(&changed);assert!(!output.status.success());assert!(output.stdout.is_empty());}
     assert!(super::bootstrap_script("").is_err());assert!(super::bootstrap_script(&"x".repeat(2*1024*1024+1)).is_err());
    }
    #[test]fn clean_bootstrap_proof_rejects_partial_state_and_active_bootstrap(){
     let fixture=r#"
import tempfile
with tempfile.TemporaryDirectory() as temp:
    base=Path(temp);etc=base/'etc';proc=base/'proc';etc.mkdir();proc.mkdir()
    roots=(str(base/'synergy'),str(base/'Synergy'));mount=base/'mountinfo';mount.write_text('1 0 0:1 / / rw - tmpfs tmpfs rw\n')
    def prove(accounts=lambda:True,units=lambda:True):clean(roots,etc,proc,mount,accounts,units,(etc/'systemd/system',),set())
    def denied():
        try:prove()
        except (ValueError,OSError):return
        raise AssertionError('partial state accepted')
    prove()
    Path(roots[0]).mkdir();denied();Path(roots[0]).rmdir()
    Path(roots[1]).symlink_to(base/'absent');denied();Path(roots[1]).unlink()
    d=etc/'sudoers.d';d.mkdir();p=d/'synergy-nodenetwork';p.write_text('public fixture');denied();p.unlink()
    d=etc/'systemd/system';d.mkdir(parents=True);p=d/'synergy-installation-guard.service';p.symlink_to(base/'absent');denied();p.unlink()
    mount.write_text('1 0 0:1 / '+roots[0]+' rw - tmpfs tmpfs rw\n');denied();mount.write_text('1 0 0:1 / / rw - tmpfs tmpfs rw\n')
    process=proc/'999999';process.mkdir();(process/'cmdline').write_bytes(b'python3\0-c\0NATIVE_AUTHENTICATED_MANIFEST_SHA256=x\0')
    (process/'exe').symlink_to('/usr/bin/python3');(process/'cwd').symlink_to('/');(process/'mountinfo').write_bytes(mount.read_bytes());(process/'maps').write_text('');(process/'fd').mkdir();denied()
    (process/'cmdline').write_bytes(b'ordinary-process\0');prove()
    descriptor=process/'fd/3';descriptor.symlink_to(roots[0]+'/deleted (deleted)');denied();descriptor.unlink()
    (process/'maps').write_text('0-1 r--p 0 0:0 0 '+roots[1]+'/mapped (deleted)\n');denied();(process/'maps').write_text('')
    mount.write_text('1 0 0:1 / '+roots[0].replace('/',r'\057')+' rw - tmpfs tmpfs rw\n');denied();mount.write_text('1 0 0:1 / / rw - overlay overlay rw,lowerdir='+roots[0]+'/deleted\n');denied();mount.write_text('1 0 0:1 / / rw - tmpfs tmpfs rw\n')
    (process/'cwd').unlink();(process/'cwd').symlink_to(roots[0]);denied()
    for check in ((lambda:False,lambda:True),(lambda:True,lambda:False)):
        try:prove(*check)
        except ValueError:continue
        raise AssertionError('account or units accepted')
"#;
     // Execute the same fixed checker, with only filesystem fixtures substituted.
     let script=format!("scope={{'__name__':'fixture'}}\nexec({},scope)\nexec({},scope)",serde_json::to_string(CLEAN_BOOTSTRAP_PROOF).unwrap(),serde_json::to_string(fixture).unwrap());
     let out=std::process::Command::new("/usr/bin/python3").args(["-I","-B","-c",&script]).output().unwrap();
     assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));
    }
    #[test]fn clean_bootstrap_units_require_independent_inert_tombstone_proof(){
     let fixture=r#"
from unittest.mock import patch
from subprocess import CompletedProcess
values=dict(LoadState='not-found',ActiveState='failed',SubState='failed',MainPID='0',ControlPID='0',FragmentPath='',SourcePath='',DropInPaths='',UnitFileState='',Triggers='',TriggeredBy='',Job='')
def check(changes=None,raw=None,status=0,stderr='',row='synergy-posy-old.service not-found failed failed old\n'):
    data=dict(values);data.update(changes or {})
    detail=''.join(k+'='+v+'\n' for k,v in data.items()) if raw is None else raw
    with patch.object(subprocess,'run',side_effect=[CompletedProcess([],1,stdout='',stderr=''),CompletedProcess([],0,stdout=row,stderr=''),CompletedProcess([],status,stdout=detail,stderr=stderr)]):return units_absent()
assert check()
assert check({'ActiveState':'inactive','SubState':'dead'})
for key,value in [('LoadState','loaded'),('ActiveState','active'),('SubState','auto-restart'),('MainPID','2'),('ControlPID','3'),('FragmentPath','/etc/old.service'),('SourcePath','/old'),('DropInPaths','/old.conf'),('UnitFileState','masked'),('Triggers','old.service'),('TriggeredBy','old.timer'),('Job','1')]:
    try:check({key:value})
    except ValueError:continue
    raise AssertionError('unsafe tombstone '+key)
exact=''.join(k+'='+v+'\n' for k,v in values.items())
for args in [dict(raw=exact+'MainPID=0\n'),dict(raw=exact.replace('Job=\n','')),dict(raw=exact+'Unknown=\n'),dict(raw='x'*65537),dict(status=1),dict(stderr='warning'),dict(row='ssh.service not-found failed failed\n'),dict(row='synergy-node.service loaded failed failed\n')]:
    try:check(**args)
    except ValueError:continue
    raise AssertionError('invalid tombstone accepted')
"#;
     let script=format!("scope={{'__name__':'fixture'}}\nexec({},scope)\nexec({},scope)",serde_json::to_string(CLEAN_BOOTSTRAP_PROOF).unwrap(),serde_json::to_string(fixture).unwrap());
     let out=std::process::Command::new("/usr/bin/python3").args(["-I","-B","-c",&script]).output().unwrap();
     assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));
    }
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
    #[tokio::test(flavor="current_thread")]
    async fn bootstrap_transport_classifies_failed_sessions_without_exposing_remote_bytes(){
     for (exit,output,expected) in [(255,"","Bootstrap SSH session unavailable."),(17,"private remote failure","Bootstrap transport failed during remote execution."),(0,"not-json","Invalid bootstrap response from a completed session.")]{
      let script=format!("import sys\nsys.stdin.buffer.read()\nsys.stdout.write({output:?})\nsys.stderr.write('PRIVATE STDERR MUST NEVER ESCAPE')\nsys.exit({exit})\n");
      let mut child=bootstrap_transport_child(&script);let input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();
      let mut upload=tokio::spawn(async move{drop(input);Ok(())});
      let error=super::bootstrap_transport_reply(output,&mut upload,&mut child).await.unwrap_err();
      assert!(error.starts_with(expected),"{error}");assert!(!error.contains("private remote"));assert!(!error.contains("PRIVATE STDERR"));
     }
    }
    #[cfg(unix)]
    #[tokio::test(flavor="current_thread")]
    async fn bootstrap_transport_signal_is_uncertain_not_malformed_response(){
     let mut child=bootstrap_transport_child("import os,signal\nos.kill(os.getpid(),signal.SIGTERM)\n");
     let input=child.stdin.take().unwrap();let output=child.stdout.take().unwrap();let mut upload=tokio::spawn(async move{drop(input);Ok(())});
     assert!(super::bootstrap_transport_reply(output,&mut upload,&mut child).await.unwrap_err().starts_with("Bootstrap transport interrupted."));
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
 #[test]fn update_commission_grant_review_is_exact_expired_and_nonmutating(){
  let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
  let context=json!({"parent_sha256":"a".repeat(64)});let challenge="b".repeat(64);
  let result=json!({"schema":"nodenetwork-update-commission-grant-v1","challenge":challenge,"parent_sha256":context["parent_sha256"],"authorization_sequence":21,"preservation":{"request_sha256":request.approval_id(),"grant_sha256":"c".repeat(64),"expires_at":999,"commissioning_sha256":"d".repeat(64)},"mutation_performed":false});
  let reply=json!({"version":1,"ok":true,"result":result});
  let mut refreshed=result.clone();refreshed["challenge"]=json!("e".repeat(64));assert!(same_update_commission_review(&result,&refreshed));
  for (field,value) in [("parent_sha256",json!("e".repeat(64))),("authorization_sequence",json!(22)),("preservation",Value::Null)]{let mut changed=refreshed.clone();changed[field]=value;assert!(!same_update_commission_review(&result,&changed));}
  assert!(decode_update_commission_grant(reply.clone(),&context,&challenge,1000).is_ok());
  let mut empty=reply.clone();empty["result"]["preservation"]=Value::Null;assert!(decode_update_commission_grant(empty,&context,&challenge,1000).is_ok());
  for (field,value) in [("challenge",json!("e".repeat(64))),("parent_sha256",json!("e".repeat(64))),("authorization_sequence",json!(0)),("mutation_performed",json!(true)),("extra",json!(false))]{let mut bad=reply.clone();bad["result"][field]=value;assert!(decode_update_commission_grant(bad,&context,&challenge,1000).is_err());}
  for (field,value) in [("request_sha256",json!("e".repeat(64))),("grant_sha256",json!("invalid")),("expires_at",json!(1001)),("expires_at",json!("999")),("commissioning_sha256",json!("E".repeat(64))),("extra",json!(false))]{let mut bad=reply.clone();bad["result"]["preservation"][field]=value;assert!(decode_update_commission_grant(bad,&context,&challenge,1000).is_err());}
  for field in ["preservation","mutation_performed"]{let mut bad=reply.clone();bad["result"].as_object_mut().unwrap().remove(field);assert!(decode_update_commission_grant(bad,&context,&challenge,1000).is_err());}
  let refused=json!({"version":1,"ok":false,"error":{"code":"engineering_update_grant_audit_refused","message":"Engineering update refused at unused commissioning audit. Inspect and reconcile the exact target; no validator was activated."}});
  assert!(decode_update_commission_grant(refused.clone(),&context,&challenge,1000).unwrap_err().starts_with("engineering_update_grant_audit_refused:"));
  let mut foreign=refused;foreign["error"]["message"]=json!("PRIVATE CONTENT");let error=decode_update_commission_grant(foreign,&context,&challenge,1000).unwrap_err();assert!(!error.contains("PRIVATE"));
 }
 #[test]fn replacement_proof_is_bounded_stdin_not_ssh_script_context(){
  let scope=json!({"initial_sha256":"a".repeat(64),"parent_sha256":"b".repeat(64),"formation_sha256":"c".repeat(64),"target":{"host":"exact"},"selection":{"manifest_sha256":"d".repeat(64)},"expires_at":1});
  let mut context=scope.clone();context["release_id"]=json!("new");context["manifest_sha256"]=json!("e".repeat(64));
  assert_eq!(update_replacement_wire(&context).unwrap(),(context.clone(),None));
  context["superseded_upgrade"]=json!({"context":scope,"request":{"operation":"upgrade"},"verifier_conformance":"public native source"});
  let (script,wire)=update_replacement_wire(&context).unwrap();assert!(script.get("superseded_upgrade").is_none());
  let wire=wire.unwrap();assert_eq!(wire.last(),Some(&b'\n'));assert_eq!(serde_json::from_slice::<Value>(&wire).unwrap(),context["superseded_upgrade"]);
  for field in ["initial_sha256","parent_sha256","formation_sha256","target","selection","expires_at"]{let mut changed=context.clone();changed["superseded_upgrade"]["context"][field]=Value::Null;assert!(update_replacement_wire(&changed).is_err());}
  context["superseded_upgrade"]["verifier_conformance"]=json!("x".repeat(2*1024*1024));assert!(update_replacement_wire(&context).is_err());
 }

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
 let script=bootstrap_script(&script)?;
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

#[cfg(test)] mod incoming_safety_tests {
 use super::*;
 const OPENSSH_VECTOR:&str="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea";
 const VECTOR_SHA256:&str="6442aab9f902438a4cb8c8937e7cd0d0a66737acab731501554caaeb89a59774";
 fn bootstrap_transport_child(script:&str)->tokio::process::Child{let mut c=tokio::process::Command::new("/usr/bin/python3");c.args(["-I","-B","-c",script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);c.spawn().unwrap()}
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
       // The helper may already have joined upload on malformed stdout.
       upload.abort();let _=child.wait().await;
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
    #[test]
    fn bootstrap_transport_acknowledgement_binds_master_and_staging_only_scope(){
     let release="fixture-release";let pin="a".repeat(64);
     let result=json!({"root":"/opt/synergy","stagedRelease":release,"manifestSha256":pin,
      "controllerEnrolled":true,"softwareInstalled":false,"activationAuthorized":false,"communityEnrollment":false,
      "operatorAuthorizationRequired":true,"rootDeletionGuardActive":true,"hostManagedRecords":["system-account:synergy-nodenetwork",
       "/etc/ssh/sshd_config.d/synergy-nodenetwork.conf","/etc/sudoers.d/synergy-nodenetwork","/etc/systemd/system/synergy-installation-guard.service","/etc/systemd/system/multi-user.target.wants/synergy-installation-guard.service"]});
     let wrap=|result|json!({"version":1,"ok":true,"result":result});
     assert!(validate_bootstrap_acknowledgement(&wrap(result.clone()),release,&pin).is_ok());
     let mut reordered=result.clone();reordered["hostManagedRecords"].as_array_mut().unwrap().reverse();
     assert!(validate_bootstrap_acknowledgement(&wrap(reordered),release,&pin).is_ok());
     for (key,value) in [("root",json!("/opt/Synergy")),("stagedRelease",json!("another-release")),
      ("manifestSha256",json!("b".repeat(64))),("controllerEnrolled",json!(false)),("softwareInstalled",json!(true)),
      ("activationAuthorized",json!(true)),("communityEnrollment",json!(true)),("operatorAuthorizationRequired",json!(false)),
      ("hostManagedRecords",json!(["system-account:synergy-nodenetwork"])),("unknown",json!("excluded"))]{
      let mut altered=result.clone();altered[key]=value;
      assert!(validate_bootstrap_acknowledgement(&wrap(altered),release,&pin).is_err(),"{key}");
     }
     assert!(validate_bootstrap_acknowledgement(&wrap(json!({})),release,&pin).is_err());
    }

    #[test]
    fn target_operator_identity_is_public_only_immutable_and_scopes_controller_argv() {
      let folder=std::path::PathBuf::from("/private/tmp").join(format!("osi-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
      let target:Target=serde_json::from_value(json!({"kind":"remote","host":"fixture.invalid","port":22,"root":"/opt/synergy"})).unwrap();
      assert!(controller_operator_identity(&target,&folder).unwrap().is_none());
      assert_eq!(retain_operator_identity(&target,&folder,OPENSSH_VECTOR).unwrap()["canonicalSha256"],VECTOR_SHA256);
      let path=controller_operator_identity(&target,&folder).unwrap().unwrap();
      assert_eq!(fs::read_to_string(&path).unwrap(),format!("{OPENSSH_VECTOR}\n"));
      assert!(!path.with_extension("").exists()); // no matching private-key path
      retain_operator_identity(&target,&folder,OPENSSH_VECTOR).unwrap();
      let mut bytes=STANDARD_NO_PAD.decode(OPENSSH_VECTOR.split_whitespace().nth(1).unwrap()).unwrap();bytes[50]^=1;
      let changed=format!("ssh-ed25519 {}",STANDARD_NO_PAD.encode(bytes));
      assert!(retain_operator_identity(&target,&folder,&changed).is_err());
      assert!(require_selected_operator_identity(&target,&folder,&changed).is_err());
      require_selected_operator_identity(&target,&folder,OPENSSH_VECTOR).unwrap();
      let mut other=target.clone();other.host=Some("other.invalid".into());
      assert!(controller_operator_identity(&other,&folder).unwrap().is_none());
      let command=node_controller::remote_command(&target,&folder,"synergy-nodenetwork","fixed",Some(&folder.join("fixture-known-hosts"))).unwrap();
      let args=command.as_std().get_args().map(|a|a.to_str().unwrap()).collect::<Vec<_>>();
      assert!(args.contains(&"-oIdentitiesOnly=yes"));let identity=args.iter().position(|a|*a=="-i").unwrap();
      assert_eq!(args[identity+1],path.to_str().unwrap());assert!(identity<args.iter().position(|a|*a=="--").unwrap());
      assert!(args.contains(&"-oStrictHostKeyChecking=yes"));assert!(args.contains(&"-oForwardAgent=no"));
      let admin=node_controller::remote_command(&target,&folder,"node","fixed",Some(&folder.join("fixture-known-hosts"))).unwrap();
      let admin_args=admin.as_std().get_args().map(|a|a.to_str().unwrap()).collect::<Vec<_>>();assert!(admin_args.contains(&"-oIdentitiesOnly=yes"));assert!(admin_args.windows(2).any(|a|a==["-i",path.to_str().unwrap()]));
      fs::remove_dir_all(folder).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn target_operator_identity_rejects_links_permissions_and_partial_publication() {
      use std::os::unix::fs::{symlink,PermissionsExt};
      let folder=std::env::temp_dir().canonicalize().unwrap().join(format!("operator-selection-negative-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
      let target:Target=serde_json::from_value(json!({"kind":"remote","host":"fixture.invalid","port":22,"root":"/opt/synergy"})).unwrap();
      retain_operator_identity(&target,&folder,OPENSSH_VECTOR).unwrap();let path=controller_operator_identity(&target,&folder).unwrap().unwrap();
      fs::set_permissions(&path,fs::Permissions::from_mode(0o644)).unwrap();assert!(controller_operator_identity(&target,&folder).is_err());
      fs::set_permissions(&path,fs::Permissions::from_mode(0o600)).unwrap();fs::write(&path,b"partial").unwrap();assert!(controller_operator_identity(&target,&folder).is_err());
      fs::remove_file(&path).unwrap();symlink("missing",&path).unwrap();assert!(controller_operator_identity(&target,&folder).is_err());
      fs::remove_file(&path).unwrap();fs::write(path.with_extension("pending"),b"partial").unwrap();assert!(retain_operator_identity(&target,&folder,OPENSSH_VECTOR).is_err());
      fs::remove_dir_all(folder).unwrap();
    }
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

}

#[cfg(test)]mod continuation_transport_size_tests{
 use super::*;
 #[test]fn embedded_bootstrap_remote_arguments_fit_linux_limit_including_maximum_guest_context(){
  let pin="a".repeat(64);let host="h".repeat(253);let release="r".repeat(128);
  let selection=json!({"release_id":release,"manifest_sha256":pin,"network_id":"n".repeat(128),"chain_id":u64::MAX,"node_name":"v".repeat(64)});
  // Full permitted physical identity plus host-relative guest receipt; all
  // reviewed public context fields are represented at their parser bounds.
  let target=json!({"kind":"remote","host":host,"port":65535,"root":"/opt/synergy","host_key":format!("[{}]:65535 ssh-ed25519 {}",host,"A".repeat(68)),"machine_id_sha256":null,"guest":{"guest_id":"g".repeat(64),"create_request_sha256":pin,"ssh_host_public_key":format!("ssh-ed25519 {}","A".repeat(68)),"ssh_host_fingerprint":format!("SHA256:{}","A".repeat(43))}});
  let context=json!({"initial_sha256":pin,"parent_sha256":pin,"formation_sha256":pin,"target":target,"selection":selection,"release_id":release,"manifest_sha256":pin,"expires_at":u64::MAX});
  let globals=format!("NATIVE_AUTHENTICATED_SUPERSEDED_UPGRADE=True\nNATIVE_AUTHENTICATED_MANIFEST_SHA256=\"{pin}\"\nNATIVE_AUTHENTICATED_UPDATE_CONTEXT=__import__('json').loads({})\n",serde_json::to_string(&context.to_string()).unwrap());
  let authorization=format!("NATIVE_AUTHENTICATED_AUTHORIZATION_SHA256=\"{pin}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256=\"{pin}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_PARENT_SHA256=\"{pin}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_FORMATION_SHA256=\"{pin}\"\n");
  let proof=format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256=\"{pin}\"\n");
  for (name,global,tail) in [("update",globals,format!("--stage-engineering-update {release} {pin} --reconcile")),("authorization",authorization,"--stage-engineering-authorization".into()),("proof",proof,"--continuation-not-applied-proof".into())]{
   let script=bootstrap_script(&format!("{global}{BOOTSTRAP}")).unwrap();let command=format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c {} {tail}",shell_quote_static(&script));
   // Linux MAX_ARG_STRLEN includes its terminating NUL; ProxyCommand remains
   // a separate bounded argv item, never wraps or re-quotes this remote command.
   assert!(command.len()<96*1024,"{name} remote argument is {} bytes",command.len()+1);
   println!("{name} remote argument bytes including NUL: {}",command.len()+1);
  }
 }
}

#[cfg(test)]mod upgrade_proof_error_tests{
 use super::*;
 #[test]fn only_closed_fixed_readonly_phase_errors_are_exposed(){
  let expected=json!({"not_applied":true});assert_eq!(decode_upgrade_proof(json!({"version":1,"ok":true,"result":expected}),expected.clone()).unwrap(),expected);
  for phase in ["entry","verifier","engine","scope","receipt","outcome","audit","package","guest","processes","conformance"]{
   let reply=json!({"version":1,"ok":false,"error":{"code":format!("upgrade_proof_{phase}_refused"),"message":"Read-only upgrade proof refused"}});
   let text=decode_upgrade_proof(reply.clone(),expected.clone()).unwrap_err();assert!(text.starts_with("Read-only upgrade proof refused at "));assert!(text.ends_with("no replacement stage was sent"));
   for (key,value) in [("message",json!("PRIVATE stderr /sensitive/path")),("code",json!("upgrade_proof_PRIVATE_refused"))]{let mut bad=reply.clone();bad["error"][key]=value;let text=decode_upgrade_proof(bad,expected.clone()).unwrap_err();assert!(!text.contains("PRIVATE"));assert!(!text.contains("sensitive"));assert!(!text.starts_with("Read-only upgrade proof refused at "));}
   let mut bad=reply;bad["extra"]=json!(true);assert!(!decode_upgrade_proof(bad,expected.clone()).unwrap_err().starts_with("Read-only upgrade proof refused at "));
  }
 }
}
