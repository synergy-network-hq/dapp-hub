//! Debug-only explicit engineering continuations. No renderer policy or custody.
use crate::{node_controller::{self,Target,Request},operator_authorization as authorization};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields)]struct Initial{document:String,operator:String}
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
pub(super) fn remember(base:&Path,target:&Target,operator:&str,p:&authorization::Prepared)->Result<(),String>{
 authorization::verify_initial(&p.document,target)?;crate::node_bootstrap::validate_operator(operator)?;
 save(&folder(base)?.join(name(target)),&json!({"document":p.document,"operator":operator}))
}
fn initial(base:&Path,target:&Target)->Result<(Initial,Value),String>{
 let raw=read(&folder(base)?.join(name(target)),100*1024)?;
 let record:Initial=serde_json::from_slice(&raw).map_err(|_|"Invalid initial native authorization receipt")?;
 let document=authorization::verify_initial(&record.document,target)?;crate::node_bootstrap::validate_operator(&record.operator)?;Ok((record,document))
}
pub(super) fn bare_initial(base:&Path,target:&Target)->Result<Option<String>,String>{
 let path=base.join("nodenetwork-engineering-v1").join(name(target));
 if !path.exists()&&!path.is_symlink(){return Ok(None)}
 initial(base,target).map(|(record,_)|Some(record.document))
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
 let path=folder(base)?.join(name(&target));
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
pub(super) async fn grant(base:&Path,target:&Target,request:&Request,control:&Path,pins:Option<&Value>)->Result<(),String>{
 if !cfg!(debug_assertions){return Ok(())} // Normal production still requires its pre-existing independent grant.
 let path=folder(base)?.join(name(target));if !path.exists(){return Ok(())}
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
 save(&intent,&next)?;
 let expected=hash(next.to_string().as_bytes());
 let prepared=authorization::continuation(next,target,&hash(record.document.as_bytes()),status["authorization"]["sha256"].as_str().ok_or("No authorization parent")?,status["formation_sha256"].as_str().ok_or("No approved formation")?)?;
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
 if !cfg!(debug_assertions)||!folder(base)?.join(name(target)).exists(){return Ok(())}
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
pub(super) async fn signed_source(base:&Path,target:&Target,control:&Path)->Result<Option<SignedSource>,String>{
 if !cfg!(debug_assertions)||!folder(base)?.join(name(target)).exists(){return Ok(None)}
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
 if !cfg!(debug_assertions)||!folder(base)?.join(name(target)).exists(){return Ok(false)}
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

pub(super) async fn reconcile_readiness(base:&Path,target:&Target,control:&Path)->Result<Option<Value>,String>{
 let intent=folder(base)?.join(format!("readiness-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 if !intent.exists()&&!intent.is_symlink(){return Ok(None)}
 let old:Value=serde_json::from_slice(&read(&intent,4096)?).map_err(|_|"Malformed readiness intent")?;
 if !old.as_object().is_some_and(|o|o.len()==4&&["authorization_sha256","request_sha256","artifact_sha256","dispatch_sha256"].iter().all(|k|o.get(*k).and_then(Value::as_str).is_some_and(|v|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))))){return Err("Malformed original readiness intent commitments".into())}
 let(record,_)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true||reply["result"]["initial_sha256"]!=hash(record.document.as_bytes())||reply["result"]["authorization"]["sha256"]!=old["authorization_sha256"]{return Err("Original readiness authorization is not independently confirmed; preserve the intent without replay".into())}
 let dispatch=old["dispatch_sha256"].as_str().ok_or("Missing original readiness dispatch commitment")?;
 crate::request_journal::reconcile_verified(base,&target.journal_identity(),"authorization_stage",dispatch)?;
 std::fs::remove_file(intent).map_err(|_|"Readiness confirmed; local reconciliation interrupted")?;Ok(Some(old))
}

pub(super) async fn readiness_grant(base:&Path,target:&Target,control:&Path,bytes:&[u8])->Result<(),String>{
 if !cfg!(debug_assertions){return Err("Readiness approval is isolated engineering only".into())}
 let request=Request{version:1,operation:"commission".into(),parameters:json!({})};let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];if reply["ok"]!=true||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Readiness target lacks its original independent authorization".into())}
 let artifact:Value=serde_json::from_slice(bytes).map_err(|_|"Invalid readiness artifact")?;
 let own=artifact["observations"].as_array().and_then(|v|v.iter().find(|v|v["target"]==doc["target"])).ok_or("Readiness lacks the exact commissioning target")?;
 if own["manifest_sha256"]!=status["selection"]["manifest_sha256"]||own["formation_sha256"]!=status["formation_sha256"]{return Err("Commissioning target release or formation changed after collection".into())}
 let intent=folder(base)?.join(format!("readiness-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes())));
 if intent.exists()||intent.is_symlink(){return Err("Readiness staging outcome is uncertain; inspect the original authorization without restaging".into())}
 let next=continuation_document(&doc,status,&request,None,SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs())?;
 let prepared=authorization::readiness_continuation(next,target,&hash(record.document.as_bytes()),status["authorization"]["sha256"].as_str().ok_or("Missing authorization parent")?,status["formation_sha256"].as_str().ok_or("Missing formation")?,bytes)?;
 let expected=prepared.sha256.clone();let dispatch_request=json!({"operation":"commission","request_sha256":request.approval_id(),"artifact_sha256":hash(bytes)});let dispatch=crate::request_journal::Dispatch::begin(base,&target.journal_identity(),"authorization_stage",&dispatch_request)?;
 let result=async{
  save(&intent,&json!({"authorization_sha256":expected,"request_sha256":request.approval_id(),"artifact_sha256":hash(bytes),"dispatch_sha256":hash(dispatch_request.to_string().as_bytes())}))?;
  let result=authorization::execute(target.clone(),record.operator,prepared,control).await?;
  if result["ok"]!=true||result["result"]["sha256"]!=expected||result["result"]["applied"]!=true||result["result"]["grants_recreated"]!=false{return Err("Readiness authorization outcome uncertain or refused; never replay".into())}
  std::fs::remove_file(&intent).map_err(|_|"Readiness applied; local reconciliation interrupted")?;Ok(result)
 }.await;
 dispatch.finish(&result)?;result.map(|_|())
}

fn transport_intent(base:&Path,target:&Target)->Result<PathBuf,String>{Ok(folder(base)?.join(format!("transport-continuation-{}.json",hash(target.journal_identity().to_string().as_bytes()))))}
pub(super) async fn reconcile_transport(base:&Path,target:&Target,control:&Path)->Result<Option<Value>,String>{
 let intent=transport_intent(base,target)?;if !intent.exists()&&!intent.is_symlink(){return Ok(None)}
 let old:Value=serde_json::from_slice(&read(&intent,64*1024)?).map_err(|_|"Invalid original transport staging receipt")?;
 let(record,_)=initial(base,target)?;let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if reply["ok"]!=true||reply["result"]["initial_sha256"]!=hash(record.document.as_bytes())||reply["result"]["authorization"]["sha256"]!=old["authorization_sha256"]||reply["result"]["commissioning_file_sha256"]!=old["summary"]["artifact_sha256"]{return Err("Transport staging uncertain; original exact target receipt does not confirm it; do not restage".into())}
 let current=crate::transport_staging::candidate(base,target,control).await?;
 if current.summary!=old["summary"]{return Err("Original signed coordinator or exact bound target changed before reconciliation".into())}
 crate::request_journal::reconcile_verified(base,&target.journal_identity(),"authorization_stage",old["dispatch_sha256"].as_str().ok_or("Missing original transport dispatch")?)?;
 std::fs::remove_file(intent).map_err(|_|"Transport staging confirmed; local receipt cleanup interrupted")?;Ok(Some(old["summary"].clone()))
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
 use super::*;use base64::{engine::general_purpose::STANDARD,Engine as _};
 fn context()->(Value,Value){let doc=json!({"target":{"kind":"remote","host":"host.example","port":22,"root":"/opt/synergy","host_key":"pinned","machine_id_sha256":null},"release_id":"reviewed","manifest_sha256":"a".repeat(64),"network_id":"isolated-network","chain_id":99999,"node_name":"validator-test","artifacts":{"formation-context.json":"b".repeat(64)}});let status=json!({"target":doc["target"],"selection":{"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]},"formation_sha256":"b".repeat(64),"genesis_pins":null,"authorization":{"sequence":3,"sha256":"c".repeat(64)}});(doc,status)}
 #[test]fn continuation_is_exact_short_lived_and_cannot_change_target_release_root_or_formation(){let(doc,status)=context();let req=Request{version:1,operation:"network_formation_sign".into(),parameters:json!({"review_sha256":"d".repeat(64)})};let next=continuation_document(&doc,&status,&req,None,1000).unwrap();assert_eq!(next["sequence"],4);assert_eq!(next["expires_at"],1300);assert_eq!(next["requests"][0]["request_sha256"],req.approval_id());assert_eq!(next["artifacts"],json!({}));for field in["target","selection","formation_sha256"]{let mut wrong=status.clone();wrong[field]=Value::Null;assert!(continuation_document(&doc,&wrong,&req,None,1000).is_err())}let mut bound=status.clone();bound["genesis_pins"]=json!({"authority-root.pub":"a".repeat(64)});assert!(continuation_document(&doc,&bound,&req,Some(&json!({"authority-root.pub":"d".repeat(64)})),1000).is_err());let mut exhausted=status;exhausted["authorization"]["sequence"]=json!((1u64<<53)-1);assert!(continuation_document(&doc,&exhausted,&req,None,1000).is_err());}
 #[test]fn signed_public_export_cannot_substitute_root_artifacts_or_scope(){let(doc,_)=context();let p="a".repeat(64);let g="{\"genesis\":1}\n";let a="{}";let root=vec![9u8;1952];let export=json!({"schema":"nodenetwork-network-formation-export-v1","review_sha256":p,"genesis_sha256":hash(g.as_bytes()),"authority_sha256":hash(a.as_bytes()),"authority_root_sha256":hash(&root),"artifacts":{"genesis.json":g,"authority.json":a,"authority-root.pub":STANDARD.encode(root)}});let receipt=json!({"schema":"nodenetwork-network-formation-v1","pending":true,"signed":true,"network_id":"isolated-network","chain_id":"99999","formation_sha256":"b".repeat(64),"request_sha256":p,"review_sha256":p,"unsigned_genesis_sha256":p,"unsigned_authority_sha256":p,"authority_root_sha256":export["authority_root_sha256"],"genesis_sha256":export["genesis_sha256"],"authority_sha256":export["authority_sha256"],"sign_request_sha256":p,"validator_addresses":(0..5).map(|i|format!("synv1{}",i.to_string().repeat(30))).collect::<Vec<_>>()});assert!(matching_export(&receipt,&export,&doc).is_ok());for field in["review_sha256","genesis_sha256","authority_root_sha256"]{let mut bad=export.clone();bad[field]=json!("e".repeat(64));assert!(matching_export(&receipt,&bad,&doc).is_err())}let mut bad=doc;bad["network_id"]=json!("other-network");assert!(matching_export(&receipt,&export,&bad).is_err());}
}

/// Resolve the independently compiled initial host before a native update review.
pub(super) async fn update_context(base:&Path,target:&Target,control:&Path)->Result<(String,Value,Option<PathBuf>),String>{
 if !cfg!(debug_assertions){return Err("Engineering updates are disabled in production".into())}
 let(record,doc)=initial(base,target)?;
 let reply=execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 let status=&reply["result"];
 if reply["ok"]!=true||status["schema"]!="nodenetwork-engineering-authorization-status-v1"||status["initial_sha256"]!=hash(record.document.as_bytes()){return Err("Target must reconcile the exact approved initial host authorization".into())}
 continuation_document(&doc,status,&Request{version:1,operation:"stop".into(),parameters:json!({})},None,1)?;
 let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_secs();
 let context=json!({"initial_sha256":status["initial_sha256"],"parent_sha256":status["authorization"]["sha256"],"formation_sha256":status["formation_sha256"],"target":doc["target"],"selection":status["selection"],"expires_at":now+300});
 Ok((record.operator,context,host_pin(control,&doc)?))
}

#[cfg(test)]mod update_tests{
 use super::*;
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
