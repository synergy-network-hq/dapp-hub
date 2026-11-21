//! Debug-only explicit engineering continuations. No renderer policy or custody.
use crate::{node_controller::{self,Target,Request},operator_authorization as authorization};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeProfileApproval {
 authorization_sha256: String,
 profile_sha256: String,
}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct Initial {
 document: String,
 operator: String,
 #[serde(default, skip_serializing_if="Option::is_none")]
 profile_approval: Option<RuntimeProfileApproval>,
}
fn folder(base:&Path)->Result<PathBuf,String>{
 let path=base.join("nodenetwork-engineering-v1");
 if !path.exists(){#[cfg(unix)]{use std::os::unix::fs::DirBuilderExt;std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&path).map_err(|_|"Cannot protect engineering app state")?;}}
 for p in path.ancestors(){if !p.symlink_metadata().is_ok_and(|m|m.is_dir()){return Err("Unsafe engineering app state ancestry".into())}}
 #[cfg(unix)]{use std::os::unix::fs::MetadataExt;let m=path.metadata().map_err(|_|"Cannot inspect app state")?;let owner=base.metadata().map_err(|_|"Cannot inspect app owner")?.uid();if m.uid()!=owner||m.mode()&0o077!=0{return Err("Engineering app state must remain private and owned".into())}}
 Ok(path)
}
fn read(path:&Path,max:usize)->Result<Vec<u8>,String>{
 use std::io::Read;let m=path.symlink_metadata().map_err(|_|"Engineering receipt is unavailable")?;
 if !m.is_file()||m.len()>max as u64{return Err("Invalid engineering receipt file".into())}
 #[cfg(unix)]{use std::os::unix::fs::MetadataExt;if m.nlink()!=1||m.mode()&0o077!=0||m.uid()!=path.parent().ok_or("No receipt parent")?.metadata().map_err(|_|"Cannot inspect receipt owner")?.uid(){return Err("Unsafe engineering receipt ownership".into())}}
 let mut b=Vec::new();std::fs::File::open(path).and_then(|f|f.take(max as u64+1).read_to_end(&mut b)).map_err(|_|"Cannot read engineering receipt")?;if b.len()>max{return Err("Receipt exceeds bound".into())}Ok(b)
}
fn save(path:&Path,value:&Value)->Result<(),String>{
 use std::io::Write;let bytes=serde_json::to_vec(value).map_err(|_|"Cannot encode public receipt")?;
 if path.exists()||path.is_symlink(){if read(path,3*1024*1024)?==bytes{return Ok(())}return Err("Existing public receipt differs; preserve it for reconciliation".into())}
 let mut o=std::fs::OpenOptions::new();o.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;o.mode(0o600);}
 o.open(path).and_then(|mut f|{f.write_all(&bytes)?;f.sync_all()}).map_err(|_|"Public receipt write interrupted; reconcile without replay".to_string())
}
fn name(target:&Target)->String{format!("initial-{}.json",hash(target.journal_identity().to_string().as_bytes()))}
pub(super) fn verify_removal(target:&Target,reply:Value)->Result<Value,String>{
 if reply["ok"]==true&&(reply["version"]!=1||reply["result"]["removed_root"]!=target.root||reply["result"]["logical_removal_verified"]!=true||reply["result"]["backup_created"]!=false||reply["result"]["remaining_host_managed_records"]!=json!([])){return Err("Removal is partial or unverified; preserve the old incarnation and reconcile".into())}Ok(reply)
}
fn pointer(base:&Path,target:&Value)->PathBuf{base.join("nodenetwork-engineering-v1").join(format!("incarnation-{}.json",hash(target.to_string().as_bytes())))}
pub(super) fn incarnation(base:&Path,target:&Value)->Result<Option<String>,String>{
 let path=pointer(base,target);let pending=path.with_extension("pending");
 if path.parent().is_some_and(|p|p.exists()||p.is_symlink()){for p in path.parent().unwrap().ancestors(){if !p.symlink_metadata().is_ok_and(|m|m.is_dir()){return Err("Unsafe installation incarnation ancestry".into())}}}
 if pending.exists()||pending.is_symlink(){return Err("Installation incarnation transition interrupted; preserve it for reconciliation".into())}
 if !path.exists()&&!path.is_symlink(){return Ok(None)}
 let value:Value=serde_json::from_slice(&read(&path,4096)?).map_err(|_|"Malformed installation incarnation")?;
 let pin=value["initial_sha256"].as_str().filter(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).ok_or("Invalid installation incarnation")?;
 if value.as_object().is_none_or(|o|o.len()!=2)||value["target_sha256"]!=hash(target.to_string().as_bytes()){return Err("Installation incarnation target differs".into())}
 Ok(Some(pin.into()))
}
fn initial_path(base:&Path,target:&Target)->Result<PathBuf,String>{
 let directory=folder(base)?;Ok(if let Some(pin)=incarnation(base,&target.journal_identity())?{directory.join(format!("initial-{}-{pin}.json",hash(target.journal_identity().to_string().as_bytes())))}else{directory.join(name(target))})
}
fn initial(base:&Path,target:&Target)->Result<(Initial,Value),String>{
 let raw=read(&initial_path(base,target)?,100*1024)?;
 let record:Initial=serde_json::from_slice(&raw).map_err(|_|"Invalid initial native authorization receipt")?;
 let document=if let Some(approval)=&record.profile_approval {
  authorization::verify_runtime_initial(&record.document,target,&approval.authorization_sha256,&approval.profile_sha256)?
 }else{authorization::verify_initial(&record.document,target)?};
 crate::node_bootstrap::validate_operator(&record.operator)?;
 if incarnation(base,&target.journal_identity())?.is_some_and(|pin|pin!=hash(record.document.as_bytes())){return Err("Installation incarnation document differs".into())}Ok((record,document))
}
pub(super) fn reinstallation_host_pin(base:&Path,target:&Target,control:&Path)->Result<Option<PathBuf>,String>{
 if !initial_path(base,target)?.exists(){return Ok(None)}let(_,doc)=initial(base,target)?;host_pin(control,&doc)
}
fn reinstallation_ticket(base:&Path,target:&Target,old:&str)->Result<PathBuf,String>{Ok(folder(base)?.join(format!("reinstallation-{}-{old}.json",hash(target.journal_identity().to_string().as_bytes()))))}
fn same_host(old:&Value,new:&Value)->bool{old["target"]==new["target"]}
/// Called only after native bootstrap confirmation, before dispatch. The master
/// bootstrap independently rejects an existing root, services or foreign state.
pub(super) fn prepare_reinstallation(base:&Path,target:&Target,operator:&str,selection:&Value,request:&Value)->Result<Option<crate::request_journal::BootstrapRetry>,String>{
 if !initial_path(base,target)?.exists(){return Ok(None)}
 let(record,doc)=initial(base,target)?;
 if !cfg!(debug_assertions)||record.operator!=operator{return Err("Reinstallation must retain its independently approved administrative identity".into())}
 crate::vpn_enrollment::require_terminal(base,target,&doc)?;
 for prefix in ["continuation","vpn-continuation","guest-continuation","readiness-continuation","transport-continuation"]{
  let path=folder(base)?.join(format!("{prefix}-{}.json",hash(target.journal_identity().to_string().as_bytes())));
  if path.exists()||path.is_symlink(){return Err("Prior authorization mutation is uncertain; reconcile before reinstallation".into())}
 }
 let old=hash(record.document.as_bytes());let path=reinstallation_ticket(base,target,&old)?;
 if path.exists()||path.is_symlink(){
  let ticket:Value=serde_json::from_slice(&read(&path,4096)?).map_err(|_|"Malformed saved reinstall ticket")?;
  validate_retry_ticket(&ticket,&old,selection,request)?;
  if let Some(retry)=crate::request_journal::bootstrap_retry(base,&target.journal_identity(),request,&ticket["removal"])?{return Ok(Some(retry))}
 }
 crate::request_journal::with_latest_success(base,&target.journal_identity(),"uninstall",|terminal|save(&path,&json!({"old_initial_sha256":old,"selection":selection,"removal":terminal,"bootstrap_request_sha256":hash(request.to_string().as_bytes())})))?;
 Ok(None)
}
fn validate_retry_ticket(ticket:&Value,old:&str,selection:&Value,request:&Value)->Result<(),String>{
 if ticket.as_object().is_none_or(|m|m.len()!=4)||ticket["old_initial_sha256"]!=old||&ticket["selection"]!=selection||ticket["bootstrap_request_sha256"]!=hash(request.to_string().as_bytes()){
  return Err("Saved reinstall ticket differs from this incarnation, selection or exact bootstrap request".into())
 }Ok(())
}
fn replacement_allowed(old:&Value,new:&Value,ticket:&Value,boot:&Value,old_sha:&str)->Result<(),String>{
 if !same_host(old,new)||new["sequence"]!=1||!new["artifacts"]["formation-context.json"].as_str().is_some_and(|p|p.len()==64)||old["artifacts"]["formation-context.json"]==new["artifacts"]["formation-context.json"]{return Err("New installation requires a distinct approved formation, sequence1 and identical host identity".into())}
 if ticket.as_object().is_none_or(|o|o.len()!=4)||ticket["old_initial_sha256"]!=old_sha||ticket["bootstrap_request_sha256"]!=boot["request_sha256"]||!ticket["removal"]["id"].is_string()||["release_id","manifest_sha256","network_id","chain_id","node_name"].iter().any(|k|ticket["selection"][k]!=new[k]){return Err("New approval does not match the successful clean bootstrap".into())}Ok(())
}
pub(super) fn remember(base:&Path,target:&Target,operator:&str,p:&authorization::Prepared)->Result<(),String>{
 let profile_approval=p.runtime_profile_sha256.as_ref().map(|profile|RuntimeProfileApproval{
  authorization_sha256:p.sha256.clone(),profile_sha256:profile.clone(),
 });
 let new=if let Some(approval)=&profile_approval {
  authorization::verify_runtime_initial(&p.document,target,&approval.authorization_sha256,&approval.profile_sha256)?
 }else{authorization::verify_initial(&p.document,target)?};
 crate::node_bootstrap::validate_operator(operator)?;
 let runtime=profile_approval.is_some();
 let value=serde_json::to_value(Initial{document:p.document.clone(),operator:operator.into(),profile_approval})
  .map_err(|_|"Cannot record the approved network profile")?;
 let path=initial_path(base,target)?;
 if !path.exists()&&!path.is_symlink(){
  if runtime {
   // A profile can authorize the same clean bootstrap that the native app
   // already completed. It cannot create another privileged target scope.
   let keys=["release_id","manifest_sha256","network_id","chain_id","node_name"];
   let parameters=keys.into_iter().map(|key|(key.into(),new[key].clone())).collect::<serde_json::Map<String,Value>>();
   let expected=json!({"version":1,"operation":"bootstrap","operator":operator,
    "parameters":parameters,"bootstrapPin":crate::node_bootstrap::script_pin()});
   return crate::request_journal::with_latest_success(base,&target.journal_identity(),"bootstrap",|boot|{
    if boot["request_sha256"]!=hash(expected.to_string().as_bytes()) {
     return Err("The network profile differs from the successful clean bootstrap".into());
    }
    save(&path,&value)
   });
  }
  return save(&path,&value)
 }
 let(record,old)=initial(base,target)?;
 if record.document==p.document&&record.operator==operator{
  let prior=reinstallation_ticket(base,target,&hash(record.document.as_bytes()))?;
  if prior.exists()||prior.is_symlink(){return Err("A removed installation must use a distinct newly approved initial authorization, never its consumed origin".into())}return Ok(())
 }
 if !cfg!(debug_assertions)||record.operator!=operator{return Err("New installation administrative identity differs".into())}
 let ticket:Value=serde_json::from_slice(&read(&reinstallation_ticket(base,target,&hash(record.document.as_bytes()))?,4096)?).map_err(|_|"Invalid reinstallation receipt")?;
 crate::request_journal::with_latest_success(base,&target.journal_identity(),"bootstrap",|boot|{
 replacement_allowed(&old,&new,&ticket,&boot,&hash(record.document.as_bytes()))?;
 crate::vpn_enrollment::require_terminal(base,target,&old)?;
 let pin=hash(p.document.as_bytes());let directory=folder(base)?;
 save(&directory.join(format!("initial-{}-{pin}.json",hash(target.journal_identity().to_string().as_bytes()))),&value)?;
 let destination=pointer(base,&target.journal_identity());let pending=destination.with_extension("pending");
 save(&pending,&json!({"initial_sha256":pin,"target_sha256":hash(target.journal_identity().to_string().as_bytes())}))?;
 std::fs::rename(&pending,&destination).and_then(|_|std::fs::File::open(directory)?.sync_all()).map_err(|_|"Installation incarnation publication interrupted; reconcile without replay".to_string())
 })
}
pub(super) fn bare_initial(base:&Path,target:&Target)->Result<Option<String>,String>{
 let path=initial_path(base,target)?;
 if !path.exists()&&!path.is_symlink(){return Ok(None)}
 initial(base,target).map(|(record,_)|Some(record.document))
}
pub(super) fn approved_initial(base: &Path, target: &Target) -> Result<(String, Value, bool), String> {
 initial(base, target).map(|(record, document)| (record.document, document, record.profile_approval.is_some()))
}
fn host_pin(control:&Path,doc:&Value)->Result<Option<PathBuf>,String>{
 if doc["target"]["kind"]=="local"{return Ok(None)}
 node_controller::protect_control_directory(control)?;
 let line=doc["target"]["host_key"].as_str().ok_or("Missing approved host identity")?;
 let path=control.join(format!("engineering-{}.known-hosts",hash(line.as_bytes())));
 save_text(&path,&format!("{line}\n"))?;Ok(Some(path))
}
fn save_text(path:&Path,text:&str)->Result<(),String>{
 use std::io::Write;if path.exists()||path.is_symlink(){if read(path,4096)?==text.as_bytes(){return Ok(())}return Err("Pinned host identity changed".into())}
 let mut o=std::fs::OpenOptions::new();o.create_new(true).write(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;o.mode(0o600);}o.open(path).and_then(|mut f|{f.write_all(text.as_bytes())?;f.sync_all()}).map_err(|_|"Cannot protect approved host identity".to_string())
}
pub(super) async fn execute(base:&Path,target:Target,request:Request,control:&Path)->Result<Value,String>{
 let path=initial_path(base,&target)?;
 if !path.exists()&&!path.is_symlink(){return node_controller::execute(target,request,control).await}
 let(_,doc)=initial(base,&target)?;let pin=host_pin(control,&doc)?;node_controller::execute_pinned(target,request,control,pin.as_deref()).await
}
fn continuation_document(doc:&Value,status:&Value,request:&Request,pins:Option<&Value>,now:u64)->Result<Value,String>{
 let current=&status["authorization"];
 let sequence=current["sequence"].as_u64().filter(|s|*s>0&&*s<(1u64<<53)-1).ok_or("Invalid current authorization sequence")?;
 let parent=current["sha256"].as_str().filter(|s|s.len()==64).ok_or("Missing current authorization identity")?;
 let original=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});
 if status["target"]!=doc["target"]||status.get("initial_selection").unwrap_or(&status["selection"])!=&original||["network_id","chain_id","node_name"].iter().any(|key|status["selection"][key]!=original[key])||status["formation_sha256"]!=doc["artifacts"]["formation-context.json"]||status["formation_sha256"].is_null(){return Err("Continuation changes the authenticated target, master, network or formation".into())}
 let selected=&status["selection"];if selected!=&original{
  let adoption=&status["update"];
  if adoption["initial_sha256"]!=status["initial_sha256"]||adoption["formation_sha256"]!=status["formation_sha256"]||!(["selection","previous_selection"].iter().any(|key|&adoption[key]==selected)){return Err("Current release lacks its exact native-reviewed adoption".into())}
 }
 for key in ["release_id","manifest_sha256"]{if !selected[key].is_string(){return Err("Invalid current release selection".into())}}
 if pins.is_some()&&!status["genesis_pins"].is_null()&&Some(&status["genesis_pins"])!=pins{return Err("An authenticated Genesis root cannot be substituted".into())}
 let mut next=doc.clone();next["release_id"]=selected["release_id"].clone();next["manifest_sha256"]=selected["manifest_sha256"].clone();next["sequence"]=json!(sequence+1);next["expires_at"]=json!(now.checked_add(300).ok_or("Clock overflow")?);next["requests"]=json!([{"operation":request.operation,"request_sha256":request.approval_id()}]);next["artifacts"]=json!({});next["genesis_pins"]=pins.cloned().unwrap_or_else(||status["genesis_pins"].clone());
 if parent==hash(next.to_string().as_bytes()){return Err("Continuation cannot reuse its parent identity".into())}Ok(next)
}
// One ordinary continuation transaction per physical/logical target, including across Portal instances.
// The persistent owned lock file contains no authority or credentials; OS lock release handles process death.
pub(super) struct ContinuationLock(std::fs::File);
pub(super) fn continuation_lock(base:&Path,target:&Target)->Result<ContinuationLock,String>{
 use std::io::ErrorKind;
 let path=folder(base)?.join(format!("continuation-{}.lock",hash(target.journal_identity().to_string().as_bytes())));
 let mut options=std::fs::OpenOptions::new();options.read(true).write(true).create_new(true);
 #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600).custom_flags(libc::O_NOFOLLOW);}
 let file=match options.open(&path){Ok(f)=>f,Err(e)if e.kind()==ErrorKind::AlreadyExists=>{read(&path,0)?;{let mut old=std::fs::OpenOptions::new();old.read(true).write(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;old.custom_flags(libc::O_NOFOLLOW);}old.open(&path).map_err(|_|"Cannot open continuation lock")?}},Err(_)=>return Err("Cannot protect continuation transaction".into())};
 file.try_lock().map_err(|_|"Continuation transaction is busy; preserve pending intent")?;
 Ok(ContinuationLock(file))
}
impl Drop for ContinuationLock{fn drop(&mut self){let _=self.0.unlock();}}
pub(super) async fn grant(base:&Path,target:&Target,request:&Request,control:&Path,pins:Option<&Value>)->Result<(),String>{
 if !cfg!(debug_assertions){return Ok(())} // Normal production still requires its pre-existing independent grant.
 let path=initial_path(base,target)?;if !path.exists(){return Ok(())}
 let transaction=continuation_lock(base,target)?;
 grant_locked(base,target,request,control,pins,&transaction).await
}
pub(super) async fn grant_locked(base:&Path,target:&Target,request:&Request,control:&Path,pins:Option<&Value>,_transaction:&ContinuationLock)->Result<(),String>{
 grant_with_gateway_purpose(base,target,request,control,pins,_transaction,false).await
}
pub(super) async fn gateway_grant_locked(base:&Path,target:&Target,request:&Request,control:&Path,transaction:&ContinuationLock)->Result<(),String>{
 if !cfg!(debug_assertions)||!initial_path(base,target)?.exists(){return Err("Gateway admission requires an independently pinned engineering target".into())}
 grant_with_gateway_purpose(base,target,request,control,None,transaction,request.operation=="gateway_admission_prepare").await
}
pub(super) async fn gateway_target_grant_locked(base:&Path,target:&Target,request:&Request,control:&Path,transaction:&ContinuationLock)->Result<(),String>{
 if !cfg!(debug_assertions)||!initial_path(base,target)?.exists(){return Err("Gateway target requires an independently pinned engineering host authorization".into())}
 crate::gateway_target::validate(request)?;
 let(_,doc)=initial(base,target)?;authorization::require_gateway_initial(&doc)?;
 grant_with_gateway_purpose(base,target,request,control,None,transaction,false).await
}
async fn grant_with_gateway_purpose(base:&Path,target:&Target,request:&Request,control:&Path,pins:Option<&Value>,_transaction:&ContinuationLock,gateway_purpose:bool)->Result<(),String>{
 if !cfg!(debug_assertions){return Ok(())}
 let path=initial_path(base,target)?;if !path.exists(){return Ok(())}
 let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["schema"]!="nodenetwork-engineering-authorization-status-v1"||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Target has not reconciled this independently approved initial authorization".into())}
 let intent=folder(base)?.join(format!("continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 if intent.exists()||intent.is_symlink(){
  let old=read(&intent,100*1024)?;let saved:Value=serde_json::from_slice(&old).map_err(|_|"Interrupted continuation receipt is malformed")?;
  if status["authorization"]["sha256"]!=hash(saved.to_string().as_bytes()){return Err("Interrupted continuation has no exact target confirmation; preserve it and use read-only reconciliation, never replay".into())}
  std::fs::remove_file(&intent).map_err(|_|"Cannot reconcile exact continuation receipt")?;
 }
 if status["pending_grants"].as_array().is_some_and(|a|a.iter().any(|v|v.as_str()==Some(request.approval_id().as_str()))){return Ok(())}
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let next=continuation_document(&doc,status,request,pins,now)?;
 let parent=status["authorization"]["sha256"].as_str().ok_or("No authorization parent")?;let formation=status["formation_sha256"].as_str().ok_or("No approved formation")?;
 let prepared=if gateway_purpose{authorization::gateway_continuation(next,target,&hash(record.document.as_bytes()),parent,formation,request)?}else{authorization::continuation(next,target,&hash(record.document.as_bytes()),parent,formation)?};
 let saved:Value=serde_json::from_str(&prepared.document).map_err(|_|"Invalid exact continuation document")?;
 save(&intent,&saved)?;
 let expected=prepared.sha256.clone();
 let result=authorization::execute(target.clone(),record.operator,prepared,control).await?;
 if result["ok"]!=true||result["result"]["sha256"]!=expected||result["result"]["applied"]!=true||result["result"]["grants_recreated"]!=false{return Err("Exact continuation outcome uncertain or refused; read authorization status, never replay".into())}
 std::fs::remove_file(&intent).map_err(|_|"Continuation succeeded but local confirmation is interrupted; reconcile status")?;Ok(())
}

pub(super) async fn vpn_grant(base:&Path,target:&Target,request:&Request,control:&Path,artifact:authorization::NativeVpnArtifact<'_>)->Result<(),String>{
 let bytes=artifact.bytes;
 let(record,doc)=initial(base,target)?;
 let status=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if status["ok"]!=true||status["result"]["initial_sha256"]!=hash(record.document.as_bytes()){return Err("VPN target lacks the exact initial native authorization".into())}
 let status=&status["result"];let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let next=continuation_document(&doc,status,request,None,now)?;
 let prepared=authorization::vpn_continuation(next,target,&hash(record.document.as_bytes()),status["authorization"]["sha256"].as_str().ok_or("No authorization parent")?,status["formation_sha256"].as_str().ok_or("No approved formation")?,artifact)?;
 let expected=prepared.sha256.clone();let intent=folder(base)?.join(format!("vpn-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 if intent.exists()||intent.is_symlink(){
  let previous:Value=serde_json::from_slice(&read(&intent,4096)?).map_err(|_|"Malformed prior VPN authorization intent")?;
  if previous["authorization_sha256"]==status["authorization"]["sha256"]&&previous["request_sha256"]==request.approval_id()&&previous["artifact_sha256"]==hash(bytes)&&status["pending_grants"].as_array().is_some_and(|a|a.iter().any(|v|v.as_str()==Some(request.approval_id().as_str()))){
   std::fs::remove_file(&intent).map_err(|_|"Cannot reconcile applied VPN authorization")?;return Ok(())
  }
  return Err("Prior VPN authorization is uncertain; inspect exact target status, never restage it".into())
 }
 save(&intent,&json!({"authorization_sha256":expected,"request_sha256":request.approval_id(),"artifact_sha256":hash(bytes)}))?;
 let result=authorization::execute(target.clone(),record.operator,prepared,control).await?;
 if result["ok"]!=true||result["result"]["sha256"]!=expected||result["result"]["applied"]!=true{return Err("VPN authorization uncertain; do not replay".into())}
 std::fs::remove_file(intent).map_err(|_|"VPN authorization succeeded; local reconciliation required")?;Ok(())
}

fn matching_export(receipt:&Value,export:&Value,doc:&Value)->Result<(),String>{
 let receipt=crate::network_formation::review(receipt)?;
 if receipt["signed"]!=true||receipt["network_id"]!=doc["network_id"]||receipt["chain_id"].as_str().and_then(|s|s.parse::<u64>().ok())!=doc["chain_id"].as_u64()||receipt["formation_sha256"]!=doc["artifacts"]["formation-context.json"]{return Err("Signed export changes the independently approved network formation".into())}
 for field in ["review_sha256","genesis_sha256","authority_sha256","authority_root_sha256"]{if receipt[field]!=export[field]{return Err("Signed export or authority root differs from its exact native review".into())}}
 crate::network_formation::export(export,receipt["review_sha256"].as_str().ok_or("No signed review")?)?;Ok(())
}
pub(super) async fn remember_export(base:&Path,target:&Target,export:&Value,control:&Path)->Result<(),String>{
 if !cfg!(debug_assertions)||!initial_path(base,target)?.exists(){return Ok(())}
 let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"network_formation_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true{return Err("Source did not reverify signed formation custody and artifacts".into())}
 let receipt=crate::network_formation::review(&reply["result"])?;matching_export(&receipt,export,&doc)?;
 let entries=std::fs::read_dir(folder(base)?).map_err(|_|"Cannot inspect public formation receipts")?;
 let mut count=0;for entry in entries{let entry=entry.map_err(|_|"Cannot inspect public receipt")?;if !entry.file_name().to_string_lossy().starts_with("signed-"){continue}count+=1;if count>5{return Err("Public formation receipt inventory exceeds bound".into())}
  let old:Value=serde_json::from_slice(&read(&entry.path(),3*1024*1024)?).map_err(|_|"Invalid stored public formation receipt")?;
  if old["receipt"]["formation_sha256"]==receipt["formation_sha256"]&&old["receipt"]["review_sha256"]!=receipt["review_sha256"]{return Err("A different signed authority already exists for this formation; no automatic replacement".into())}
 }
 let public=json!({"source":target.journal_identity(),"initial_sha256":hash(record.document.as_bytes()),"receipt":receipt,"export":export});
 save(&folder(base)?.join(format!("signed-{}.json",receipt["review_sha256"].as_str().ok_or("No signed review")?)),&public)
}
/// Reload the approved source and run its current APQE-verifying export again.
/// Stored public JSON alone is never accepted as an authority or a fresh proof.
pub(super) struct SignedSource{pub target:Target,pub export:Value,pub receipt:Value}
pub(super) fn original_document(base:&Path,target:&Target)->Result<Value,String>{initial(base,target).map(|(_,doc)|doc)}
pub(super) fn runtime_probe_scope(base:&Path,target:&Target,status:&Value)->Result<Value,String>{
 let(record,doc)=initial(base,target)?;
 runtime_probe_origin_scope(&doc,&hash(record.document.as_bytes()),status)
}
fn runtime_probe_origin_scope(doc:&Value,initial_sha:&str,status:&Value)->Result<Value,String>{
 if status["schema"]!="nodenetwork-engineering-authorization-status-v1"||status["initial_sha256"]!=initial_sha||status["target"]!=doc["target"]
  ||["network_id","chain_id"].iter().any(|k|status["selection"][*k]!=doc[*k])||doc["chain_id"]!=99999{return Err("Candidate probe requires the exact independently approved target/network origin".into())}
 let mut pins=status["genesis_pins"].as_object().cloned().ok_or("Candidate probe needs independently approved Genesis pins")?;
 for name in ["genesis.json","authority.json","authority-root.pub","transport-registry.json","transport-root.pub","network-manifest.json"]{
  for(map,path) in [(&doc["artifacts"],format!("commissioning/network/{name}")),(&status["commissioning_file_sha256"],format!("network/{name}"))]{if let Some(pin)=map.get(&path){if pins.get(name).is_some_and(|old|old!=pin){return Err("Candidate probe origin approval conflicts".into())}pins.insert(name.into(),pin.clone());}}
 }
 Ok(json!({"network_id":doc["network_id"],"chain_id":"99999","origin_pins":pins}))
}

pub(super) async fn signed_source(base:&Path,target:&Target,control:&Path)->Result<Option<SignedSource>,String>{
 if !cfg!(debug_assertions)||!initial_path(base,target)?.exists(){return Ok(None)}
 let(_,doc)=initial(base,target)?;
 let mut selected=None;let mut count=0;
 for entry in std::fs::read_dir(folder(base)?).map_err(|_|"Cannot inspect public formation receipts")?{
  let entry=entry.map_err(|_|"Cannot inspect public receipt")?;if !entry.file_name().to_string_lossy().starts_with("signed-"){continue}count+=1;if count>5{return Err("Public receipt inventory exceeds bound".into())}
  let saved:Value=serde_json::from_slice(&read(&entry.path(),3*1024*1024)?).map_err(|_|"Invalid stored public receipt")?;
  if saved["receipt"]["formation_sha256"]!=doc["artifacts"]["formation-context.json"]{continue}
  if selected.is_some(){return Err("Ambiguous formation authorities; no automatic selection".into())}selected=Some(saved);
 }
 let Some(saved)=selected else{return Ok(None)};
 let source:Target=serde_json::from_value(saved["source"].clone()).map_err(|_|"Invalid approved source target")?;source.validate()?;
 let(record,source_doc)=initial(base,&source)?;
 if saved["initial_sha256"]!=hash(record.document.as_bytes())||source_doc["network_id"]!=doc["network_id"]||source_doc["chain_id"]!=doc["chain_id"]{return Err("Public export source changes the approved network or initial host identity".into())}
 let fresh=execute(base,source.clone(),Request{version:1,operation:"network_formation_export".into(),parameters:json!({})},control).await?;
 let status=execute(base,source.clone(),Request{version:1,operation:"network_formation_status".into(),parameters:json!({})},control).await?;
 if fresh["ok"]!=true||status["ok"]!=true||fresh["result"]!=saved["export"]{return Err("Original APQE-verifying source no longer confirms the exact signed public export".into())}
 matching_export(&status["result"],&fresh["result"],&source_doc)?;
 if status["result"]["review_sha256"]!=saved["receipt"]["review_sha256"]{return Err("Original signed review changed".into())}
 Ok(Some(SignedSource{target:source,export:fresh["result"].clone(),receipt:status["result"].clone()}))
}
pub(super) async fn engineering_stage(base:&Path,target:&Target,expected_address:&str,control:&Path)->Result<Option<(Value,Value)>,String>{
 let Some(source)=signed_source(base,target,control).await? else{return Ok(None)};
 let(_,doc)=initial(base,target)?;let fresh=json!({"result":source.export});let status=json!({"result":source.receipt});
 let prepared=execute(base,target.clone(),Request{version:1,operation:"formation_status".into(),parameters:json!({})},control).await?;
 if prepared["ok"]!=true||prepared["result"]["address"]!=expected_address||prepared["result"]["pending"]!=true||prepared["result"]["possession_verified"]!=true||prepared["result"]["formation_sha256"]!=doc["artifacts"]["formation-context.json"]||!status["result"]["validator_addresses"].as_array().is_some_and(|a|a.iter().any(|v|v==expected_address)){return Err("Target prepared custody is not a member of the exact signed formation".into())}
 let export=&fresh["result"];let policy=json!({"schema":"nodenetwork-genesis-stage-policy-v1","address":expected_address,"genesis_sha256":export["genesis_sha256"],"authority_sha256":export["authority_sha256"],"authority_root_sha256":export["authority_root_sha256"]});
 Ok(Some((policy,export["artifacts"].clone())))
}

pub(super) async fn eligible(base:&Path,target:&Target,control:&Path)->Result<bool,String>{
 if !cfg!(debug_assertions)||!initial_path(base,target)?.exists(){return Ok(false)}
 let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true||reply["result"]["initial_sha256"]!=hash(record.document.as_bytes()){return Ok(false)}
 let request=Request{version:1,operation:"restart".into(),parameters:json!({})};
 continuation_document(&doc,&reply["result"],&request,None,1)?;Ok(true)
}
pub(super) async fn guest_grant(base:&Path,target:&Target,request:&Request,control:&Path,bytes:&[u8],resources:&Value)->Result<Value,String>{
 if !cfg!(debug_assertions)||target.guest.is_some(){return Err("Guest policy staging is isolated engineering on the physical host only".into())}
 let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Guest host does not match its original independent authorization".into())}
 if status["selection"]["release_id"]!=resources["release_id"]||status["selection"]["manifest_sha256"]!=resources["manifest_sha256"]{return Err("Guest resources changed after native review; inspect the current master before approval".into())}
 let intent=folder(base)?.join(format!("guest-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 if intent.exists()||intent.is_symlink(){
  let old:Value=serde_json::from_slice(&read(&intent,4096)?).map_err(|_|"Malformed guest continuation intent")?;
  if old["authorization_sha256"]==status["authorization"]["sha256"]&&old["request_sha256"]==request.approval_id()&&old["artifact_sha256"]==hash(bytes)&&status["pending_grants"].as_array().is_some_and(|a|a.iter().any(|v|v.as_str()==Some(request.approval_id().as_str()))){
   crate::request_journal::reconcile_verified(base,&target.journal_identity(),"authorization_stage",&request.approval_id())?;
   std::fs::remove_file(intent).map_err(|_|"Guest grant is verified; local reconciliation interrupted")?;
   return Ok(json!({"schema":"nodenetwork-guest-configuration-v1","request_sha256":request.approval_id(),"policy_sha256":hash(bytes),"guest_id":request.parameters["guest_id"],"configured":true,"guest_created":false}));
  }return Err("Guest policy staging is uncertain; inspect the original intent without restaging".into())
 }
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let next=continuation_document(&doc,status,request,None,now)?;
 let prepared=authorization::guest_continuation(next,target,&hash(record.document.as_bytes()),status["authorization"]["sha256"].as_str().ok_or("Missing authorization parent")?,status["formation_sha256"].as_str().ok_or("Missing formation")?,authorization::NativeGuestArtifact{bytes,request})?;
 let expected=prepared.sha256.clone();
 let dispatch=crate::request_journal::Dispatch::begin(base,&target.journal_identity(),"authorization_stage",&request.canonical())?;
 let result=async{
  save(&intent,&json!({"authorization_sha256":expected,"request_sha256":request.approval_id(),"artifact_sha256":hash(bytes)}))?;
  let reply=authorization::execute(target.clone(),record.operator,prepared,control).await?;
  if reply["ok"]!=true||reply["result"]["sha256"]!=expected||reply["result"]["applied"]!=true{return Err("Guest policy outcome uncertain or refused; do not restage".into())}
  std::fs::remove_file(&intent).map_err(|_|"Guest policy applied; local confirmation interrupted")?;
  Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-guest-configuration-v1","request_sha256":request.approval_id(),"policy_sha256":hash(bytes),"guest_id":request.parameters["guest_id"],"configured":true,"guest_created":false}}))
 }.await;
 dispatch.finish(&result)?;result.map(|v|v["result"].clone())
}

pub(super) async fn commission_recovery(base:&Path,target:&Target,control:&Path)->Result<(String,Value,Option<PathBuf>,crate::request_journal::CommissionNotApplied),String>{
 if !cfg!(debug_assertions)||target.kind!="remote"{return Err("Commission nonapplication requires an approved remote engineering target".into())}
 let ticket=crate::request_journal::commission_not_applied_ticket(base,&target.journal_identity())?;
 let(record,doc)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Original commission authorization scope unavailable".into())}
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
 // This validates original/adopted selection and produces public encoding only.
 // It is NEVER submitted to an authorizer or used to issue another grant.
 let mut template=continuation_document(&doc,status,&request,None,1)?;
 template["sequence"]=status["authorization"]["sequence"].clone();template["expires_at"]=status["authorization"]["expires_at"].clone();
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let context=json!({"initial_sha256":hash(record.document.as_bytes()),"authorization":status["authorization"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"genesis_pins":status["genesis_pins"],"request_sha256":request.approval_id(),"expires_at":now+120});
 let wire=json!({"context":context,"challenge":ticket.challenge(),"document_template":template,"original":ticket.original()});
 Ok((record.operator,wire,host_pin(control,&doc)?,ticket))
}
pub(super) async fn treasury_phase_context(base:&Path,target:&Target,control:&Path,nonce:u64)->Result<(String,Value,Option<PathBuf>),String>{
 if !cfg!(debug_assertions)||target.kind!="remote"{return Err("Treasury phase inspection requires an approved remote engineering target".into())}
 let original=crate::request_journal::treasury_phase_original(base,&target.journal_identity())?;
 let(record,doc)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;let status=&reply["result"];
 if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Original treasury authorization scope unavailable".into())}
 // Validate authenticated current adoption without issuing or constructing a grant for use.
 continuation_document(&doc,status,&Request{version:1,operation:"commission".into(),parameters:json!({})},None,1)?;
 let at=original["recorded_at_ms"].as_u64().ok_or("Original dispatch time unavailable")?/1000;
 let expires=status["authorization"]["expires_at"].as_u64().ok_or("Original authorization time unavailable")?;
 if expires.checked_sub(300).is_none_or(|created|created>at)||at>expires{return Err("Current authorization is not contemporaneous with the original treasury dispatch".into())}
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let context=json!({"initial_sha256":hash(record.document.as_bytes()),"authorization":status["authorization"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"genesis_pins":status["genesis_pins"],"request_sha256":original["request_digest"],"nonce":nonce,"expires_at":now+120});
 let challenge=hash(json!([original,context,now,std::process::id()]).to_string().as_bytes());
 Ok((record.operator,json!({"context":context,"challenge":challenge,"original":original}),host_pin(control,&doc)?))
}
pub(super) fn retire_treasury_prepare(base:&Path,target:&Target,wire:&Value,proof:&Value,ticket:crate::request_journal::TreasuryNotApplied)->Result<(),String>{
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let expected=json!({"schema":"nodenetwork-treasury-send-not-applied-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"nonce":wire["context"]["nonce"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
 if *proof!=expected||ticket.original()!=&wire["original"]||ticket.original()["request_digest"]!=wire["context"]["request_sha256"]||wire["context"]["expires_at"].as_u64().is_none_or(|t|t<now||t>now+120){return Err("Exact fresh treasury nonapplication proof unavailable; original remains fenced".into())}
 let receipt=folder(base)?.join(format!("treasury-not-applied-{}.json",wire["original"]["id"].as_str().ok_or("Original treasury record unavailable")?));let mut durable=proof.clone();durable.as_object_mut().unwrap().remove("challenge");
 crate::request_journal::verify_treasury_not_applied(base,&target.journal_identity(),ticket,||save_retirement(&receipt,&json!({"state":"not_applied","target":target.journal_identity(),"original":wire["original"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"proof":durable})))
}
fn original_commission_document(wire:&Value,readiness:&str)->Result<String,String>{
 let authorization=&wire["context"]["authorization"];
 let expiry=authorization["expires_at"].as_u64().ok_or("Original commission authorization expiry unavailable")?;
 let recorded=wire["original"]["recorded_at_ms"].as_u64().ok_or("Original commission dispatch unavailable")?/1000;
 let created=expiry.checked_sub(300).ok_or("Invalid original commission authorization expiry")?;
 if created>recorded||created<recorded.saturating_sub(300){return Err("Current authorization was not issued in the original commission dispatch window; outcome remains fenced".into())}
 let mut candidate=wire["document_template"].clone();let mut matched=None;
 for artifacts in [json!({}),json!({"commissioning-readiness.json":readiness})]{candidate["artifacts"]=artifacts;let raw=candidate.to_string();
  if hash(raw.as_bytes())==authorization["sha256"]{if matched.is_some(){return Err("Ambiguous original commission authorization".into())}matched=Some(raw);}
 }
 matched.ok_or_else(||"Current authorization does not exactly encode the original commission approval; preserve its journal fence".into())
}
pub(super) fn retire_commission(base:&Path,target:&Target,wire:&Value,proof:&Value,ticket:crate::request_journal::CommissionNotApplied)->Result<(),String>{
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if wire["context"]["expires_at"].as_u64().is_none_or(|t|t<now||t>now+120)||ticket.original()!=wire["original"]{return Err("Commission proof expired or original dispatch changed".into())}
 let readiness=proof["readiness_sha256"].as_str().filter(|p|p.len()==64&&p.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).ok_or("Exact original readiness commitment absent")?;
 let expected=json!({"schema":"nodenetwork-commission-not-applied-v1","challenge":wire["challenge"],"request_sha256":wire["context"]["request_sha256"],"authorization_sha256":wire["context"]["authorization"]["sha256"],"readiness_sha256":readiness,"not_applied":true,"mutation_performed":false});
 if *proof!=expected||!ticket.accepts_readiness(readiness){return Err("Commission proof differs from original request and successful readiness stage".into())}
 let raw=original_commission_document(wire,readiness)?;
 let receipt=folder(base)?.join(format!("commission-not-applied-{}.json",wire["original"]["id"].as_str().ok_or("Original commission record absent")?));
 let mut durable=proof.clone();durable.as_object_mut().ok_or("Malformed commission proof")?.remove("challenge");
 crate::request_journal::verify_commission_not_applied(base,&target.journal_identity(),ticket,||{
  save_retirement(&receipt,&json!({"state":"not_applied","target":target.journal_identity(),"original":wire["original"],"authorization_json":raw,"proof":durable}))?;
  std::fs::File::open(folder(base)?).and_then(|f|f.sync_all()).map_err(|_|"Commission nonapplication receipt not durable".to_string())
 })
}

fn readiness_intent(base:&Path,target:&Target)->Result<PathBuf,String>{Ok(folder(base)?.join(format!("readiness-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes()))))}
fn read_readiness_intent(base:&Path,target:&Target)->Result<Value,String>{
 let value:Value=serde_json::from_slice(&read(&readiness_intent(base,target)?,65536)?).map_err(|_|"Malformed readiness intent")?;validate_readiness_intent(&value)?;Ok(value)
}
fn validate_readiness_intent(value:&Value)->Result<(),String>{
 let keys=["authorization_sha256","request_sha256","artifact_sha256","dispatch_sha256"];
 if !value.as_object().is_some_and(|o|(o.len()==4||o.len()==6&&o.contains_key("document")&&o.contains_key("parent_sha256"))&&keys.iter().all(|k|o.get(*k).and_then(Value::as_str).is_some_and(|v|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))))){return Err("Malformed original readiness intent commitments".into())}
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
 let dispatch=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":value["artifact_sha256"]});
 if value["request_sha256"]!=request.approval_id()||value["dispatch_sha256"]!=hash(dispatch.to_string().as_bytes()){return Err("Original readiness dispatch commitments differ".into())}Ok(())
}
fn original_readiness_document(doc:&Value,status:&Value,intent:&Value,recorded_at_ms:u64)->Result<String,String>{
 validate_readiness_intent(intent)?;
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
 let mut candidate=continuation_document(doc,status,&request,None,1)?;
 candidate["artifacts"]=json!({"commissioning-readiness.json":intent["artifact_sha256"]});
 if let Some(raw)=intent.get("document"){
  let raw=raw.as_str().ok_or("Original readiness document is malformed")?;
  let value:Value=serde_json::from_str(raw).map_err(|_|"Original readiness document is malformed")?;
  candidate["expires_at"]=value["expires_at"].clone();
  if intent["parent_sha256"]!=status["authorization"]["sha256"]||value!=candidate||hash(raw.as_bytes())!=intent["authorization_sha256"]{return Err("Original readiness predecessor or document differs; preserve pending intent".into())}return Ok(raw.into())
 }
 // Legacy intents retained only hashes. Recover public encoding, never authority:
 // at most 301 possible creation seconds before the ORIGINAL journal dispatch.
 // Exact SHA and current predecessor+1 are mandatory; no current-time search.
 let end=recorded_at_ms/1000;let start=end.saturating_sub(300);let mut matched=None;
 for created in start..=end{candidate["expires_at"]=json!(created.checked_add(300).ok_or("Original readiness expiry overflow")?);let raw=candidate.to_string();
  if hash(raw.as_bytes())==intent["authorization_sha256"]{if matched.is_some(){return Err("Ambiguous original readiness document".into())}matched=Some(raw);}
 }
 matched.ok_or_else(||"Original readiness document cannot be independently reconstructed; preserve pending intent".into())
}
pub(super) async fn readiness_recovery(base:&Path,target:&Target,control:&Path)->Result<(String,Value,Option<PathBuf>,crate::request_journal::TransportNotApplied),String>{
 if !cfg!(debug_assertions)||target.kind!="remote"{return Err("Readiness nonapplication requires an approved remote engineering target".into())}
 let intent=read_readiness_intent(base,target)?;
 let key=intent["dispatch_sha256"].as_str().ok_or("Readiness dispatch unavailable")?;
 let ticket=crate::request_journal::readiness_not_applied_ticket(base,&target.journal_identity(),key)?;
 let(record,doc)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes())||status["authorization"]["sha256"]==intent["authorization_sha256"]{return Err("Original readiness may already be applied; use staged authorization reconciliation".into())}
 let pending=original_readiness_document(&doc,status,&intent,ticket.recorded_at_ms())?;
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let context=json!({"initial_sha256":hash(record.document.as_bytes()),"authorization":status["authorization"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"genesis_pins":status["genesis_pins"],"pending_sha256":intent["authorization_sha256"],"artifact_sha256":intent["artifact_sha256"],"dispatch_sha256":key,"expires_at":now+120});
 let wire=json!({"context":context,"pending_json":pending,"challenge":ticket.challenge(),"intent":intent});
 Ok((record.operator,wire,host_pin(control,&doc)?,ticket))
}
pub(super) fn retire_readiness(base:&Path,target:&Target,wire:&Value,proof:&Value,ticket:crate::request_journal::TransportNotApplied)->Result<(),String>{
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if wire["context"]["expires_at"].as_u64().is_none_or(|t|t<now||t>now+120){return Err("Readiness proof expired".into())}
 let expected=json!({"schema":"nodenetwork-readiness-not-applied-v1","challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"dispatch_sha256":wire["context"]["dispatch_sha256"],"parent_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
 if *proof!=expected||hash(wire["pending_json"].as_str().ok_or("Original readiness document unavailable")?.as_bytes())!=wire["context"]["pending_sha256"]{return Err("Readiness nonapplication proof differs from immutable intent".into())}
 let path=readiness_intent(base,target)?;let key=wire["context"]["dispatch_sha256"].as_str().ok_or("Readiness dispatch absent")?;
 crate::request_journal::verify_transport_not_applied(base,&target.journal_identity(),key,ticket,||{
  if serde_json::from_slice::<Value>(&read(&path,65536)?).ok()!=Some(wire["intent"].clone()){return Err("Original readiness intent changed".into())}
  let receipt=folder(base)?.join(format!("readiness-not-applied-{}.json",wire["context"]["pending_sha256"].as_str().ok_or("Readiness pin unavailable")?));
  let mut durable=proof.clone();durable.as_object_mut().ok_or("Malformed readiness proof")?.remove("challenge");
  save_retirement(&receipt,&json!({"state":"not_applied","target":target.journal_identity(),"intent":wire["intent"],"pending_json":if wire["intent"].get("document").is_some(){Value::Null}else{wire["pending_json"].clone()},"proof":durable}))?;
  std::fs::File::open(folder(base)?).and_then(|f|f.sync_all()).map_err(|_|"Readiness nonapplication receipt not durable".to_string())
 })?;
 std::fs::remove_file(path).and_then(|_|std::fs::File::open(folder(base).map_err(std::io::Error::other)?)?.sync_all()).map_err(|_|"Readiness not applied; local intent cleanup interrupted".to_string())
}
fn readiness_ack(reply:&Value,expected:&str)->Result<(),String>{
 if reply["ok"]==false{return Err("Readiness authorization was refused by the authenticated controller; verify the original stage before any new authorization".into())}
 if reply["ok"]!=true||reply["result"]["sha256"]!=expected||reply["result"]["applied"]!=true||reply["result"]["grants_recreated"]!=false{return Err("Readiness acknowledgement differs; outcome remains uncertain and must not be replayed".into())}Ok(())
}

pub(super) async fn reconcile_readiness(base:&Path,target:&Target,control:&Path)->Result<Option<Value>,String>{
 let _transaction=continuation_lock(base,target)?;
 let intent=readiness_intent(base,target)?;
 if !intent.exists()&&!intent.is_symlink(){return Ok(None)}
 let old=read_readiness_intent(base,target)?;
 let(record,_)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true||reply["result"]["initial_sha256"]!=hash(record.document.as_bytes())||reply["result"]["authorization"]["sha256"]!=old["authorization_sha256"]{return Err("Original readiness authorization is not independently confirmed; preserve the intent without replay".into())}
 let dispatch=old["dispatch_sha256"].as_str().ok_or("Missing original readiness dispatch commitment")?;
 crate::request_journal::reconcile_verified(base,&target.journal_identity(),"authorization_stage",dispatch)?;
 std::fs::remove_file(intent).map_err(|_|"Readiness confirmed; local reconciliation interrupted")?;Ok(Some(old))
}

pub(super) async fn readiness_grant(base:&Path,target:&Target,control:&Path,bytes:&[u8])->Result<(),String>{
 let _transaction=continuation_lock(base,target)?;
 if !cfg!(debug_assertions){return Err("Readiness approval is isolated engineering only".into())}
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Readiness target lacks its original independent authorization".into())}
 let artifact:Value=serde_json::from_slice(bytes).map_err(|_|"Invalid readiness artifact")?;
 let own=artifact["observations"].as_array().and_then(|v|v.iter().find(|v|v["target"]==doc["target"])).ok_or("Readiness lacks the exact commissioning target")?;
 if own["manifest_sha256"]!=status["selection"]["manifest_sha256"]||own["formation_sha256"]!=status["formation_sha256"]{return Err("Commissioning target release or formation changed after collection".into())}
 let intent=readiness_intent(base,target)?;
 if intent.exists()||intent.is_symlink(){return Err("Readiness staging outcome is uncertain; inspect the original authorization without restaging".into())}
 let next=continuation_document(&doc,status,&request,None,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 let prepared=authorization::readiness_continuation(next,target,&hash(record.document.as_bytes()),status["authorization"]["sha256"].as_str().ok_or("Missing authorization parent")?,status["formation_sha256"].as_str().ok_or("Missing formation")?,bytes)?;
 let expected=prepared.sha256.clone();let dispatch_request=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":hash(bytes)});
 let saved_intent=json!({"authorization_sha256":expected,"request_sha256":request.approval_id(),"artifact_sha256":hash(bytes),"dispatch_sha256":hash(dispatch_request.to_string().as_bytes()),"document":prepared.document,"parent_sha256":status["authorization"]["sha256"]});
 if saved_intent.to_string().len()>65536{return Err("Original readiness intent exceeds its bounded recovery format; no authorization dispatched".into())}
 let dispatch=crate::request_journal::Dispatch::begin(base,&target.journal_identity(),"authorization_stage",&dispatch_request)?;
 let result=async{
  save(&intent,&saved_intent)?;
  let result=authorization::execute(target.clone(),record.operator,prepared,control).await?;
  readiness_ack(&result,&expected)?;
  std::fs::remove_file(&intent).map_err(|_|"Readiness applied; local reconciliation interrupted")?;Ok(result)
 }.await;
 dispatch.finish(&result)?;result.map(|_|())
}

fn transport_intent(base:&Path,target:&Target)->Result<PathBuf,String>{Ok(folder(base)?.join(format!("transport-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes()))))}
fn transport_reconciliation_status(reply:&Value,initial_sha256:&str,intent:&Value)->Result<(),String>{
 if reply["ok"]!=true{return Err("transport_reconcile_status_refused: Target refused the authorization read; original staging remains uncertain. Do not restage".into())}
 if reply["result"]["initial_sha256"]!=initial_sha256{return Err("transport_reconcile_initial_mismatch: Target does not confirm its original initial authorization. Do not restage".into())}
 if reply["result"]["authorization"]["sha256"]!=intent["authorization_sha256"]{return Err("transport_reconcile_continuation_mismatch: Target does not confirm the original transport continuation. Do not restage".into())}
 if reply["result"]["commissioning_file_sha256"]!=intent["summary"]["artifact_sha256"]{return Err("transport_reconcile_artifacts_mismatch: Target does not confirm all eight original commissioning input hashes. Do not restage".into())}
 Ok(())
}
pub(super) async fn reconcile_transport(base:&Path,target:&Target,control:&Path)->Result<Option<Value>,String>{
 let intent=transport_intent(base,target)?;if !intent.exists()&&!intent.is_symlink(){return Ok(None)}
 let old:Value=serde_json::from_slice(&read(&intent,64*1024)?).map_err(|_|"Invalid original transport staging receipt")?;
 let(record,_)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 transport_reconciliation_status(&reply,&hash(record.document.as_bytes()),&old)?;
 let current=crate::transport_staging::candidate(base,target,control).await?;
 if current.summary!=old["summary"]{return Err("Original signed coordinator or exact bound target changed before reconciliation".into())}
 crate::request_journal::reconcile_verified(base,&target.journal_identity(),"authorization_stage",old["dispatch_sha256"].as_str().ok_or("Missing original transport dispatch")?)?;
 std::fs::remove_file(intent).map_err(|_|"Transport staging confirmed; local receipt cleanup interrupted")?;Ok(Some(old["summary"].clone()))
}
pub(super) async fn transport_recovery(base:&Path,target:&Target,control:&Path)->Result<(String,Value,Option<PathBuf>,crate::request_journal::TransportNotApplied),String>{
 if !cfg!(debug_assertions){return Err("Transport nonapplication review is isolated engineering only".into())}
 let intent:Value=serde_json::from_slice(&read(&transport_intent(base,target)?,65536)?).map_err(|_|"Invalid original transport intent")?;
 let(record,doc)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Original native transport scope unavailable".into())}
 continuation_document(&doc,status,&Request{version:1,operation:"commission".into(),parameters:json!({})},Some(&status["genesis_pins"]),1)?;
 let current=crate::transport_staging::candidate(base,target,control).await?;
 if intent["summary"]!=current.summary||status["authorization"]["sha256"]==intent["authorization_sha256"]{return Err("Original transport source changed or may already be applied; use exact staged reconciliation".into())}
 let key=intent["dispatch_sha256"].as_str().ok_or("Original transport dispatch absent")?;
 let dispatch=json!({"operation":"commission","artifact_sha256":current.summary["artifact_sha256"]});
 if hash(dispatch.to_string().as_bytes())!=key{return Err("Original transport dispatch differs from verified public inputs".into())}
 let ticket=crate::request_journal::transport_not_applied_ticket(base,&target.journal_identity(),key)?;
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let context=json!({"initial_sha256":hash(record.document.as_bytes()),"authorization":status["authorization"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"genesis_pins":status["genesis_pins"],"pending_sha256":intent["authorization_sha256"],"artifact_sha256":current.summary["artifact_sha256"],"dispatch_sha256":key,"expires_at":now+120});
 let wire=json!({"context":context,"challenge":ticket.challenge(),"intent":intent});
 Ok((record.operator,wire,host_pin(control,&doc)?,ticket))
}
pub(super) fn retire_transport(base:&Path,target:&Target,wire:&Value,proof:&Value,ticket:crate::request_journal::TransportNotApplied)->Result<(),String>{
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if wire["context"]["expires_at"].as_u64().is_none_or(|t|t<now||t>now+120){return Err("Transport proof expired".into())}
 let expected=json!({"schema":"nodenetwork-transport-not-applied-v1","challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"dispatch_sha256":wire["context"]["dispatch_sha256"],"parent_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
 if *proof!=expected{return Err("Transport proof differs from immutable original intent".into())}
 let path=transport_intent(base,target)?;let key=wire["context"]["dispatch_sha256"].as_str().ok_or("Original transport dispatch absent")?;
 crate::request_journal::verify_transport_not_applied(base,&target.journal_identity(),key,ticket,||{
  if serde_json::from_slice::<Value>(&read(&path,65536)?).ok()!=Some(wire["intent"].clone()){return Err("Original transport intent changed".into())}
  let receipt=folder(base)?.join(format!("transport-not-applied-{}.json",wire["context"]["pending_sha256"].as_str().ok_or("Original transport pin absent")?));
  let mut durable=proof.clone();durable.as_object_mut().ok_or("Malformed transport proof")?.remove("challenge");
  save_retirement(&receipt,&json!({"state":"not_applied","target":target.journal_identity(),"intent":wire["intent"],"proof":durable}))?;
  std::fs::File::open(folder(base)?).and_then(|f|f.sync_all()).map_err(|_|"Transport nonapplication receipt not durable".to_string())
 })?;
 std::fs::remove_file(path).and_then(|_|std::fs::File::open(folder(base).map_err(std::io::Error::other)?)?.sync_all()).map_err(|_|"Transport not applied; local intent cleanup interrupted".to_string())
}

pub(super) async fn transport_grant(base:&Path,target:&Target,control:&Path,candidate:&crate::transport_staging::Candidate)->Result<(),String>{
 if !cfg!(debug_assertions){return Err("Fresh transport input adoption is engineering only".into())}
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true||reply["result"]["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Transport target lacks original authorization".into())}
 let status=&reply["result"];let intent=transport_intent(base,target)?;if intent.exists()||intent.is_symlink(){return Err("Reconcile original transport staging before another operation".into())}
 let next=continuation_document(&doc,status,&request,Some(&status["genesis_pins"]),SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 let prepared=authorization::transport_continuation(next,target,&hash(record.document.as_bytes()),status["authorization"]["sha256"].as_str().ok_or("No authorization parent")?,status["formation_sha256"].as_str().ok_or("No formation")?,candidate)?;
 let expected=prepared.sha256.clone();let dispatch_request=json!({"operation":"commission","artifact_sha256":candidate.summary["artifact_sha256"]});
 let dispatch=crate::request_journal::Dispatch::begin(base,&target.journal_identity(),"authorization_stage",&dispatch_request)?;
 let result=async{
  save(&intent,&json!({"authorization_sha256":expected,"summary":candidate.summary,"dispatch_sha256":hash(dispatch_request.to_string().as_bytes())}))?;
  let applied=authorization::execute(target.clone(),record.operator,prepared,control).await?;
  if applied["ok"]!=true||applied["result"]["sha256"]!=expected||applied["result"]["applied"]!=true{return Err("Transport input staging uncertain; reconcile exact receipt without replay".into())}
  let checked=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
  if checked["ok"]!=true||checked["result"]["commissioning_file_sha256"]!=candidate.summary["artifact_sha256"]{return Err("Transport input staging readback differs; preserve original intent".into())}
  std::fs::remove_file(intent).map_err(|_|"Transport staging complete; local reconciliation interrupted")?;Ok(applied)
 }.await;dispatch.finish(&result)?;result.map(|_|())
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn transport_reconciliation_refusals_preserve_exact_original_bindings(){
  let initial="a".repeat(64);let pins:Value=["config/node.json","config/start-authorized.json","network/genesis.json","network/authority.json","network/authority-root.pub","network/network-manifest.json","network/transport-registry.json","network/transport-root.pub"].into_iter().map(|name|(name.to_string(),json!("b".repeat(64)))).collect();
  let intent=json!({"authorization_sha256":"c".repeat(64),"summary":{"artifact_sha256":pins}});
  let reply=json!({"ok":true,"result":{"initial_sha256":initial,"authorization":{"sha256":intent["authorization_sha256"]},"commissioning_file_sha256":pins}});
  assert!(transport_reconciliation_status(&reply,&initial,&intent).is_ok());
  for name in pins.as_object().unwrap().keys(){
   let mut changed=reply.clone();changed["result"]["commissioning_file_sha256"][name]=json!("f".repeat(64));
   assert!(transport_reconciliation_status(&changed,&initial,&intent).unwrap_err().starts_with("transport_reconcile_artifacts_mismatch:"));
  }

  for(path,value,code)in[("/ok",json!(false),"status_refused"),("/result/initial_sha256",json!("d".repeat(64)),"initial_mismatch"),("/result/authorization/sha256",json!("e".repeat(64)),"continuation_mismatch"),("/result/commissioning_file_sha256",json!({}),"artifacts_mismatch")]{
   let mut changed=reply.clone();*changed.pointer_mut(path).unwrap()=value;
   let error=transport_reconciliation_status(&changed,&initial,&intent).unwrap_err();
   assert!(error.starts_with(&format!("transport_reconcile_{code}:")));assert!(!error.contains(&initial));
  }
 }
use base64::{engine::general_purpose::STANDARD,Engine as _};
 fn context()->(Value,Value){let doc=json!({"target":{"kind":"remote","host":"host.example","port":22,"root":"/opt/synergy","host_key":"pinned","machine_id_sha256":null},"release_id":"reviewed","manifest_sha256":"a".repeat(64),"network_id":"isolated-network","chain_id":99999,"node_name":"validator-test","artifacts":{"formation-context.json":"b".repeat(64)}});let status=json!({"target":doc["target"],"selection":{"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]},"formation_sha256":"b".repeat(64),"genesis_pins":null,"authorization":{"sequence":3,"sha256":"c".repeat(64)}});(doc,status)}
 #[test]fn continuation_is_exact_short_lived_and_cannot_change_target_release_root_or_formation(){let(doc,status)=context();let req=Request{version:1,operation:"network_formation_sign".into(),parameters:json!({"review_sha256":"d".repeat(64)})};let next=continuation_document(&doc,&status,&req,None,1000).unwrap();assert_eq!(next["sequence"],4);assert_eq!(next["expires_at"],1300);assert_eq!(next["requests"][0]["request_sha256"],req.approval_id());assert_eq!(next["artifacts"],json!({}));for field in["target","selection","formation_sha256"]{let mut wrong=status.clone();wrong[field]=Value::Null;assert!(continuation_document(&doc,&wrong,&req,None,1000).is_err())}let mut bound=status.clone();bound["genesis_pins"]=json!({"authority-root.pub":"a".repeat(64)});assert!(continuation_document(&doc,&bound,&req,Some(&json!({"authority-root.pub":"d".repeat(64)})),1000).is_err());let mut exhausted=status;exhausted["authorization"]["sequence"]=json!((1u64<<53)-1);assert!(continuation_document(&doc,&exhausted,&req,None,1000).is_err());}
 #[test]fn signed_public_export_cannot_substitute_root_artifacts_or_scope(){let(doc,_)=context();let p="a".repeat(64);let g="{\"genesis\":1}\n";let a="{}";let root=vec![9u8;1952];let export=json!({"schema":"nodenetwork-network-formation-export-v1","review_sha256":p,"genesis_sha256":hash(g.as_bytes()),"authority_sha256":hash(a.as_bytes()),"authority_root_sha256":hash(&root),"artifacts":{"genesis.json":g,"authority.json":a,"authority-root.pub":STANDARD.encode(root)}});let receipt=json!({"schema":"nodenetwork-network-formation-v1","pending":true,"signed":true,"network_id":"isolated-network","chain_id":"99999","formation_sha256":"b".repeat(64),"request_sha256":p,"review_sha256":p,"unsigned_genesis_sha256":p,"unsigned_authority_sha256":p,"authority_root_sha256":export["authority_root_sha256"],"genesis_sha256":export["genesis_sha256"],"authority_sha256":export["authority_sha256"],"sign_request_sha256":p,"validator_addresses":(0..5).map(|i|format!("synv1{}",i.to_string().repeat(30))).collect::<Vec<_>>()});assert!(matching_export(&receipt,&export,&doc).is_ok());for field in["review_sha256","genesis_sha256","authority_root_sha256"]{let mut bad=export.clone();bad[field]=json!("e".repeat(64));assert!(matching_export(&receipt,&bad,&doc).is_err())}let mut bad=doc;bad["network_id"]=json!("other-network");assert!(matching_export(&receipt,&export,&bad).is_err());}
}

/// Resolve the independently compiled initial host before a native update review.
pub(super) async fn update_context(base:&Path,target:&Target,control:&Path)->Result<(String,Value,Option<PathBuf>,Value),String>{
 if !cfg!(debug_assertions){return Err("Engineering updates are disabled in production".into())}
 let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];
 if reply["ok"]!=true||status["schema"]!="nodenetwork-engineering-authorization-status-v1"||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Target must reconcile the exact approved initial host authorization".into())}
 continuation_document(&doc,status,&Request{version:1,operation:"stop".into(),parameters:json!({})},None,1)?;
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let context=json!({"initial_sha256":status["initial_sha256"],"parent_sha256":status["authorization"]["sha256"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"expires_at":now+300});
 Ok((record.operator,context,host_pin(control,&doc)?,status["update"].clone()))
}

pub(super) fn pending_update(adoption:&Value,selection:&Value)->bool{
 !adoption.is_null()&&adoption["selection"]!=*selection
}

pub(super) fn same_update_review(before:&Value,after:&Value)->bool{
 ["initial_sha256","parent_sha256","formation_sha256","target","selection"].iter().all(|key|!before[*key].is_null()&&before[*key]==after[*key])
}

#[cfg(test)]mod update_tests{
 use super::*;
 #[test]fn completed_adoption_does_not_block_the_next_release(){
  let old=json!({"release_id":"old","manifest_sha256":"a".repeat(64)});
  let new=json!({"release_id":"new","manifest_sha256":"b".repeat(64)});
  let adoption=json!({"previous_selection":old,"selection":new});
  assert!(!pending_update(&Value::Null,&old));assert!(pending_update(&adoption,&old));assert!(!pending_update(&adoption,&new));
 }
 #[test]fn fresh_update_lease_cannot_change_reviewed_scope(){
  let before=json!({"initial_sha256":"a".repeat(64),"parent_sha256":"b".repeat(64),"formation_sha256":"c".repeat(64),"target":{"host":"exact"},"selection":{"manifest_sha256":"d".repeat(64)},"expires_at":1});
  let mut after=before.clone();after["expires_at"]=json!(1000);assert!(same_update_review(&before,&after));
  for key in ["initial_sha256","parent_sha256","formation_sha256","target","selection"]{let mut changed=after.clone();changed[key]=Value::Null;assert!(!same_update_review(&before,&changed),"{key}");}
 }
 #[test]fn update_continuation_requires_immutable_origin_and_exact_native_adoption(){
  let original=json!({"release_id":"old","manifest_sha256":"a".repeat(64),"network_id":"nodenetwork-formation-disposable-test","chain_id":99999,"node_name":"validator-test"});
  let doc=json!({"target":{"root":"/opt/synergy"},"release_id":"old","manifest_sha256":"a".repeat(64),"network_id":original["network_id"],"chain_id":99999,"node_name":"validator-test","artifacts":{"formation-context.json":"b".repeat(64)}});
  let next=json!({"release_id":"new","manifest_sha256":"c".repeat(64),"network_id":original["network_id"],"chain_id":99999,"node_name":"validator-test"});
  let mut status=json!({"target":doc["target"],"initial_selection":original,"selection":next,"initial_sha256":"d".repeat(64),"formation_sha256":"b".repeat(64),"genesis_pins":null,"authorization":{"sequence":4,"sha256":"e".repeat(64)},"update":{"initial_sha256":"d".repeat(64),"formation_sha256":"b".repeat(64),"previous_selection":original,"selection":next}});
  let request=Request{version:1,operation:"start".into(),parameters:json!({})};
  let document=continuation_document(&doc,&status,&request,None,1000).unwrap();
  assert_eq!(document["release_id"],"new");assert_eq!(document["manifest_sha256"],"c".repeat(64));assert_eq!(document["sequence"],5);
  for key in["initial_selection","update","target"]{let mut bad=status.clone();bad[key]=json!({});assert!(continuation_document(&doc,&bad,&request,None,1000).is_err())}
  status["selection"]["chain_id"]=json!(1);assert!(continuation_document(&doc,&status,&request,None,1000).is_err());
 }
}

#[cfg(test)]mod reinstallation_tests{
 use super::*;
 #[test]fn saved_retry_ticket_cannot_change_incarnation_selection_or_request(){
  let old="a".repeat(64);let selection=json!({"release_id":"exact","manifest_sha256":"b".repeat(64)});let request=json!({"bootstrap":"exact"});
  let ticket=json!({"old_initial_sha256":old,"selection":selection,"bootstrap_request_sha256":hash(request.to_string().as_bytes()),"removal":{"id":"c".repeat(64),"request_sha256":"d".repeat(64)}});
  validate_retry_ticket(&ticket,&old,&selection,&request).unwrap();
  for field in ["old_initial_sha256","selection","bootstrap_request_sha256"]{let mut changed=ticket.clone();changed[field]=Value::Null;assert!(validate_retry_ticket(&changed,&old,&selection,&request).is_err());}
  let mut changed=ticket.clone();changed["extra"]=json!(true);assert!(validate_retry_ticket(&changed,&old,&selection,&request).is_err());
  assert!(validate_retry_ticket(&ticket,&"e".repeat(64),&selection,&request).is_err());assert!(validate_retry_ticket(&ticket,&old,&json!({"other":1}),&request).is_err());
 }
 #[test]fn removal_must_prove_exact_root_no_backup_and_no_remaining_records(){
  let target=Target{kind:"remote".into(),host:Some("example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};
  let good=json!({"version":1,"ok":true,"result":{"removed_root":"/opt/synergy","logical_removal_verified":true,"backup_created":false,"remaining_host_managed_records":[]}});assert!(verify_removal(&target,good.clone()).is_ok());
  for key in["removed_root","logical_removal_verified","backup_created","remaining_host_managed_records"]{let mut bad=good.clone();bad["result"][key]=Value::Null;assert!(verify_removal(&target,bad).is_err(),"{key}");}
  let mut bad=good;bad["result"]["remaining_host_managed_records"]=json!(["account:owned"]);assert!(verify_removal(&target,bad).is_err());
 }
 #[test]fn new_approval_requires_clean_bootstrap_selection_host_and_distinct_formation(){
  let old=json!({"target":{"host":"example","host_key":"original"},"artifacts":{"formation-context.json":"a".repeat(64)}});
  let new=json!({"target":old["target"],"sequence":1,"release_id":"new","manifest_sha256":"b".repeat(64),"network_id":"fresh","chain_id":99999,"node_name":"validator","artifacts":{"formation-context.json":"c".repeat(64)}});
  let ticket=json!({"old_initial_sha256":"d".repeat(64),"bootstrap_request_sha256":"e".repeat(64),"removal":{"id":"f".repeat(64)},"selection":new});let boot=json!({"request_sha256":"e".repeat(64)});
  assert!(replacement_allowed(&old,&new,&ticket,&boot,&"d".repeat(64)).is_ok());
  for key in["target","sequence","release_id","manifest_sha256","network_id","chain_id","node_name","artifacts"]{let mut bad=new.clone();bad[key]=Value::Null;assert!(replacement_allowed(&old,&bad,&ticket,&boot,&"d".repeat(64)).is_err(),"{key}");}
  let mut reused=new.clone();reused["artifacts"]=old["artifacts"].clone();assert!(replacement_allowed(&old,&reused,&ticket,&boot,&"d".repeat(64)).is_err());
  let mut changed=new.clone();changed["target"]["host_key"]=json!("changed");assert!(replacement_allowed(&old,&changed,&ticket,&boot,&"d".repeat(64)).is_err());
  for key in["old_initial_sha256","bootstrap_request_sha256","removal","selection"]{let mut bad=ticket.clone();bad[key]=Value::Null;assert!(replacement_allowed(&old,&new,&bad,&boot,&"d".repeat(64)).is_err());}
 }
}

/// Only an input-free ordinary continuation can be proven undispatched and retired.
pub(super) async fn continuation_recovery(base:&Path,target:&Target,control:&Path)->Result<(String,Value,Option<PathBuf>,String),String>{
 if !cfg!(debug_assertions)||target.kind!="remote"{return Err("Continuation recovery requires an approved remote engineering target".into())}
 let(record,doc)=initial(base,target)?;let path=folder(base)?.join(format!("continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 let raw=String::from_utf8(read(&path,65536)?).map_err(|_|"Invalid pending continuation UTF8")?;
 let pending:Value=serde_json::from_str(&raw).map_err(|_|"Malformed pending continuation")?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true||reply["result"]["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Original native authorization scope is unavailable".into())}
 let status=&reply["result"];
 // Reuse the exact existing target/master/initial-adoption scope validation; no grant is generated.
 continuation_document(&doc,status,&Request{version:1,operation:"restart".into(),parameters:json!({})},None,1)?;
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if pending["artifacts"]!=json!({})||pending["requests"].as_array().is_none_or(|a|a.len()!=1)||pending["target"]!=doc["target"]
  ||pending["sequence"].as_u64()!=status["authorization"]["sequence"].as_u64().and_then(|v|v.checked_add(1))
  ||["release_id","manifest_sha256","network_id","chain_id","node_name"].iter().any(|k|pending[k]!=status["selection"][k]){return Err("Pending continuation differs from the exact predecessor or selection".into())}
 let key=pending["requests"][0]["request_sha256"].as_str().ok_or("Pending request identity absent")?;
 let snapshot=crate::request_journal::undispatched_continuation_snapshot(base,&target.journal_identity(),key)?;
 let context=json!({"initial_sha256":hash(record.document.as_bytes()),"authorization":status["authorization"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"genesis_pins":status["genesis_pins"],"pending_sha256":hash(raw.as_bytes()),"expires_at":now+120});
 let challenge=hash(json!([context,snapshot,now]).to_string().as_bytes());let wire=json!({"context":context,"pending_json":raw,"challenge":challenge});
 Ok((record.operator,wire,host_pin(control,&doc)?,snapshot))
}
pub(super) fn retire_continuation(base:&Path,target:&Target,wire:&Value,proof:&Value,snapshot:&str)->Result<(),String>{
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if wire["context"]["expires_at"].as_u64().is_none_or(|t|t<now||t>now+120){return Err("Continuation proof expired".into())}
 let raw=wire["pending_json"].as_str().ok_or("Pending document unavailable")?;
 let pending:Value=serde_json::from_str(raw).map_err(|_|"Pending document malformed")?;
 let key=pending["requests"][0]["request_sha256"].as_str().ok_or("Pending request identity unavailable")?;
 let expected=json!({"schema":"nodenetwork-continuation-not-applied-v1","challenge":wire["challenge"],"pending_sha256":hash(raw.as_bytes()),"request_sha256":key,"parent_sha256":wire["context"]["authorization"]["sha256"],"not_applied":true,"mutation_performed":false});
 if *proof!=expected||wire["context"]["pending_sha256"]!=hash(raw.as_bytes()){return Err("Continuation proof does not match immutable pending intent".into())}
 let directory=folder(base)?;let path=directory.join(format!("continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 crate::request_journal::with_undispatched_continuation(base,&target.journal_identity(),key,snapshot,||{
  if read(&path,65536)?!=raw.as_bytes(){return Err("Pending continuation changed; no local intent released".into())}
  let receipt=directory.join(format!("continuation-not-applied-{}.json",hash(raw.as_bytes())));
  let mut durable=proof.clone();durable.as_object_mut().ok_or("Malformed proof")?.remove("challenge");
  let evidence=json!({"state":"not_applied","target":target.journal_identity(),"initial_sha256":wire["context"]["initial_sha256"],"pending_json":raw,"proof":durable});
  save_retirement(&receipt,&evidence)?;
  std::fs::File::open(&directory).and_then(|f|f.sync_all()).map_err(|_|"Cannot persist nonapplication receipt")?;
  std::fs::remove_file(&path).and_then(|_|std::fs::File::open(&directory)?.sync_all()).map_err(|_|"Local intent retirement interrupted; reconcile without replay".to_string())
 })
}

// A fresh exact remote proof is required before resuming a torn local receipt write.
// Only the exact canonical prefix may be completed; no file is removed or truncated.
fn save_retirement(path:&Path,value:&Value)->Result<(),String>{
 use std::io::Write;
 let bytes=serde_json::to_vec(value).map_err(|_|"Cannot encode nonapplication receipt")?;
 let old=if path.exists()||path.is_symlink(){read(path,100*1024)?}else{Vec::new()};
 if !bytes.starts_with(&old){return Err("Existing nonapplication receipt differs; preserve pending intent".into())}
 let mut options=std::fs::OpenOptions::new();options.append(true);
 if path.exists(){options.create(false);}else{options.create_new(true);}
 #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600).custom_flags(libc::O_NOFOLLOW);}
 options.open(path).and_then(|mut file|{file.write_all(&bytes[old.len()..])?;file.sync_all()?;
  let mut directory=std::fs::OpenOptions::new();directory.read(true);
  #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;directory.custom_flags(libc::O_NOFOLLOW|libc::O_DIRECTORY);}
  directory.open(path.parent().ok_or_else(||std::io::Error::other("Receipt parent unavailable"))?)?.sync_all()
 }).map_err(|_|"Nonapplication receipt interrupted; obtain a fresh proof before reconciliation".into())
}

#[cfg(test)]mod continuation_reconciliation_tests{
 use super::*;
 #[test]fn treasury_nonapplication_retains_public_receipt_and_rejects_foreign_proof(){
 let(c,t,_,_,_,_)=fixture();let request=Request{version:1,operation:"treasury_send_prepare".into(),parameters:json!({"nonce":0})};
 crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"treasury_send_prepare",&request.canonical()).unwrap().finish(&Err("lost".into())).unwrap();let ticket=||crate::request_journal::treasury_not_applied_ticket(&c.0,&t.journal_identity()).unwrap();let original=ticket().original().clone();let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
 let wire=json!({"original":original,"challenge":"a".repeat(64),"context":{"request_sha256":request.approval_id(),"nonce":0,"authorization":{"sha256":"b".repeat(64)},"expires_at":now+120}});
 let proof=json!({"schema":"nodenetwork-treasury-send-not-applied-v1","challenge":wire["challenge"],"request_sha256":request.approval_id(),"nonce":0,"authorization_sha256":"b".repeat(64),"not_applied":true,"mutation_performed":false});
 for key in ["request_sha256","challenge","authorization_sha256"]{let mut bad=proof.clone();bad[key]=json!("f".repeat(64));assert!(retire_treasury_prepare(&c.0,&t,&wire,&bad,ticket()).is_err());}
 let mut foreign=wire.clone();foreign["context"]["request_sha256"]=json!("f".repeat(64));let mut forged=proof.clone();forged["request_sha256"]=json!("f".repeat(64));assert!(retire_treasury_prepare(&c.0,&t,&foreign,&forged,ticket()).is_err());
 let path=folder(&c.0).unwrap().join(format!("treasury-not-applied-{}.json",original["id"].as_str().unwrap()));let mut durable=proof.clone();durable.as_object_mut().unwrap().remove("challenge");let expected=json!({"state":"not_applied","target":t.journal_identity(),"original":original,"authorization_sha256":"b".repeat(64),"proof":durable}).to_string();
 use std::io::Write;let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}options.open(&path).unwrap().write_all(&expected.as_bytes()[..17]).unwrap();
 retire_treasury_prepare(&c.0,&t,&wire,&proof,ticket()).unwrap();assert_eq!(read(&path,65536).unwrap(),expected.as_bytes());assert_eq!(crate::request_journal::inspect(&c.0).unwrap()["records"][0]["state"],"verified_treasury_prepare_not_applied");
 }
 fn commission_fixture()->(Cleanup,Target,Value,Value){
  let(c,t,_,_,_,_)=fixture();let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let pin="a".repeat(64);let stage=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":pin});
  crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"authorization_stage",&stage).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();std::thread::sleep(std::time::Duration::from_millis(3));
  crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"commission",&request.canonical()).unwrap().finish(&Err("lost".into())).unwrap();
  let ticket=crate::request_journal::commission_not_applied_ticket(&c.0,&t.journal_identity()).unwrap();let original=ticket.original();let at=original["recorded_at_ms"].as_u64().unwrap()/1000;let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
  let template=json!({"version":1,"sequence":14,"expires_at":at+300,"target":{"host":"pinned.example"},"artifacts":{},"requests":[{"operation":"commission","request_sha256":request.approval_id()}]});
  let wire=json!({"context":{"authorization":{"sha256":hash(template.to_string().as_bytes()),"sequence":14,"expires_at":at+300},"request_sha256":request.approval_id(),"expires_at":now+120},"document_template":template,"original":original,"challenge":ticket.challenge()});
  let proof=json!({"schema":"nodenetwork-commission-not-applied-v1","challenge":wire["challenge"],"request_sha256":request.approval_id(),"authorization_sha256":wire["context"]["authorization"]["sha256"],"readiness_sha256":pin,"not_applied":true,"mutation_performed":false});(c,t,wire,proof)
 }
 #[test]fn commission_reconciliation_binds_original_authorization_and_successful_readiness(){
  let(c,t,wire,proof)=commission_fixture();let ticket=||crate::request_journal::commission_not_applied_ticket(&c.0,&t.journal_identity()).unwrap();
  for field in ["challenge","request_sha256","authorization_sha256","readiness_sha256","not_applied","mutation_performed"]{let mut bad=proof.clone();bad[field]=Value::Null;assert!(retire_commission(&c.0,&t,&wire,&bad,ticket()).is_err());}
  let mut foreign=proof.clone();foreign["readiness_sha256"]=json!("b".repeat(64));assert!(retire_commission(&c.0,&t,&wire,&foreign,ticket()).is_err());
  let mut stale=wire.clone();stale["context"]["expires_at"]=json!(1);assert!(retire_commission(&c.0,&t,&stale,&proof,ticket()).is_err());
  // Only exact original grant encoding is recovered; no future authority or nonce.
  assert!(original_commission_document(&wire,proof["readiness_sha256"].as_str().unwrap()).is_ok());
  for delta in [301u64,601]{let mut changed=wire.clone();let at=wire["original"]["recorded_at_ms"].as_u64().unwrap()/1000;changed["context"]["authorization"]["expires_at"]=json!(at+delta);assert!(original_commission_document(&changed,"a").is_err());}
  let mut changed=wire.clone();changed["document_template"]["sequence"]=json!(15);assert!(original_commission_document(&changed,"a").is_err());
  let raw=original_commission_document(&wire,proof["readiness_sha256"].as_str().unwrap()).unwrap();let receipt=folder(&c.0).unwrap().join(format!("commission-not-applied-{}.json",wire["original"]["id"].as_str().unwrap()));let mut durable=proof.clone();durable.as_object_mut().unwrap().remove("challenge");let value=json!({"state":"not_applied","target":t.journal_identity(),"original":wire["original"],"authorization_json":raw,"proof":durable});let bytes=value.to_string();
  use std::io::Write;let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}options.open(&receipt).unwrap().write_all(&bytes.as_bytes()[..17]).unwrap();
  retire_commission(&c.0,&t,&wire,&proof,ticket()).unwrap();assert_eq!(read(&receipt,65536).unwrap(),bytes.as_bytes());let records=crate::request_journal::inspect(&c.0).unwrap();assert_eq!(records["records"][0]["state"],"verified_commission_not_applied");assert_eq!(records["records"][0]["response_ok"],false);
  let old=ticket();std::thread::sleep(std::time::Duration::from_millis(3));crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"register",&json!({})).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();assert!(retire_commission(&c.0,&t,&wire,&proof,old).is_err());
 }
 #[test]fn readiness_intent_reader_preserves_documents_above_four_kib_and_rejects_over_bound(){
  let(c,t,_,_,_,_)=fixture();let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let dispatch=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":"a".repeat(64)});
  let mut value=json!({"authorization_sha256":"b".repeat(64),"request_sha256":request.approval_id(),"artifact_sha256":"a".repeat(64),"dispatch_sha256":hash(dispatch.to_string().as_bytes()),"document":"x".repeat(8192),"parent_sha256":"c".repeat(64)});let path=readiness_intent(&c.0,&t).unwrap();save(&path,&value).unwrap();assert_eq!(read_readiness_intent(&c.0,&t).unwrap(),value);
  std::fs::remove_file(&path).unwrap();value["document"]=json!("x".repeat(65536));save(&path,&value).unwrap();assert!(read_readiness_intent(&c.0,&t).is_err());
 }
 #[test]fn readiness_original_document_is_exact_hash_recovered_not_reminted(){
  let doc=json!({"release_id":"sealed","manifest_sha256":"a".repeat(64),"network_id":"network","chain_id":99999,"node_name":"validator","target":{"host":"pinned"},"artifacts":{"formation-context.json":"b".repeat(64)}});
  let selection=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});
  let status=json!({"authorization":{"sequence":14,"sha256":"c".repeat(64)},"target":doc["target"],"initial_selection":selection,"selection":selection,"formation_sha256":doc["artifacts"]["formation-context.json"],"genesis_pins":{"genesis.json":"d".repeat(64)}});
  let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let mut original=continuation_document(&doc,&status,&request,None,1000).unwrap();original["artifacts"]=json!({"commissioning-readiness.json":"e".repeat(64)});let raw=original.to_string();
  let dispatch=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":"e".repeat(64)});
  let legacy=json!({"authorization_sha256":hash(raw.as_bytes()),"request_sha256":request.approval_id(),"artifact_sha256":"e".repeat(64),"dispatch_sha256":hash(dispatch.to_string().as_bytes())});
  assert_eq!(original_readiness_document(&doc,&status,&legacy,1000054).unwrap(),raw);
  assert_eq!(original_readiness_document(&doc,&status,&legacy,1300054).unwrap(),raw); // Inclusive fixed 300s historical window.
  for time in [999999,1301000,u64::MAX]{assert!(original_readiness_document(&doc,&status,&legacy,time).is_err());}
  let mut newer=status.clone();newer["authorization"]["sequence"]=json!(15);assert!(original_readiness_document(&doc,&newer,&legacy,1000054).is_err());
  for field in ["target","formation_sha256","selection","genesis_pins"]{let mut changed=status.clone();changed[field]=Value::Null;assert!(original_readiness_document(&doc,&changed,&legacy,1000054).is_err());}
  let mut complete=legacy.clone();complete["document"]=json!(raw);complete["parent_sha256"]=status["authorization"]["sha256"].clone();assert_eq!(original_readiness_document(&doc,&status,&complete,0).unwrap(),raw);
  let mut changed=status;changed["authorization"]["sha256"]=json!("f".repeat(64));assert!(original_readiness_document(&doc,&changed,&complete,1000054).is_err());
  let mut bad=legacy;bad["artifact_sha256"]=json!("f".repeat(64));assert!(original_readiness_document(&doc,&changed,&bad,1000054).is_err());
 }
 #[test]fn readiness_nonapplication_is_false_durable_and_cas_fenced(){
  let(c,t,_,_,_,_)=fixture();let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let dispatch=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":"a".repeat(64)});let key=hash(dispatch.to_string().as_bytes());
  crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"authorization_stage",&dispatch).unwrap().finish(&Err("lost".into())).unwrap();
  let raw="original public authorization";let intent=json!({"authorization_sha256":hash(raw.as_bytes()),"request_sha256":request.approval_id(),"artifact_sha256":"a".repeat(64),"dispatch_sha256":key});let path=readiness_intent(&c.0,&t).unwrap();save(&path,&intent).unwrap();
  let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();let wire=json!({"intent":intent,"pending_json":raw,"challenge":"c".repeat(64),"context":{"pending_sha256":hash(raw.as_bytes()),"dispatch_sha256":key,"authorization":{"sha256":"d".repeat(64)},"expires_at":now+120}});
  let proof=json!({"schema":"nodenetwork-readiness-not-applied-v1","challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"dispatch_sha256":key,"parent_sha256":"d".repeat(64),"not_applied":true,"mutation_performed":false});
  let ticket=||crate::request_journal::readiness_not_applied_ticket(&c.0,&t.journal_identity(),&key).unwrap();
  for field in ["schema","challenge","parent_sha256","dispatch_sha256","pending_sha256","mutation_performed"]{let mut bad=proof.clone();bad[field]=Value::Null;assert!(retire_readiness(&c.0,&t,&wire,&bad,ticket()).is_err());assert!(path.exists());}
  let mut stale=wire.clone();stale["context"]["expires_at"]=json!(1);assert!(retire_readiness(&c.0,&t,&stale,&proof,ticket()).is_err());
  // A torn local public receipt resumes only after another fresh authenticated proof.
  let receipt=folder(&c.0).unwrap().join(format!("readiness-not-applied-{}.json",hash(raw.as_bytes())));let mut durable=proof.clone();durable.as_object_mut().unwrap().remove("challenge");let value=json!({"state":"not_applied","target":t.journal_identity(),"intent":intent,"pending_json":raw,"proof":durable});let bytes=value.to_string();
  use std::io::Write;let mut options=std::fs::OpenOptions::new();options.create_new(true).write(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}options.open(&receipt).unwrap().write_all(&bytes.as_bytes()[..17]).unwrap();
  retire_readiness(&c.0,&t,&wire,&proof,ticket()).unwrap();assert!(!path.exists());assert_eq!(read(&receipt,65536).unwrap(),bytes.as_bytes());
  let rows=crate::request_journal::inspect(&c.0).unwrap();assert_eq!(rows["records"][0]["state"],"verified_readiness_not_applied");assert_eq!(rows["records"][0]["response_ok"],false);
  save(&path,&intent).unwrap();let old=ticket();crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"register",&json!({})).unwrap().finish(&Ok(json!({"ok":true}))).unwrap();assert!(retire_readiness(&c.0,&t,&wire,&proof,old).is_err());assert!(path.exists());
 }
 #[test]fn readiness_refusal_is_visible_but_never_proof_of_nonapplication(){
  assert!(readiness_ack(&json!({"ok":false,"error":{"message":"private data"}}),"expected").unwrap_err().contains("authenticated controller"));
  assert!(!readiness_ack(&json!({"ok":false,"error":{"message":"private data"}}),"expected").unwrap_err().contains("private data"));
  let good=json!({"ok":true,"result":{"sha256":"expected","applied":true,"grants_recreated":false}});assert!(readiness_ack(&good,"expected").is_ok());
  for field in ["sha256","applied","grants_recreated"]{let mut bad=good.clone();bad["result"][field]=Value::Null;assert!(readiness_ack(&bad,"expected").unwrap_err().contains("uncertain"));}
 }
 #[test]fn transport_retirement_preserves_intent_receipt_and_rejects_forged_or_stale_proof(){
  let(c,t,_,_,_,_)=fixture();let request=json!({"operation":"commission","artifact_sha256":{"public":"a".repeat(64)}});let key=hash(request.to_string().as_bytes());
  crate::request_journal::Dispatch::begin(&c.0,&t.journal_identity(),"authorization_stage",&request).unwrap().finish(&Err("lost".into())).unwrap();
  let intent=json!({"authorization_sha256":"b".repeat(64),"dispatch_sha256":key,"summary":{"artifact_sha256":request["artifact_sha256"]}});let path=transport_intent(&c.0,&t).unwrap();save(&path,&intent).unwrap();
  let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();let wire=json!({"intent":intent,"challenge":"c".repeat(64),"context":{"pending_sha256":"b".repeat(64),"dispatch_sha256":key,"authorization":{"sha256":"d".repeat(64)},"expires_at":now+120}});
  let proof=json!({"schema":"nodenetwork-transport-not-applied-v1","challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"dispatch_sha256":key,"parent_sha256":"d".repeat(64),"not_applied":true,"mutation_performed":false});
  let ticket=||crate::request_journal::transport_not_applied_ticket(&c.0,&t.journal_identity(),&key).unwrap();
  let mut forged=proof.clone();forged["mutation_performed"]=json!(true);assert!(retire_transport(&c.0,&t,&wire,&forged,ticket()).is_err());assert!(path.exists());
  let mut stale=wire.clone();stale["context"]["expires_at"]=json!(1);assert!(retire_transport(&c.0,&t,&stale,&proof,ticket()).is_err());assert!(path.exists());
  // A failed journal commit leaves the original intent. A canonical torn public
  // receipt can be completed only after this fresh proof and unchanged CAS.
  let receipt=folder(&c.0).unwrap().join(format!("transport-not-applied-{}.json","b".repeat(64)));
  let mut durable=proof.clone();durable.as_object_mut().unwrap().remove("challenge");let value=json!({"state":"not_applied","target":t.journal_identity(),"intent":intent,"proof":durable});save(&receipt,&value).unwrap();std::fs::OpenOptions::new().write(true).open(&receipt).unwrap().set_len(21).unwrap();
  retire_transport(&c.0,&t,&wire,&proof,ticket()).unwrap();assert!(!path.exists());assert_eq!(serde_json::from_slice::<Value>(&read(&receipt,65536).unwrap()).unwrap(),value);
  let rows=crate::request_journal::inspect(&c.0).unwrap();assert_eq!(rows["records"][0]["state"],"verified_transport_not_applied");assert_eq!(rows["records"][0]["response_ok"],false);
  // Crash after false journal write but before unlink is reconciled by a fresh proof.
  save(&path,&intent).unwrap();let mut refreshed=wire.clone();refreshed["challenge"]=json!("e".repeat(64));let mut fresh_proof=proof;fresh_proof["challenge"]=refreshed["challenge"].clone();retire_transport(&c.0,&t,&refreshed,&fresh_proof,ticket()).unwrap();assert!(!path.exists());
 }

 struct Cleanup(PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
 fn fixture()->(Cleanup,Target,Value,Value,String,PathBuf){
  static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-continuation-proof-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));std::fs::create_dir(&base).unwrap();
  let target:Target=serde_json::from_value(json!({"kind":"remote","host":"pinned.example","port":22,"root":"/opt/synergy"})).unwrap();
  let raw=json!({"requests":[{"operation":"genesis_stage","request_sha256":"a".repeat(64)}]}).to_string();
  let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
  let wire=json!({"pending_json":raw,"challenge":"b".repeat(64),"context":{"pending_sha256":hash(raw.as_bytes()),"initial_sha256":"c".repeat(64),"authorization":{"sha256":"d".repeat(64)},"expires_at":now+120}});
  let proof=json!({"schema":"nodenetwork-continuation-not-applied-v1","challenge":wire["challenge"],"pending_sha256":wire["context"]["pending_sha256"],"request_sha256":"a".repeat(64),"parent_sha256":"d".repeat(64),"not_applied":true,"mutation_performed":false});
  let directory=folder(&base).unwrap();let path=directory.join(format!("continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));save(&path,&serde_json::from_str::<Value>(&raw).unwrap()).unwrap();
  let snapshot=crate::request_journal::undispatched_continuation_snapshot(&base,&target.journal_identity(),&"a".repeat(64)).unwrap();
  (Cleanup(base),target,wire,proof,snapshot,path)
 }
 #[test]fn continuation_reconciliation_retains_not_success_evidence_and_resumes_exact_torn_receipt(){
  let(c,t,w,p,s,path)=fixture();let receipt=path.parent().unwrap().join(format!("continuation-not-applied-{}.json",w["context"]["pending_sha256"].as_str().unwrap()));
  let mut durable=p.clone();durable.as_object_mut().unwrap().remove("challenge");let value=json!({"state":"not_applied","target":t.journal_identity(),"initial_sha256":w["context"]["initial_sha256"],"pending_json":w["pending_json"],"proof":durable});
  let bytes=serde_json::to_vec(&value).unwrap();let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}use std::io::Write;options.open(&receipt).unwrap().write_all(&bytes[..19]).unwrap();
  retire_continuation(&c.0,&t,&w,&p,&s).unwrap();assert!(!path.exists());assert_eq!(read(&receipt,100*1024).unwrap(),bytes);
  assert!(retire_continuation(&c.0,&t,&w,&p,&s).is_err());
 }
 #[test]fn continuation_reconciliation_refuses_changed_intent_stale_or_forged_proof_and_serializes_stage(){
  let(c,t,w,p,s,path)=fixture();let lock=continuation_lock(&c.0,&t).unwrap();assert!(continuation_lock(&c.0,&t).is_err());drop(lock);let _again=continuation_lock(&c.0,&t).unwrap();
  let mut bad=p.clone();bad["mutation_performed"]=json!(true);assert!(retire_continuation(&c.0,&t,&w,&bad,&s).is_err());assert!(path.exists());
  let mut stale=w.clone();stale["context"]["expires_at"]=json!(1);assert!(retire_continuation(&c.0,&t,&stale,&p,&s).is_err());
  std::fs::write(&path,b"changed").unwrap();assert!(retire_continuation(&c.0,&t,&w,&p,&s).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"changed");
 }
}

/// A read-only verification receipt, not an upgrade dispatch or completion.
pub(super) fn remember_unused_upgrade(base:&Path,target:&Target,wire:&Value,proof:&Value)->Result<(),String>{
 let expected=json!({"schema":"nodenetwork-upgrade-not-applied-v1","challenge":wire["challenge"],"request_sha256":hash(wire["request"].to_string().as_bytes()),"old_manifest_sha256":wire["context"]["selection"]["manifest_sha256"],"candidate_manifest_sha256":wire["request"]["parameters"]["manifest_sha256"],"not_applied":true,"mutation_performed":false});
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 if wire["unused"]!=true||*proof!=expected||wire["context"]["expires_at"].as_u64().is_none_or(|t|t<now||t>now+300)||target.journal_identity().as_object().is_none_or(|fields|fields.iter().any(|(k,v)|wire["context"]["target"][k]!=*v)){return Err("Unused upgrade proof differs; no receipt recorded".into())}
 let mut durable=proof.clone();durable.as_object_mut().ok_or("Invalid unused proof")?.remove("challenge");
 let receipt=json!({"state":"not_applied","upgrade_dispatched":false,"target":target.journal_identity(),"initial_sha256":wire["context"]["initial_sha256"],"adoption":wire["adoption"],"request":wire["request"],"proof":durable});
 let path=folder(base)?.join(format!("unused-upgrade-not-applied-{}-{}-{}.json",hash(target.journal_identity().to_string().as_bytes()),wire["context"]["initial_sha256"].as_str().ok_or("Initial identity unavailable")?,expected["request_sha256"].as_str().ok_or("Request identity unavailable")?));
 save_retirement(&path,&receipt)?;std::fs::File::open(path.parent().ok_or("Receipt directory unavailable")?).and_then(|f|f.sync_all()).map_err(|_|"Cannot persist unused upgrade proof".into())
}

#[cfg(test)]mod unused_upgrade_receipt_tests{
 use super::*;
 #[test]fn unused_upgrade_receipt_is_not_success_and_binds_host_origin_and_immutable_request(){
  let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-unused-upgrade-{}",std::process::id()));std::fs::create_dir(&base).unwrap();struct Clean(PathBuf);impl Drop for Clean{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _clean=Clean(base.clone());
  let target:Target=serde_json::from_value(json!({"kind":"remote","host":"host.example","port":22,"root":"/opt/synergy"})).unwrap();
  let request=json!({"version":1,"operation":"upgrade","parameters":{"release_id":"unused","manifest_sha256":"b".repeat(64)}});
  let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();let wire=json!({"unused":true,"challenge":"c".repeat(64),"request":request,"adoption":{"selection":request["parameters"]},"context":{"target":target.journal_identity(),"initial_sha256":"d".repeat(64),"selection":{"manifest_sha256":"a".repeat(64)},"expires_at":now+300}});
  let proof=json!({"schema":"nodenetwork-upgrade-not-applied-v1","challenge":wire["challenge"],"request_sha256":hash(request.to_string().as_bytes()),"old_manifest_sha256":"a".repeat(64),"candidate_manifest_sha256":"b".repeat(64),"not_applied":true,"mutation_performed":false});
  let mut bad=proof.clone();bad["not_applied"]=json!(false);assert!(remember_unused_upgrade(&base,&target,&wire,&bad).is_err());let mut foreign=target.clone();foreign.host=Some("foreign".into());assert!(remember_unused_upgrade(&base,&foreign,&wire,&proof).is_err());
  remember_unused_upgrade(&base,&target,&wire,&proof).unwrap();remember_unused_upgrade(&base,&target,&wire,&proof).unwrap();
  let records:Vec<_>=std::fs::read_dir(folder(&base).unwrap()).unwrap().collect();assert_eq!(records.len(),1);let saved:Value=serde_json::from_slice(&read(&records[0].as_ref().unwrap().path(),100*1024).unwrap()).unwrap();assert_eq!(saved["state"],"not_applied");assert_eq!(saved["upgrade_dispatched"],false);assert_eq!(saved["request"],request);
 }
}

#[cfg(test)]mod runtime_probe_scope_tests{
 use super::*;
 #[test]fn runtime_probe_scope_binds_initial_target_network_and_existing_pins(){
  let pin="a".repeat(64);let mut doc=json!({"target":{"host":"approved"},"network_id":"synergy-posy-canary-test","chain_id":99999,"artifacts":{"commissioning/network/transport-registry.json":pin}});
  let status=json!({"schema":"nodenetwork-engineering-authorization-status-v1","initial_sha256":pin,"target":doc["target"],"selection":{"network_id":doc["network_id"],"chain_id":99999},"genesis_pins":{"genesis.json":pin,"authority.json":pin,"authority-root.pub":pin},"commissioning_file_sha256":{"network/transport-registry.json":pin,"network/transport-root.pub":pin,"network/network-manifest.json":pin}});
  assert_eq!(runtime_probe_origin_scope(&doc,&pin,&status).unwrap()["origin_pins"]["transport-registry.json"],pin);
  for field in ["initial_sha256","target","selection","genesis_pins"]{let mut bad=status.clone();bad[field]=Value::Null;assert!(runtime_probe_origin_scope(&doc,&pin,&bad).is_err())}
  let scope=runtime_probe_origin_scope(&doc,&pin,&status).unwrap();assert_eq!(scope["origin_pins"]["transport-root.pub"],pin);assert_eq!(scope["origin_pins"]["network-manifest.json"],pin);
  doc["artifacts"]["commissioning/network/transport-registry.json"]=json!("b".repeat(64));assert!(runtime_probe_origin_scope(&doc,&pin,&status).is_err());
 }
}
