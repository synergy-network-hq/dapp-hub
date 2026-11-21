//! Exact debug-build authorization, not a production issuer or membership proof.
use crate::{node_bootstrap,node_controller::{self,Target,Request}};
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::BTreeMap,path::Path,process::Stdio,time::{Duration,SystemTime,UNIX_EPOCH}};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
use zeroize::Zeroizing;
const PROFILE:&str="nodenetwork-isolated-formation-authorization-v1";
const BOOTSTRAP:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/bootstrap.py"));
const GATEWAY_CONTROLLER:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/controller.py"));
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BoundTarget {kind:String,host:Option<String>,port:Option<u16>,root:String,host_key:Option<String>,machine_id_sha256:Option<String>,#[serde(default)]guest:Option<crate::managed_guest::GuestBinding>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant{operation:String,request_sha256:String}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {version:u8,profile:String,target:BoundTarget,release_id:String,manifest_sha256:String,
 network_id:String,chain_id:u64,node_name:String,sequence:u64,expires_at:u64,
 artifacts:BTreeMap<String,String>,requests:Vec<Grant>,genesis_pins:Option<BTreeMap<String,String>>}
const GATEWAY_PUBLIC_INPUTS:&[&str]=&["formation-context.json","commissioning/network/genesis.json","commissioning/network/authority.json","commissioning/network/authority-root.pub","commissioning/network/network-manifest.json","commissioning/network/transport-registry.json","commissioning/network/transport-root.pub"];
const NETWORK_PROFILE: &str = "network-provisioning.json";
fn initial_gateway_profile(d:&Document)->Result<(),String>{
 if d.requests.iter().any(|r|r.operation=="gateway_install"||r.operation.starts_with("gateway_target_")){
  if d.requests.len()!=1||d.requests[0].operation!="gateway_install"||d.chain_id==0||!node_controller::validator_network_id(&d.network_id)
   ||d.artifacts.len()!=GATEWAY_PUBLIC_INPUTS.len()+usize::from(d.artifacts.contains_key(NETWORK_PROFILE))
   ||GATEWAY_PUBLIC_INPUTS.iter().any(|name|!d.artifacts.get(*name).is_some_and(|value|pin(value)))
   ||!d.genesis_pins.as_ref().is_some_and(|pins|pins.len()==3&&["genesis.json","authority.json","authority-root.pub"].iter().all(|name|pins.get(*name)==d.artifacts.get(&format!("commissioning/network/{name}")))){
   return Err("Initial gateway authorization requires one exact install and only the existing public formation plus six pinned signed-origin files".into())
  }
 }Ok(())
}
pub(super) fn require_gateway_initial(doc:&Value)->Result<(),String>{
 let d:Document=serde_json::from_value(doc.clone()).map_err(|_|"Unsupported gateway initial authorization")?;
 if !d.requests.iter().any(|r|r.operation=="gateway_install"){return Err("Gateway target operations require their own independently approved initial installation".into())}
 initial_gateway_profile(&d)
}
pub struct Prepared {wire:Zeroizing<Vec<u8>>,pub summary:Value,pub host_key:Option<String>,pub sha256:String,pub(super) document:String,pub(super) continuation:Option<(String,String,String)>,pub(super) runtime_profile_sha256:Option<String>}
fn digest(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn pin(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn limit(name:&str)->Option<usize>{match name{
 NETWORK_PROFILE=>Some(16384),
 "gateway-purpose.json"=>Some(16384),
 "managed-guest.json"=>Some(16384),"commissioning-readiness.json"=>Some(128*1024),"formation-context.json"=>Some(4096),"vpn-ca.pem"=>Some(128*1024),"vpn-provider.json"=>Some(16384),"vpn-server-binding.json"=>Some(16384),"vpn-retirement.json"=>Some(16384),"vpn-unused-cancellation.json"=>Some(16384),"vpn-enrollment.json"=>Some(16384),
 "commissioning/config/node.json"=>Some(1024*1024),"commissioning/config/start-authorized.json"=>Some(65536),
 "commissioning/network/genesis.json"=>Some(4*1024*1024),"commissioning/network/authority.json"|
 "commissioning/network/network-manifest.json"|"commissioning/network/transport-registry.json"=>Some(1024*1024),
 "commissioning/network/authority-root.pub"|"commissioning/network/transport-root.pub"=>Some(8192),_=>None}}
fn read(path:&Path,max:usize)->Result<Zeroizing<Vec<u8>>,String>{
 use std::io::Read;
 for ancestor in path.parent().ok_or("Authorization input has no parent")?.ancestors(){
  if !std::fs::symlink_metadata(ancestor).is_ok_and(|m|m.is_dir()){return Err("Authorization input ancestry contains a link".into());}
 }
 let m=path.symlink_metadata().map_err(|_|"Authorization input unavailable")?;
 if !m.is_file()||m.len()==0||m.len()>max as u64{return Err("Authorization input is not a bounded regular file".into());}
 #[cfg(unix)] {use std::os::unix::fs::MetadataExt;if m.nlink()!=1{return Err("Hard-linked authorization input refused".into());}
  if path.file_name().is_some_and(|n|n=="vpn-enrollment.json")&&(m.mode()&0o077!=0){return Err("One-use VPN input must be private mode0600".into());}}
 let mut bytes=Zeroizing::new(Vec::new());std::fs::File::open(path).map_err(|_|"Authorization input unavailable")?
  .take(max as u64+1).read_to_end(&mut bytes).map_err(|_|"Cannot read authorization input")?;
 if bytes.len()>max{return Err("Authorization input exceeds bound".into());}Ok(bytes)
}
fn validate(raw:&str,target:&Target,expected:&str,now:u64)->Result<Document,String>{
 target.validate()?;
 if raw.len()>65536||!pin(expected)||digest(raw.as_bytes())!=expected{return Err("Authorization differs from independent native build approval".into());}
 let d:Document=serde_json::from_str(raw).map_err(|_|"Unsupported exact authorization schema")?;
 if d.version!=1||d.profile!=PROFILE||d.sequence==0||d.sequence>=1u64<<53||d.expires_at<=now||d.expires_at>now.saturating_add(3600)
  ||d.target.kind!=target.kind||d.target.host.as_ref().map(|s|s.to_ascii_lowercase())!=target.host.as_ref().map(|s|s.to_ascii_lowercase())
  ||d.target.port!=if target.kind=="remote"{Some(target.port.unwrap_or(22))}else{None}||d.target.root!=target.root||d.target.guest!=target.guest {
  return Err("Authorization target, scope or expiry differs".into());
 }
 if target.kind=="remote"{
  if d.target.machine_id_sha256.is_some(){return Err("Remote identity must use the independently pinned host key".into());}
  let host=target.host.as_ref().unwrap().trim_matches(['[',']']);let port=target.port.unwrap_or(22);
  let host=if port==22{host.to_string()}else{format!("[{host}]:{port}")};
  let parts:Vec<_>=d.target.host_key.as_deref().unwrap_or("").split_whitespace().collect();
  if parts.len()!=3||parts[0]!=host||parts[1]!="ssh-ed25519"||STANDARD.decode(parts[2]).ok().is_none_or(|key|key.len()!=51||!key.starts_with(b"\0\0\0\x0bssh-ed25519\0\0\0\x20")){return Err("Exact independently approved administrative SSH host key required".into());}
 }else if d.target.host_key.is_some()||!d.target.machine_id_sha256.as_deref().is_some_and(pin){return Err("Exact local machine identity required".into());}
 Request{version:1,operation:"install_preflight".into(),parameters:json!({"release_id":d.release_id,"manifest_sha256":d.manifest_sha256,"network_id":d.network_id,"chain_id":d.chain_id,"node_name":d.node_name})}.validate()?;
 if d.artifacts.len()>10||d.artifacts.iter().any(|(n,p)|limit(n).is_none()||!pin(p))||d.requests.is_empty()||d.requests.len()>16{return Err("Authorization inputs or requests exceed exact fixed scope".into());}
 let mut requests=std::collections::BTreeSet::new();
 for r in &d.requests{if !matches!(r.operation.as_str(),"install"|"commission"|"register"|"vpn_enroll"|"vpn_bind"|"vpn_retire"|"vpn_cancel_unused"|"vpn_stop"|"vpn_resume"|"boot_policy"|"gateway_admission_prepare"|"gateway_admission_sign"|"gateway_install"|"gateway_target_generate"|"gateway_target_commission"|"start"|"stop"|"restart"|"upgrade"|"uninstall"|"identity_generate"|"network_formation_prepare"|"network_formation_sign"|"network_transport_prepare"|"network_transport_sign"|"treasury_prepare"|"treasury_send_prepare"|"treasury_send_submit"|"guest_create"|"guest_stop"|"guest_resume"|"guest_remove"|"formation_prepare"|"genesis_stage"|"genesis_bind")||!pin(&r.request_sha256)||!requests.insert(&r.request_sha256){return Err("Only unique exact supported mutation digests may be authorized".into());}}
 if d.genesis_pins.as_ref().is_some_and(|p|p.len()!=3||!["genesis.json","authority.json","authority-root.pub"].iter().all(|n|p.get(*n).is_some_and(|s|pin(s)))){return Err("Exact independently approved Genesis pins required".into());}
 Ok(d)
}
pub fn prepare(path:&Path,target:&Target,selected_profile:Option<&Value>,control:&Path,repair_installed_gateway:bool)->Result<Prepared,String>{
 if !cfg!(debug_assertions){return Err("Operator authorization is unavailable in production builds".into());}
 let bytes=read(path,65536)?;let expected=digest(&bytes);
 let runtime = !initial_pin_allowed(&expected);
 if runtime && selected_profile.is_none() {
  return Err("An independently approved engineering authorization or selected gateway profile is required".into());
 }
 let when=if repair_installed_gateway {
  if !runtime||selected_profile.is_none(){return Err("Repair requires the original managed gateway profile".into())}
  let original:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid original gateway authorization")?;
  // Repair verifies the already consumed scope. It cannot stage or renew a grant.
  original["expires_at"].as_u64().and_then(|v|v.checked_sub(1)).ok_or("Invalid original gateway expiry")?
 }else{
  SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs()
 };
 let mut prepared = prepare_pinned(path,target,&expected,when)?;
 let doc: Value = serde_json::from_str(&prepared.document).map_err(|_|"Invalid exact authorization")?;
 if let Some(selected) = selected_profile {
  require_gateway_initial(&doc)?;
  let expected = doc["artifacts"][NETWORK_PROFILE].as_str().filter(|value| pin(value))
   .ok_or("The authorization must bind a managed network profile")?;
  let profile = read(&path.parent().ok_or("The authorization needs a parent folder")?.join(NETWORK_PROFILE), 16384)?;
  let profile_data: Value = serde_json::from_slice(&profile).map_err(|_|"Invalid managed network profile")?;
  if digest(&profile) != expected || &profile_data != selected
   || !["network_id","chain_id","node_name"].iter().all(|key| profile_data[*key] == doc[*key])
   || profile_data["role"] != "rpc_gateway" {
   return Err("The selected profile differs from the exact authorized gateway profile".into());
  }
  prepared.summary["network_profile_sha256"] = json!(expected);
  prepared.summary["genesis_hash"] = profile_data["genesis_hash"].clone();
  prepared.summary["network_authority_sha256"] = profile_data["origin"]["authority-root.pub"].clone();
  prepared.summary["public_hostname"] = profile_data["gateway"]["public_hostname"].clone();
  if runtime {
   crate::gateway_vpn::profile_pins(&profile_data)?;
   for field in ["vpn_provider_sha256", "vpn_credential_locator_sha256"] {
    prepared.summary[field] = profile_data["gateway"][field].clone();
   }
   let release = doc["release_id"].as_str().ok_or("Missing independently approved gateway release")?;
   let package = doc["manifest_sha256"].as_str().ok_or("Missing independently approved package digest")?;
   if target.kind!="remote" || target.guest.is_some() || doc["sequence"]!=1
    || !node_bootstrap::matches_builtin_release(release,package) {
    return Err("Profile approval requires a fresh physical target and independently authenticated gateway release".into());
   }
   let known_host = node_controller::bootstrap_host_pin(target,control)?;
   let known_host = read(&known_host,2048)?;
   if std::str::from_utf8(&known_host).map_err(|_|"Invalid independent SSH host pin")?.trim()
    != prepared.host_key.as_deref().ok_or("The profile authorization lacks its bound host identity")? {
    return Err("Gateway profile authorization differs from the independently pinned host".into());
   }
   verify_runtime_initial(&prepared.document,target,&prepared.sha256,expected)?;
   prepared.runtime_profile_sha256 = Some(expected.to_string());
  }
 } else if doc["artifacts"].get(NETWORK_PROFILE).is_some() {
  return Err("Select the managed network profile before reviewing this authorization".into());
 }
 Ok(prepared)
}
fn prepare_pinned(path:&Path,target:&Target,expected:&str,now:u64)->Result<Prepared,String>{
 let raw=read(path,65536)?;let text=std::str::from_utf8(&raw).map_err(|_|"Authorization must be exact UTF8 JSON")?;
 let d=validate(text,target,expected,now)?;
 initial_gateway_profile(&d)?;
 if target.kind=="local"{let machine=read(Path::new("/etc/machine-id"),128)?;if Some(digest(&machine))!=d.target.machine_id_sha256{return Err("Local machine identity differs from the approved document".into());}}
 let mut artifacts=BTreeMap::new();
 for (name,pin) in &d.artifacts{let bytes=read(&path.parent().unwrap().join(name),limit(name).unwrap())?;if digest(&bytes)!=*pin{return Err("Selected authorization artifact digest differs".into());}artifacts.insert(name.clone(),Zeroizing::new(STANDARD.encode(&bytes)));}
 // Keep secret-bearing one-use VPN payload out of renderer responses and logs.
 let values:BTreeMap<_,_>=artifacts.iter().map(|(n,v)|(n,v.as_str())).collect();
 #[derive(Serialize)]struct Wire<'a>{authorization:&'a str,artifacts:BTreeMap<&'a String,&'a str>}
 let wire=Zeroizing::new(serde_json::to_vec(&Wire{authorization:text,artifacts:values}).map_err(|_|"Cannot encode authorization")?);
 if wire.len()>12*1024*1024{return Err("Authorization transfer exceeds bound".into());}
 Ok(Prepared{wire,document:text.into(),continuation:None,host_key:d.target.host_key,sha256:expected.into(),runtime_profile_sha256:None,summary:json!({"sha256":expected,"sequence":d.sequence,"expires_at":d.expires_at,"release_id":d.release_id,"manifest_sha256":d.manifest_sha256,"network_id":d.network_id,"chain_id":d.chain_id.to_string(),"node_name":d.node_name,"artifact_count":d.artifacts.len(),"requests":d.requests.iter().map(|r|json!({"operation":r.operation,"request_sha256":r.request_sha256})).collect::<Vec<_>>()})})
}
pub async fn execute(target:Target,operator:String,prepared:Prepared,control:&Path)->Result<Value,String>{
 execute_scope(target,operator,prepared,control,"--stage-engineering-authorization").await
}

pub(super) async fn prepare_existing_gateway_stage(target:Target,operator:String,prepared:Prepared,control:&Path)->Result<Value,String>{
 if prepared.runtime_profile_sha256.is_none() || prepared.continuation.is_some() || target.kind!="remote" || target.guest.is_some() {
  return Err("Only the original reviewed remote gateway profile can prepare its existing staging".into());
 }
 execute_scope(target,operator,prepared,control,"--prepare-existing-gateway-stage").await
}

pub(super) async fn repair_installed_gateway_controller(target:Target,operator:String,prepared:Prepared,control:&Path)->Result<Value,String>{
 if prepared.runtime_profile_sha256.is_none() || prepared.continuation.is_some() || target.kind!="remote" || target.guest.is_some() {
  return Err("The installed gateway controller requires its original reviewed remote profile".into());
 }
 execute_scope(target,operator,prepared,control,"--repair-installed-gateway-controller").await
}

async fn execute_scope(target:Target,operator:String,mut prepared:Prepared,control:&Path,action:&str)->Result<Value,String>{
 target.validate()?;node_bootstrap::validate_operator(&operator)?;
 let _serial=node_controller::SERIAL.lock().await;
 // Retire only this app-owned prior channel before applying the exact new pin.
 node_controller::close_connection_checked(&target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(&target,control,&operator).await?;
 let pin_path=control.join(format!("authorization-{}.known-hosts",prepared.sha256));
 if let Some(host_key)=&prepared.host_key{
  node_controller::protect_control_directory(control)?;
  let expected=format!("{host_key}\n");
  if pin_path.exists()||pin_path.is_symlink(){if read(&pin_path,2048)?.as_slice()!=expected.as_bytes(){return Err("Existing authorization host pin differs".into());}}
  else{use std::io::Write;let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}options.open(&pin_path).and_then(|mut f|{f.write_all(expected.as_bytes())?;f.sync_all()}).map_err(|_|"Cannot protect authorization host pin")?;}
 }
 let continuation=prepared.continuation.as_ref().map(|(initial,parent,formation)|format!("NATIVE_AUTHENTICATED_AUTHORIZATION_INITIAL_SHA256=\"{initial}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_PARENT_SHA256=\"{parent}\"\nNATIVE_AUTHENTICATED_AUTHORIZATION_FORMATION_SHA256=\"{formation}\"\n")).unwrap_or_default();
 let replacement=if action=="--repair-installed-gateway-controller" {
  let mut wire:Value=serde_json::from_slice(&prepared.wire).map_err(|_|"Invalid reviewed gateway scope")?;
  wire.as_object_mut().ok_or("Invalid reviewed gateway scope")?.insert("gateway_controller_source".into(),json!(GATEWAY_CONTROLLER));
  prepared.wire=Zeroizing::new(serde_json::to_vec(&wire).map_err(|_|"Cannot encode the verified controller recovery scope")?);
  if prepared.wire.len()>12*1024*1024{return Err("Gateway controller recovery exceeds its transfer bound".into())}
  format!("NATIVE_AUTHENTICATED_GATEWAY_CONTROLLER_SHA256=\"{}\"\n",digest(GATEWAY_CONTROLLER.as_bytes()))
 }else{String::new()};
 let script=format!("NATIVE_AUTHENTICATED_AUTHORIZATION_SHA256=\"{}\"\n{continuation}{replacement}{BOOTSTRAP}",prepared.sha256);
 let script=node_bootstrap::bootstrap_script(&script)?;
 let mut c=if target.kind=="local"{
  if !cfg!(all(target_os="linux",target_arch="x86_64")){return Err("Local authorization requires Linux x86_64".into());}
  let mut c=tokio::process::Command::new("/usr/bin/sudo");c.args(["-n","/usr/bin/python3","-I","-B","-c",&script,action]);c
 }else{
  let quote=script.replace('\'',"'\\''");node_controller::remote_command(&target,control,&operator,&format!("/usr/bin/sudo -n /usr/bin/python3 -I -B -c '{quote}' {action}"),Some(&pin_path))?
 };
 c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=c.spawn().map_err(|_|"Cannot start authenticated authorization transport")?;
 let mut input=child.stdin.take().ok_or("Authorization input unavailable")?;let output=child.stdout.take().ok_or("Authorization output unavailable")?;
 let result=tokio::time::timeout(Duration::from_secs(120),async{
  let send=async{input.write_all(&prepared.wire).await.map_err(|_|"Authorization transport interrupted")?;drop(input);Ok::<_,&str>(())};
  let receive=async{let mut bytes=Vec::new();output.take(65537).read_to_end(&mut bytes).await.map_err(|_|"Authorization response unavailable")?;if bytes.len()>65536{return Err("Authorization response exceeds bound");}Ok(bytes)};
  let (_,bytes)=tokio::try_join!(send,receive)?;
  let status=child.wait().await.map_err(|_|"Authorization process outcome unknown")?;if !status.success(){return Err("Authorization transport failed; inspect target before any further operation");}
  let reply:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid authorization response")?;
  if reply["version"]!=1||!reply["ok"].is_boolean(){return Err("Unsupported authorization response");}
  Ok(reply)
 }).await;
 node_controller::close_connection_checked(&target,control,"synergy-nodenetwork").await?;
 node_controller::close_connection_checked(&target,control,&operator).await?;
 // No automatic replay, even after timeout or partial upload.
 match result{Ok(value)=>value.map_err(String::from),Err(_)=>Err("Authorization outcome uncertain; use read-only target reconciliation, do not resend".into())}
}

fn approved_initial(candidate:&str,single:Option<&str>,set:Option<&str>,debug:bool)->bool{
 let mut values=std::collections::BTreeSet::new();
 if let Some(set)=set{for p in set.split(','){if !pin(p)||!values.insert(p){return false}}}
 if let Some(single)=single{if !pin(single)||(set.is_some()&&!values.contains(single)){return false}values.insert(single);}
 // Six independently pinned engineering documents permit five retained
 // validator origins plus a gateway; this is not a consensus roster bound.
 debug&&!values.is_empty()&&values.len()<=6&&values.contains(candidate)
}
pub(super) fn initial_pin_allowed(candidate:&str)->bool{
 approved_initial(candidate,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256"),option_env!("SYNERGY_NODENETWORK_QUALIFICATION_AUTHORIZATION_SHA256S"),cfg!(debug_assertions))
}
pub(super) fn verify_initial(raw:&str,target:&Target)->Result<Value,String>{
 let hash=digest(raw.as_bytes());if !initial_pin_allowed(&hash){return Err("Initial document is not approved by this isolated native build".into())}
 let v:Value=serde_json::from_str(raw).map_err(|_|"Invalid initial document")?;
 // Expiry limits the original one-use grants. Explicitly confirmed continuations
 // have their own short expiry; the immutable host/formation pin is retained.
 let when=v["expires_at"].as_u64().and_then(|n|n.checked_sub(1)).ok_or("Invalid initial expiry")?;
 initial_gateway_profile(&validate(raw,target,&hash,when)?)?;Ok(v)
}

pub(super) fn verify_runtime_initial(raw:&str,target:&Target,approved:&str,profile:&str)->Result<Value,String>{
 if !cfg!(debug_assertions)||target.kind!="remote"||target.guest.is_some()||!pin(profile) {
  return Err("Unsupported native gateway profile authorization".into());
 }
 let value:Value=serde_json::from_str(raw).map_err(|_|"Invalid runtime gateway authorization")?;
 let when=value["expires_at"].as_u64().and_then(|n|n.checked_sub(1)).ok_or("Invalid initial expiry")?;
 let doc=validate(raw,target,approved,when)?;
 initial_gateway_profile(&doc)?;
 let parameters=json!({"release_id":doc.release_id,"manifest_sha256":doc.manifest_sha256,
  "network_id":doc.network_id,"chain_id":doc.chain_id,"node_name":doc.node_name});
 let install=Request{version:1,operation:"gateway_install".into(),parameters};
 if doc.sequence!=1 || doc.requests.len()!=1 || doc.requests[0].operation!="gateway_install"
  || doc.requests[0].request_sha256!=install.approval_id()
  || doc.artifacts.get(NETWORK_PROFILE).map(String::as_str)!=Some(profile) {
  return Err("Native profile approval must bind exactly one initial gateway installation".into());
 }
 Ok(value)
}
pub(super) enum ContinuationOrigin<'a> {
    Compiled(&'a str),
    GatewayProfile {
        document: &'a str,
        authorization_sha256: &'a str,
        profile_sha256: &'a str,
    },
}

impl ContinuationOrigin<'_> {
    fn authorized_pin(&self, target: &Target, next: &Value, formation: &str) -> Result<String, String> {
        match *self {
            Self::Compiled(pin) if initial_pin_allowed(pin) => Ok(pin.into()),
            Self::Compiled(_) => Err("Unapproved continuation origin".into()),
            Self::GatewayProfile { document, authorization_sha256, profile_sha256 } => {
                let initial = verify_runtime_initial(document, target, authorization_sha256, profile_sha256)?;
                let operation = next["requests"][0]["operation"].as_str().unwrap_or("");
                if initial["target"] != next["target"]
                    || ["network_id", "chain_id", "node_name", "genesis_pins"].iter()
                        .any(|key| initial[*key] != next[*key])
                    || initial["artifacts"]["formation-context.json"] != formation
                    || next["sequence"].as_u64().is_none_or(|sequence| sequence <= 1)
                    || !matches!(operation,
                        "gateway_target_generate" | "gateway_target_commission"
                        | "vpn_enroll" | "vpn_bind" | "vpn_retire" | "vpn_cancel_unused"
                        | "vpn_stop" | "vpn_resume" | "register" | "start" | "stop"
                        | "restart" | "boot_policy" | "upgrade" | "uninstall")
                {
                    return Err("Continuation differs from the approved gateway target, origin, or lifecycle".into());
                }
                Ok(authorization_sha256.into())
            }
        }
    }
}

pub(super) fn continuation(
    doc: Value, target: &Target, origin: ContinuationOrigin<'_>, parent: &str, formation: &str,
) -> Result<Prepared, String> {
    if !pin(parent) || !pin(formation) {
        return Err("Unapproved continuation parent or formation".into());
    }
    let text = doc.to_string();
    let hash = digest(text.as_bytes());
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?.as_secs();
    let d = validate(&text, target, &hash, now)?;
    if !d.artifacts.is_empty() || d.requests.len() != 1 {
        return Err("Continuation may authorize one exact request, with no arbitrary file input".into());
    }
    let initial = origin.authorized_pin(target, &doc, formation)?;
    let wire = Zeroizing::new(serde_json::to_vec(&json!({"authorization":text, "artifacts":{}}))
        .map_err(|_| "Cannot encode continuation")?);
    Ok(Prepared {
        wire, document: text, host_key: d.target.host_key, sha256: hash.clone(),
        continuation: Some((initial, parent.into(), formation.into())), runtime_profile_sha256: None,
        summary: json!({"sha256":hash, "sequence":d.sequence, "expires_at":d.expires_at}),
    })
}

/// One separately reviewed, public additional-purpose approval. This never extracts custody.
pub(super) fn gateway_continuation(mut doc:Value,target:&Target,initial:&str,parent:&str,formation:&str,request:&Request)->Result<Prepared,String>{
 if request.operation!="gateway_admission_prepare"||request.validate()!=Ok(true)||doc["requests"]!=json!([{"operation":request.operation,"request_sha256":request.approval_id()}]){return Err("Gateway purpose may accompany only its exact admission preparation".into())}
 let raw=crate::gateway_admission::purpose(request)?;
 let mut prepared=continuation(doc.clone(),target,ContinuationOrigin::Compiled(initial),parent,formation)?;
 doc["artifacts"]=json!({"gateway-purpose.json":digest(raw.as_bytes())});
 let text=doc.to_string();let hash=digest(text.as_bytes());
 validate(&text,target,&hash,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 prepared.wire=Zeroizing::new(serde_json::to_vec(&json!({"authorization":text,"artifacts":{"gateway-purpose.json":STANDARD.encode(raw.as_bytes())}})).map_err(|_|"Cannot encode exact public gateway approval")?);
 prepared.document=text;prepared.sha256=hash.clone();prepared.summary=json!({"sha256":hash,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}

/// Only the native provider workflow may attach an exact private enrollment or
/// independently verified public binding. Generic continuations stay input-free.
pub(super) struct NativeVpnArtifact<'a>{pub name:&'a str,pub bytes:&'a [u8],pub ca:Option<&'a [u8]>,pub provider:Option<&'a [u8]>}
pub(super) fn vpn_continuation(mut doc:Value,target:&Target,origin:ContinuationOrigin<'_>,parent:&str,formation:&str,artifact:NativeVpnArtifact<'_>)->Result<Prepared,String>{
 let NativeVpnArtifact{name,bytes,ca,provider}=artifact;
 if !matches!(name,"vpn-enrollment.json"|"vpn-server-binding.json"|"vpn-retirement.json"|"vpn-unused-cancellation.json")||bytes.is_empty()||bytes.len()>16384{return Err("Invalid native VPN continuation input".into())}
 let operation=if name=="vpn-enrollment.json"{"vpn_enroll"}else if name=="vpn-server-binding.json"{"vpn_bind"}else if name=="vpn-unused-cancellation.json"{"vpn_cancel_unused"}else{"vpn_retire"};
 if doc["requests"][0]["operation"]!=operation{return Err("VPN artifact and exact request differ".into())}
 let mut prepared=continuation(doc.clone(),target,origin,parent,formation)?;
 doc["artifacts"]=json!({name:digest(bytes)});
 if ca.is_some()!=provider.is_some(){return Err("Exact provider approval must accompany its CA".into())}
 if let Some(provider)=provider{if provider.is_empty()||provider.len()>16384{return Err("Invalid provider approval bound".into())}doc["artifacts"]["vpn-provider.json"]=json!(digest(provider));}
 if let Some(ca)=ca{if name!="vpn-enrollment.json"||ca.is_empty()||ca.len()>128*1024{return Err("CA may accompany only the exact private native enrollment".into())}doc["artifacts"]["vpn-ca.pem"]=json!(digest(ca));}
 let text=doc.to_string();let hash=digest(text.as_bytes());
 validate(&text,target,&hash,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 let encoded=Zeroizing::new(STANDARD.encode(bytes));
 #[derive(Serialize)]struct PrivateWire<'a>{authorization:&'a str,artifacts:BTreeMap<&'a str,&'a str>}
 let ca_encoded=ca.map(|b|STANDARD.encode(b));let mut artifacts=BTreeMap::from([(name,encoded.as_str())]);if let Some(ca)=ca_encoded.as_deref(){artifacts.insert("vpn-ca.pem",ca);}
 let provider_encoded=provider.map(|b|STANDARD.encode(b));if let Some(provider)=provider_encoded.as_deref(){artifacts.insert("vpn-provider.json",provider);}
 prepared.wire=Zeroizing::new(serde_json::to_vec(&PrivateWire{authorization:&text,artifacts}).map_err(|_|"Cannot encode native VPN authorization")?);
 prepared.document=text;prepared.sha256=hash.clone();prepared.summary=json!({"sha256":hash,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}


pub(super) struct NativeGuestArtifact<'a>{pub bytes:&'a [u8],pub request:&'a Request}
pub(super) fn guest_continuation(mut doc:Value,target:&Target,initial:&str,parent:&str,formation:&str,artifact:NativeGuestArtifact<'_>)->Result<Prepared,String>{
 if target.guest.is_some()||artifact.bytes.is_empty()||artifact.bytes.len()>16384||artifact.request.operation!="guest_create"||artifact.request.validate()!=Ok(true)||doc["requests"][0]["request_sha256"]!=artifact.request.approval_id()||doc["requests"][0]["operation"]!="guest_create"{return Err("Managed guest artifact must authorize only its exact creation request on the physical host".into())}
 let value:Value=serde_json::from_slice(artifact.bytes).map_err(|_|"Malformed public managed guest policy")?;
 for key in ["guest_id","image_sha256","cpu_count","memory_mib","disk_gib"]{if value[key]!=artifact.request.parameters[key]{return Err("Guest policy and exact request differ".into())}}
 let mut prepared=continuation(doc.clone(),target,ContinuationOrigin::Compiled(initial),parent,formation)?;
 doc["artifacts"]=json!({"managed-guest.json":digest(artifact.bytes)});let text=doc.to_string();let hash=digest(text.as_bytes());
 validate(&text,target,&hash,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 prepared.wire=Zeroizing::new(serde_json::to_vec(&json!({"authorization":text,"artifacts":{"managed-guest.json":STANDARD.encode(artifact.bytes)}})).map_err(|_|"Cannot encode exact guest policy")?);
 prepared.document=text;prepared.sha256=hash.clone();prepared.summary=json!({"sha256":hash,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}

pub(super) fn readiness_continuation(mut doc:Value,target:&Target,initial:&str,parent:&str,formation:&str,bytes:&[u8])->Result<Prepared,String>{
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
 if bytes.is_empty()||bytes.len()>128*1024||doc["requests"].as_array().is_none_or(|v|v.len()!=1)||doc["requests"][0]["operation"]!="commission"||doc["requests"][0]["request_sha256"]!=request.approval_id(){return Err("Readiness may accompany only one exact commissioning request".into())}
 let mut prepared=continuation(doc.clone(),target,ContinuationOrigin::Compiled(initial),parent,formation)?;
 doc["artifacts"]=json!({"commissioning-readiness.json":digest(bytes)});let text=doc.to_string();let hash=digest(text.as_bytes());validate(&text,target,&hash,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 prepared.wire=Zeroizing::new(serde_json::to_vec(&json!({"authorization":text,"artifacts":{"commissioning-readiness.json":STANDARD.encode(bytes)}})).map_err(|_|"Cannot encode exact readiness approval")?);
 prepared.document=text;prepared.sha256=hash.clone();prepared.summary=json!({"sha256":hash,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}

pub(super) fn transport_continuation(mut doc:Value,target:&Target,initial:&str,parent:&str,formation:&str,candidate:&crate::transport_staging::Candidate)->Result<Prepared,String>{
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
 if candidate.files.len()!=crate::transport_formation::ARTIFACTS.len()||doc["requests"]!=json!([{"operation":"commission","request_sha256":request.approval_id()}]){return Err("Public transport inputs require one exact commissioning grant".into())}
 let mut prepared=continuation(doc.clone(),target,ContinuationOrigin::Compiled(initial),parent,formation)?;
 let mut pins=serde_json::Map::new();let mut artifacts=serde_json::Map::new();let mut total=0usize;
 for name in crate::transport_formation::ARTIFACTS{
  let bytes=candidate.files.get(name).ok_or("Incomplete fixed transport input inventory")?;
  total=total.checked_add(bytes.len()).ok_or("Public inputs exceed bound")?;if bytes.is_empty()||total>4*1024*1024{return Err("Public inputs exceed bound".into())}
  pins.insert(format!("commissioning/{name}"),json!(digest(bytes)));artifacts.insert(format!("commissioning/{name}"),json!(STANDARD.encode(bytes)));
 }
 doc["artifacts"]=Value::Object(pins);let text=doc.to_string();let sha=digest(text.as_bytes());validate(&text,target,&sha,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 prepared.wire=Zeroizing::new(serde_json::to_vec(&json!({"authorization":text,"artifacts":artifacts})).map_err(|_|"Cannot encode exact public transport inputs")?);
 prepared.document=text;prepared.sha256=sha.clone();prepared.summary=json!({"sha256":sha,"sequence":doc["sequence"],"expires_at":doc["expires_at"]});Ok(prepared)
}

#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(Target,Value){let t=Target{kind:"remote".into(),host:Some("127.0.0.1".into()),port:Some(22281),root:"/opt/synergy".into(),guest:None};let d=json!({"version":1,"profile":PROFILE,"target":{"kind":t.kind,"host":t.host,"port":t.port,"root":t.root,"machine_id_sha256":null,"host_key":format!("[127.0.0.1]:22281 ssh-ed25519 {}",STANDARD.encode([b"\0\0\0\x0bssh-ed25519\0\0\0\x20".as_slice(),&[0u8;32]].concat()))},"release_id":"reviewed-master","manifest_sha256":"a".repeat(64),"network_id":"nodenetwork-formation-disposable-test","chain_id":99999,"node_name":"validator-test","sequence":1,"expires_at":1060,"artifacts":{},"requests":[{"operation":"stop","request_sha256":"c".repeat(64)}],"genesis_pins":null});(t,d)}
 #[test]fn gateway_initial_uses_only_existing_public_formation_and_six_signed_origin_inputs(){
  let(_,mut d)=fixture();d["network_id"]=json!("synergy-posy-canary-test");d["requests"]=json!([{"operation":"gateway_install","request_sha256":"a".repeat(64)}]);
  d["artifacts"]=json!(GATEWAY_PUBLIC_INPUTS.iter().map(|name|(*name,"a".repeat(64))).collect::<BTreeMap<_,_>>());
  d["genesis_pins"]=json!(["genesis.json","authority.json","authority-root.pub"].into_iter().map(|name|(name,"a".repeat(64))).collect::<BTreeMap<_,_>>());
  assert!(require_gateway_initial(&d).is_ok());
  for key in GATEWAY_PUBLIC_INPUTS{let mut bad=d.clone();bad["artifacts"].as_object_mut().unwrap().remove(*key);assert!(require_gateway_initial(&bad).is_err())}
  let mut private=d.clone();private["artifacts"]["keys/apqe/custody.unlock"]=json!("b".repeat(64));assert!(require_gateway_initial(&private).is_err());
  let mut drift=d.clone();drift["genesis_pins"]["authority-root.pub"]=json!("b".repeat(64));assert!(require_gateway_initial(&drift).is_err());
  let mut mixed=d;mixed["requests"].as_array_mut().unwrap().push(json!({"operation":"install","request_sha256":"c".repeat(64)}));assert!(require_gateway_initial(&mixed).is_err());
  let(_,validator)=fixture();assert!(initial_gateway_profile(&serde_json::from_value(validator.clone()).unwrap()).is_ok());assert!(require_gateway_initial(&validator).is_err());
 }
 #[test]
 fn runtime_gateway_approval_binds_selected_profile_and_exact_install() {
  let (target,mut doc)=fixture();
  doc["network_id"]=json!("private-observer-network");
  doc["chain_id"]=json!(14002);
  doc["node_name"]=json!("observer-2");
  let mut artifacts=GATEWAY_PUBLIC_INPUTS.iter()
   .map(|name|(*name,"a".repeat(64))).collect::<BTreeMap<_,_>>();
  let profile="b".repeat(64);
  artifacts.insert(NETWORK_PROFILE,profile.clone());
  doc["artifacts"]=json!(artifacts);
  doc["genesis_pins"]=json!(["genesis.json","authority.json","authority-root.pub"]
   .into_iter().map(|name|(name,"a".repeat(64))).collect::<BTreeMap<_,_>>());
  let install=Request{version:1,operation:"gateway_install".into(),
   parameters:json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],
    "network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]})};
  doc["requests"]=json!([{"operation":"gateway_install","request_sha256":install.approval_id()}]);
  let raw=doc.to_string();
  let approval=digest(raw.as_bytes());
  assert_eq!(verify_runtime_initial(&raw,&target,&approval,&profile).unwrap(),doc);
  assert!(verify_runtime_initial(&raw,&target,&approval,&"c".repeat(64)).is_err());
  let origin = || ContinuationOrigin::GatewayProfile {
      document: &raw, authorization_sha256: &approval, profile_sha256: &profile,
  };
  let parent = "d".repeat(64);
  let formation = "a".repeat(64);
  let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
  let next = |operation: &str, parameters: Value| {
      let request = Request {version: 1, operation: operation.into(), parameters};
      let mut next = doc.clone();
      next["sequence"] = json!(2);
      next["expires_at"] = json!(now + 300);
      next["artifacts"] = json!({});
      next["requests"] = json!([{"operation": operation, "request_sha256": request.approval_id()}]);
      next
  };
  let generated = next("gateway_target_generate", json!({"genesis_sha256": &formation}));
  let prepared = continuation(generated.clone(), &target, origin(), &parent, &formation).unwrap();
  assert_eq!(prepared.continuation, Some((approval.clone(), parent.clone(), formation.clone())));
  assert!(continuation(generated.clone(), &target, origin(), &parent, &"e".repeat(64)).is_err());
  let mut drifted = generated.clone();
  drifted["genesis_pins"]["authority-root.pub"] = json!("e".repeat(64));
  assert!(continuation(drifted, &target, origin(), &parent, &formation).is_err());
  let other = Target {port: Some(22284), ..target.clone()};
  assert!(continuation(generated, &other, origin(), &parent, &formation).is_err());

  let enrollment = vpn_continuation(next("vpn_enroll", json!({})), &target, origin(), &parent, &formation,
      NativeVpnArtifact {name: "vpn-enrollment.json", bytes: b"test-enrollment",
                         ca: Some(b"test-ca"), provider: Some(b"test-provider")}).unwrap();
  let vpn: Value = serde_json::from_str(&enrollment.document).unwrap();
  assert_eq!(vpn["artifacts"]["vpn-enrollment.json"], digest(b"test-enrollment"));
  assert_eq!(vpn["artifacts"]["vpn-provider.json"], digest(b"test-provider"));
  assert_eq!(enrollment.continuation.unwrap().0, approval);

  for operation in ["gateway_install", "install", "commission", "formation_prepare",
                    "network_transport_sign", "gateway_admission_sign", "treasury_send_submit", "guest_create"] {
      assert!(continuation(next(operation, json!({})), &target, origin(), &parent, &formation).is_err(), "{operation}");
  }
  doc["chain_id"]=json!(14003);
  let changed=doc.to_string();
  assert!(verify_runtime_initial(&changed,&target,&approval,&profile).is_err());
  assert!(verify_runtime_initial(&changed,&target,&digest(changed.as_bytes()),&profile).is_err());
 }
 #[test]fn guest_authorization_cannot_be_reused_for_host_or_another_creation(){
  let(mut t,mut d)=fixture();let bytes=[b"\0\0\0\x0bssh-ed25519\0\0\0\x20".as_slice(),&[7u8;32]].concat();
  let g=crate::managed_guest::GuestBinding{guest_id:"validator-guest".into(),create_request_sha256:"a".repeat(64),ssh_host_public_key:format!("ssh-ed25519 {}",STANDARD.encode(&bytes)),ssh_host_fingerprint:format!("SHA256:{}",STANDARD.encode(Sha256::digest(&bytes)).trim_end_matches('='))};
  t.guest=Some(g.clone());d["target"]["guest"]=serde_json::to_value(g).unwrap();let raw=d.to_string();let pin=digest(raw.as_bytes());assert!(validate(&raw,&t,&pin,1000).is_ok());
  let mut other=t.clone();other.guest=None;assert!(validate(&raw,&other,&pin,1000).is_err());other=t;other.guest.as_mut().unwrap().create_request_sha256="b".repeat(64);assert!(validate(&raw,&other,&pin,1000).is_err());
 }
 #[test]fn vpn_stop_continuation_requires_exact_native_authorization_scope(){
  let(t,mut d)=fixture();let request=Request{version:1,operation:"vpn_stop".into(),parameters:json!({})};
  d["requests"]=json!([{"operation":"vpn_stop","request_sha256":request.approval_id()}]);
  let raw=d.to_string();assert!(validate(&raw,&t,&digest(raw.as_bytes()),1000).is_ok());
  assert!(validate(&raw,&t,&"f".repeat(64),1000).is_err());
  let mut other=t.clone();other.port=Some(22282);assert!(validate(&raw,&other,&digest(raw.as_bytes()),1000).is_err());
 }
 #[test]fn initial_document_set_is_bounded_exact_and_debug_only(){let pins=(0..6).map(|i|format!("{i:064x}")).collect::<Vec<_>>();let six=pins.join(",");for pin in &pins{assert!(approved_initial(pin,None,Some(&six),true))}assert!(!approved_initial(&pins[0],None,Some(&six),false));assert!(!approved_initial(&"f".repeat(64),None,Some(&six),true));assert!(!approved_initial(&pins[0],None,Some(&format!("{six},{}","f".repeat(64))),true));assert!(!approved_initial(&pins[0],None,Some(&format!("{six},{}",pins[0])),true));assert!(!approved_initial(&pins[0],Some(&"e".repeat(64)),Some(&six),true));assert!(!approved_initial(&pins[0],None,Some(&format!("{six},")),true));}

 #[test]fn exact_native_pin_target_expiry_and_request_validation_precede_input_access(){let(t,d)=fixture();let raw=d.to_string();assert!(validate(&raw,&t,&digest(raw.as_bytes()),1000).is_ok());assert!(validate(&raw,&t,&"0".repeat(64),1000).is_err());let other=Target{port:Some(22282),..t.clone()};assert!(validate(&raw,&other,&digest(raw.as_bytes()),1000).is_err());assert!(validate(&raw,&t,&digest(raw.as_bytes()),1060).is_err());for (key,value)in[("artifacts",json!({"../../private-key":"b".repeat(64)})),("requests",json!([{"operation":"shell","request_sha256":"c".repeat(64)}])),("sequence",json!(0))]{let mut bad=d.clone();bad[key]=value;let bytes=bad.to_string();assert!(validate(&bytes,&t,&digest(bytes.as_bytes()),1000).is_err());}}
}
