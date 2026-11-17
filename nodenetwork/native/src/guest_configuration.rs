//! Public guest policy can reference only assets already authenticated in the master.
use crate::{commands,node_controller::{self,Target,Request}};
use serde::Deserialize;
use serde_json::{json,Value};
use std::{collections::BTreeMap,path::Path};
use sha2::{Digest,Sha256};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct Configuration{version:u8,guest_id:String,image_sha256:String,cpu_count:u64,memory_mib:u64,disk_gib:u64,tools:BTreeMap<String,String>,bios_sha256:String,ssh_forward_port:u16,operator_ssh_public_key:String,runtime_files:BTreeMap<String,String>}
fn pin(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn validate(bytes:&[u8],resources:&Value)->Result<Request,String>{
 if bytes.is_empty()||bytes.len()>16384{return Err("Public managed guest policy exceeds 16 KiB".into())}
 let c:Configuration=serde_json::from_slice(bytes).map_err(|_|"Unsupported exact managed-guest.json schema")?;
 if resources["schema"]!="nodenetwork-guest-resources-v1"||!resources["manifest_sha256"].as_str().is_some_and(pin)||!resources["resource_manifest_sha256"].as_str().is_some_and(pin)||!matches!(resources["archive_limit_bytes"].as_u64(),Some(536870912|1073741824))||c.version!=1||c.ssh_forward_port<1024||resources["operator_ssh_public_key"]!=c.operator_ssh_public_key||c.runtime_files.is_empty()||c.runtime_files.len()>128{return Err("Guest policy lacks the exact authenticated current master or operator identity".into())}
 let mut expected=BTreeMap::from([("hosted-machines/images/os.qcow2".to_owned(),c.image_sha256.clone()),("lib/guest-tools/bios.bin".to_owned(),c.bios_sha256)]);
 if c.tools.len()!=4{return Err("Four exact master-owned guest tools required".into())}
 for name in ["qemu-system-x86_64","qemu-img","ssh-keygen","genisoimage"]{expected.insert(format!("lib/guest-tools/bin/{name}"),c.tools.get(name).ok_or("Missing approved guest tool")?.clone());}
 if !c.runtime_files.contains_key("lib/guest-tools/bin/ld-linux-x86-64.so.2"){return Err("Contained guest loader required".into())}
 for (name,hash)in c.runtime_files{
  if name!="lib/guest-tools/bin/ld-linux-x86-64.so.2"&&!name.strip_prefix("lib/guest-tools/lib/").is_some_and(|base|!base.is_empty()&&base!="."&&base!=".."&&base.len()<=128&&base.bytes().all(|b|b.is_ascii_alphanumeric()||b"._+-".contains(&b))){return Err("Guest runtime path escapes its fixed namespace".into())}
  expected.insert(name,hash);
 }
 let actual:BTreeMap<String,String>=serde_json::from_value(resources["files"].clone()).map_err(|_|"Malformed authenticated guest resource inventory")?;
 if expected.values().any(|v|!pin(v))||expected!=actual{return Err("Guest image, tool, firmware or runtime pins differ from the authenticated master".into())}
 let request=Request{version:1,operation:"guest_create".into(),parameters:json!({"guest_id":c.guest_id,"image_sha256":c.image_sha256,"cpu_count":c.cpu_count,"memory_mib":c.memory_mib,"disk_gib":c.disk_gib})};request.validate()?;Ok(request)
}
fn read(path:&Path)->Result<Vec<u8>,String>{
 if path.file_name().and_then(|n|n.to_str())!=Some("managed-guest.json"){return Err("Select the fixed public managed-guest.json policy".into())}
 let m=std::fs::symlink_metadata(path).map_err(|_|"Public guest policy unavailable")?;
 if !m.is_file()||m.len()>16384{return Err("Public guest policy must be one bounded regular file".into())}
 use std::io::Read;let mut bytes=Vec::new();std::fs::File::open(path).map_err(|_|"Cannot open public guest policy")?.take(16385).read_to_end(&mut bytes).map_err(|_|"Cannot read public guest policy")?;Ok(bytes)
}
#[tauri::command]
pub async fn portal_nodenetwork_configure_guest(window:tauri::WebviewWindow,app:tauri::AppHandle,target:Target)->Result<Option<Value>,String>{
 commands::main_only(&window)?;target.validate()?;
 if !cfg!(debug_assertions)||target.guest.is_some(){return Err("Guest configuration requires the isolated engineering physical host workflow".into())}
 let control=node_controller::control_directory(&app.path().home_dir().map_err(|_|"Operator home unavailable")?)?;
 let response=commands::controller(&app,target.clone(),Request{version:1,operation:"guest_resources".into(),parameters:json!({})},&control).await?;
 if response["ok"]!=true{return Err("The installed master has no authenticated managed guest resources".into())}
 let resources=response["result"].clone();let view=window.clone();
 let chosen=tauri::async_runtime::spawn_blocking(move||{let Some(file)=view.dialog().file().set_parent(&view).set_title("Select public managed-guest.json for this hosting machine").add_filter("Public managed guest policy",&["json"]).blocking_pick_file()else{return Ok(None)};let path=file.into_path().map_err(|_|"Select a local public policy file")?;read(&path).map(Some)}).await.map_err(|_|"Guest policy selection interrupted")??;
 let Some(bytes)=chosen else{return Ok(None)};let request=validate(&bytes,&resources)?;
 let policy_hash=format!("{:x}",Sha256::digest(&bytes));
 let message=format!("ISOLATED ENGINEERING ONLY\nHosting machine: {}\nCurrent release: {}\nMaster SHA256: {}\nResource manifest SHA256: {}\nGuest selection: {}\nPolicy SHA256: {}\nExact one-use creation request: {}\n\nApprove this bounded public policy using ONLY the image, tools, loader and libraries already sealed in this master. The operator SSH public key must match original bootstrap. This stages one guest_create grant; it does not create/start a guest or approve validator membership. No binary upload or production approval is granted.",target.label(),resources["release_id"],resources["manifest_sha256"],resources["resource_manifest_sha256"],request.parameters,policy_hash,request.approval_id());
 let consent=tauri::async_runtime::spawn_blocking(move||window.dialog().message(message).parent(&window).title("Review exact master-owned guest configuration").buttons(MessageDialogButtons::OkCancelCustom("Approve exact guest policy once".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Guest policy review interrupted")?;
 if !consent{return Ok(None)}
 let base=app.path().app_local_data_dir().map_err(|_|"Portal state unavailable")?;
 crate::authorization_lifecycle::guest_grant(&base,&target,&request,&control,&bytes,&resources).await.map(Some)
}

#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(Value,Value){
  let pin="a".repeat(64);let mut files=BTreeMap::new();
  for path in ["hosted-machines/images/os.qcow2","lib/guest-tools/bios.bin","lib/guest-tools/bin/qemu-system-x86_64","lib/guest-tools/bin/qemu-img","lib/guest-tools/bin/ssh-keygen","lib/guest-tools/bin/genisoimage","lib/guest-tools/bin/ld-linux-x86-64.so.2","lib/guest-tools/lib/libc.so.6"]{files.insert(path.to_owned(),pin.clone());}
  let resources=json!({"schema":"nodenetwork-guest-resources-v1","release_id":"reviewed-master","manifest_sha256":pin,"resource_manifest_sha256":pin,"archive_limit_bytes":536870912,"operator_ssh_public_key":"approved-public-key","files":files});
  let c=json!({"version":1,"guest_id":"validator-guest","image_sha256":pin,"cpu_count":2,"memory_mib":2048,"disk_gib":16,"tools":{"qemu-system-x86_64":pin,"qemu-img":pin,"ssh-keygen":pin,"genisoimage":pin},"bios_sha256":pin,"ssh_forward_port":2222,"operator_ssh_public_key":"approved-public-key","runtime_files":{"lib/guest-tools/bin/ld-linux-x86-64.so.2":pin,"lib/guest-tools/lib/libc.so.6":pin}});(c,resources)
 }
 #[test]fn exact_master_guest_policy_produces_only_bounded_create_request(){
  let(c,r)=fixture();let request=validate(c.to_string().as_bytes(),&r).unwrap();assert_eq!(request.operation,"guest_create");assert_eq!(request.parameters,json!({"guest_id":"validator-guest","image_sha256":"a".repeat(64),"cpu_count":2,"memory_mib":2048,"disk_gib":16}));
  assert_eq!(Request{version:1,operation:"guest_resources".into(),parameters:json!({})}.validate(),Ok(false));
 }
 #[test]fn substituted_resources_operator_paths_or_extra_authority_are_rejected(){
  let(c,r)=fixture();
  for (key,value)in[("image_sha256",json!("b".repeat(64))),("operator_ssh_public_key",json!("another-key")),("shell",json!("command")),("cpu_count",json!(33)),("ssh_forward_port",json!(22))]{let mut bad=c.clone();bad[key]=value;assert!(validate(bad.to_string().as_bytes(),&r).is_err(),"{key}");}
  for path in ["lib/guest-tools/lib/../x","lib/guest-tools/lib/..","/usr/lib/libc.so.6"]{let mut bad=c.clone();bad["runtime_files"][path]=json!("a".repeat(64));let mut other=r.clone();other["files"][path]=json!("a".repeat(64));assert!(validate(bad.to_string().as_bytes(),&other).is_err());}
  let mut other=r.clone();other["files"]["lib/guest-tools/lib/libc.so.6"]=json!("b".repeat(64));assert!(validate(c.to_string().as_bytes(),&other).is_err());
  other=r.clone();other["archive_limit_bytes"]=json!(u64::MAX);assert!(validate(c.to_string().as_bytes(),&other).is_err());assert!(validate(&vec![b' ';16385],&r).is_err());
 }
}
