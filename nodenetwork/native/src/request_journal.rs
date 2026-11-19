//! Local dispatch evidence only: never a target job, approval or replay queue.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};

const MAX_RECORDS: usize = 256;
const MAX_BYTES: u64 = 4096;
static SERIAL: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    version: u8,
    id: String,
    target_digest: String,
    request_digest: String,
    operation: String,
    recorded_at_ms: u64,
    observed_at_ms: Option<u64>,
    state: String,
    response_ok: Option<bool>,
}

impl Record {
    pub(super) fn request_digest(&self) -> &str { &self.request_digest }
}

fn digest(value: &Value) -> String { format!("{:x}", Sha256::digest(value.to_string().as_bytes())) }
fn pin(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
fn journaled_operation(operation: &str) -> bool { matches!(operation, "authorization_stage" | "update_stage" | "bare_bootstrap_rollback" | "bootstrap" | "install" | "identity_generate" | "network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "treasury_send_prepare" | "treasury_send_submit" | "guest_create" | "guest_resume" | "guest_stop" | "guest_remove" | "formation_prepare" | "genesis_stage" | "genesis_bind" | "commission" | "register" | "vpn_enroll" | "vpn_stop" | "vpn_resume" | "boot_policy" | "start" | "stop" | "restart" | "upgrade" | "uninstall") }

fn now() -> Result<u64, String> {
    SystemTime::now().duration_since(UNIX_EPOCH).ok().and_then(|d| u64::try_from(d.as_millis()).ok())
        .ok_or_else(|| "Request journal clock is unavailable; no mutation was dispatched.".into())
}
fn failure() -> String { "Local NodeNetwork request journal is unavailable or unsupported. Existing records are retained; no new mutation is authorized by this journal.".into() }

struct WriterLock(PathBuf);
impl WriterLock {
    fn acquire(directory: &Path) -> Result<Self, String> {
        let path = directory.with_file_name("nodenetwork-requests-v1.lock");
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        options.open(&path).and_then(|file| file.sync_all()).map_err(|_| "Local request journal writer is busy or interrupted. The lock is retained after an interruption; no automatic clearing or mutation replay is allowed.".to_string())?;
        Ok(Self(path))
    }
}
impl Drop for WriterLock { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }

// An application-owned path only. Renderer input never selects this directory.
fn directory(base: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    if !cfg!(unix) || !base.is_absolute() || base.components().any(|p| matches!(p, Component::ParentDir | Component::CurDir)) { return Err(failure()); }
    let path = base.join("nodenetwork-requests-v1");
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.is_dir() => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            _ => return Err(failure()),
        }
    }
    if !path.try_exists().map_err(|_| failure())? {
        if !create { return Ok(None); }
        #[cfg(unix)] {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().recursive(true).mode(0o700).create(&path).map_err(|_| failure())?;
        }
    }
    for ancestor in path.ancestors() {
        if !fs::symlink_metadata(ancestor).is_ok_and(|m| m.is_dir()) { return Err(failure()); }
    }
    #[cfg(unix)] {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let meta = fs::symlink_metadata(&path).map_err(|_| failure())?;
        let parent = fs::metadata(base).map_err(|_| failure())?;
        if meta.uid() != parent.uid() || meta.permissions().mode() & 0o077 != 0 { return Err(failure()); }
    }
    Ok(Some(path))
}

fn load(path: &Path) -> Result<Vec<Record>, String> {
    let mut records = Vec::new();
    for entry in fs::read_dir(path).map_err(|_| failure())? {
        if records.len() >= MAX_RECORDS { return Err(failure()); }
        let entry = entry.map_err(|_| failure())?;
        let name = entry.file_name().into_string().map_err(|_| failure())?;
        if !name.ends_with(".json") || !pin(name.trim_end_matches(".json")) { return Err(failure()); }
        let before = fs::symlink_metadata(entry.path()).map_err(|_| failure())?;
        if !before.is_file() || before.len() > MAX_BYTES { return Err(failure()); }
        let file = fs::File::open(entry.path()).map_err(|_| failure())?;
        let after = file.metadata().map_err(|_| failure())?;
        #[cfg(unix)] {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            let owner = fs::metadata(path).map_err(|_| failure())?.uid();
            if before.ino() != after.ino() || before.dev() != after.dev() || after.nlink() != 1 || after.uid() != owner || after.permissions().mode() & 0o077 != 0 { return Err(failure()); }
        }
        if !after.is_file() { return Err(failure()); }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| failure())?;
        if bytes.len() as u64 > MAX_BYTES { return Err(failure()); }
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| failure())?;
        let operation = journaled_operation(&record.operation);
        let state = match record.state.as_str() {
            "dispatch_intent" => record.observed_at_ms.is_none() && record.response_ok.is_none(),
            "uncertain" => record.observed_at_ms.is_some() && record.response_ok.is_none(),
            "response_received" => record.observed_at_ms.is_some() && record.response_ok.is_some(),
            "verified_guest_resume_stopped" => record.operation=="guest_resume"&&record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms)&&record.response_ok==Some(false),
            "verified_transport_not_applied" | "verified_readiness_not_applied" => record.operation=="authorization_stage"&&record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms)&&record.response_ok==Some(false),
            "verified_treasury_prepare_not_applied" => record.operation=="treasury_send_prepare"&&record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms)&&record.response_ok==Some(false),
            "verified_commission_not_applied" => record.operation=="commission"&&record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms)&&record.response_ok==Some(false),
            "verified_upgrade_not_applied" => record.operation=="upgrade"&&record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms)&&record.response_ok==Some(false),
            "verified_bootstrap_absence" => record.operation=="bootstrap" && record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms) && record.response_ok.is_none(),
            "verified_target_outcome" => record.observed_at_ms.is_some() && record.response_ok==Some(true) && matches!(record.operation.as_str(),"vpn_stop"|"vpn_resume"|"boot_policy"|"authorization_stage"|"update_stage"|"identity_generate"|"network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "treasury_send_prepare" | "treasury_send_submit" | "guest_create" | "guest_resume" | "guest_stop" | "formation_prepare"|"genesis_stage"|"genesis_bind"),
            _ => false,
        };
        if record.version != 1 || name != format!("{}.json", record.id) || !pin(&record.id) || !pin(&record.target_digest) || !pin(&record.request_digest) || !operation || !state { return Err(failure()); }
        records.push(record);
    }
    records.sort_by(|a,b| b.recorded_at_ms.cmp(&a.recorded_at_ms).then(a.id.cmp(&b.id)));
    Ok(records)
}

fn write(path: &Path, record: &Record, new: bool) -> Result<(), String> {
    let destination = path.join(format!("{}.json", record.id));
    // A pending file is intentionally retained on interrupted writes. An unknown
    // directory entry fails closed on the next read instead of discarding evidence.
    let temporary = path.join(format!("{}.pending", record.id));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    if new && destination.try_exists().map_err(|_| failure())? { return Err(failure()); }
    let mut file = options.open(&temporary).map_err(|_| failure())?;
    let bytes = serde_json::to_vec(record).map_err(|_| failure())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| failure())?;
    fs::rename(&temporary, &destination).map_err(|_| failure())?;
    fs::File::open(path).and_then(|d| d.sync_all()).map_err(|_| failure())
}

pub(super) fn scoped_digest(base:&Path,target:&Value)->Result<String,String>{
    let incarnation=crate::authorization_lifecycle::incarnation(base,target)?;
    Ok(digest(&incarnation.map(|pin|json!({"target":target,"initial_sha256":pin})).unwrap_or_else(||target.clone())))
}
/// A terminal response is used only with a subsequently successful clean bootstrap.
/// Unknown/partial/newer operations never count as removal or bootstrap evidence.
pub(super) fn with_latest_success<T>(base:&Path,target:&Value,operation:&str,apply:impl FnOnce(Value)->Result<T,String>)->Result<T,String>{
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let path=directory(base,false)?.ok_or_else(failure)?;
    let _writer=WriterLock::acquire(&path)?;
    let scope=scoped_digest(base,target)?;
    let records=load(&path)?;
    let scoped=records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>();
    if scoped.iter().any(|r|matches!(r.state.as_str(),"dispatch_intent"|"uncertain")){return Err("An original incarnation operation is uncertain; preserve and reconcile it before replacement".into())}
    let record=scoped.first().ok_or_else(failure)?;
    if record.recorded_at_ms>now()?||scoped.iter().skip(1).any(|r|r.recorded_at_ms==record.recorded_at_ms)||record.operation!=operation||record.state!="response_received"||record.response_ok!=Some(true){return Err("The latest native operation is not unambiguously the required successful terminal outcome; reconcile without resetting history".into())}
    apply(json!({"id":record.id,"request_sha256":record.request_digest}))
}

/// A short-lived CAS ticket, never an approval or a replay instruction.
pub(super) struct BootstrapAbsence {
    id:String, scope:String, request:String, reviewed_request:String, recorded:u64, observed:u64,
    snapshot:String, issued:std::time::Instant,
}
fn bootstrap_candidate(records:&[Record],scope:&str)->Result<Option<&'static str>,String>{
    let scoped=records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>();
    let pending=scoped.iter().filter(|r|matches!(r.state.as_str(),"dispatch_intent"|"uncertain")).collect::<Vec<_>>();
    if pending.is_empty(){return Ok(None)}
    let latest=scoped.first().ok_or_else(failure)?;let clock=now()?;
    if pending.len()!=1||latest.id!=pending[0].id||latest.state!="uncertain"||latest.operation!="bootstrap"
        ||latest.recorded_at_ms>clock||latest.observed_at_ms.is_none_or(|at|at>clock)
        ||scoped.iter().skip(1).any(|r|r.recorded_at_ms>=latest.recorded_at_ms){
        return Err("Only the exact latest uncertain bootstrap can be reconciled; other operations remain fenced.".into())
    }
    Ok(Some("exact uncertain bootstrap"))
}
fn snapshot(records:&[Record],scope:&str)->Result<String,String>{
    Ok(digest(&serde_json::to_value(records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>()).map_err(|_|failure())?))
}
pub(super) fn undispatched_continuation_snapshot(base:&Path,target:&Value,key:&str)->Result<String,String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let path=directory(base,true)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&path)?;
 let scope=scoped_digest(base,target)?;let records=load(&path)?;
 require_undispatched(&records,&scope,key)?;Ok(digest(&json!([scope,key,snapshot(&records,&scope)?])))
}
fn require_undispatched(records:&[Record],scope:&str,key:&str)->Result<(),String>{
 if !pin(key)||records.iter().any(|r|r.target_digest==scope&&(r.request_digest==key||matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))){return Err("Pending continuation has dispatched or uncertain operation evidence; no release is permitted".into())}Ok(())
}
pub(super) fn with_undispatched_continuation<T>(base:&Path,target:&Value,key:&str,expected:&str,apply:impl FnOnce()->Result<T,String>)->Result<T,String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let path=directory(base,true)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&path)?;
 let scope=scoped_digest(base,target)?;let records=load(&path)?;require_undispatched(&records,&scope,key)?;
 if digest(&json!([scope,key,snapshot(&records,&scope)?]))!=expected{return Err("Continuation journal changed during review; no local intent released".into())}apply()
}
pub(super) fn bootstrap_absence_candidate(base:&Path,target:&Value,request:&Value)->Result<Option<BootstrapAbsence>,String>{
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let Some(path)=directory(base,false)?else{return Ok(None)};
    let _writer=WriterLock::acquire(&path)?;
    let scope=scoped_digest(base,target)?;let records=load(&path)?;let request=digest(request);
    if bootstrap_candidate(&records,&scope)?.is_none(){return Ok(None)}
    let r=records.iter().find(|r|r.target_digest==scope).ok_or_else(failure)?;
    Ok(Some(BootstrapAbsence{id:r.id.clone(),scope:scope.clone(),request:r.request_digest.clone(),reviewed_request:request,recorded:r.recorded_at_ms,observed:r.observed_at_ms.ok_or_else(failure)?,snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now()}))
}
impl BootstrapAbsence {
    pub(super) fn original_request_sha256(&self)->&str{&self.request}
    pub(super) fn challenge(&self)->String{digest(&json!([self.id,self.scope,self.request,self.reviewed_request,self.recorded,self.observed,now().unwrap_or(0),std::process::id()]))}
}
pub(super) fn verify_bootstrap_absence(base:&Path,target:&Value,request:&Value,ticket:BootstrapAbsence)->Result<(),String>{
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let path=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&path)?;
    let scope=scoped_digest(base,target)?;let mut records=load(&path)?;let request=digest(request);
    if ticket.issued.elapsed()>std::time::Duration::from_secs(120)||scope!=ticket.scope||request!=ticket.reviewed_request
        ||snapshot(&records,&scope)?!=ticket.snapshot||bootstrap_candidate(&records,&scope)?.is_none(){return Err("Bootstrap absence proof is stale or its journal changed; no outcome was reconciled.".into())}
    let r=records.iter_mut().find(|r|r.id==ticket.id).ok_or_else(failure)?;
    if r.request_digest!=ticket.request||r.recorded_at_ms!=ticket.recorded||r.observed_at_ms!=Some(ticket.observed){return Err(failure())}
    let observed=now()?;if observed<ticket.observed||observed<r.recorded_at_ms{return Err("Bootstrap reconciliation clock moved backwards; journal remains uncertain".into())}
    r.state="verified_bootstrap_absence".into();r.observed_at_ms=Some(observed);
    // Explicit verified absence is neither success nor custody completion.
    write(&path,r,false)
}

pub(super) struct CommissionNotApplied{id:String,scope:String,request:String,readiness_dispatch:String,recorded_at_ms:u64,snapshot:String,issued:std::time::Instant}
fn untouched_commission<'a>(records:&'a [Record],scope:&str)->Result<(&'a Record,&'a Record),String>{
 let current=records.iter().find(|r|r.target_digest==scope).ok_or_else(failure)?;
 let request=digest(&json!({"version":1,"operation":"commission","parameters":{}}));
 if current.operation!="commission"||current.request_digest!=request||!((current.state=="uncertain"&&current.response_ok.is_none())||(current.state=="verified_commission_not_applied"&&current.response_ok==Some(false)))||!current.observed_at_ms.is_some_and(|at|at>=current.recorded_at_ms){return Err(failure())}
 if records.iter().any(|r|r.target_digest==scope&&r.id!=current.id&&(r.recorded_at_ms>=current.recorded_at_ms||matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))){return Err(failure())}
 let prior=records.iter().find(|r|r.target_digest==scope&&r.id!=current.id).ok_or_else(failure)?;
 if prior.operation!="authorization_stage"||!matches!(prior.state.as_str(),"response_received"|"verified_target_outcome")||prior.response_ok!=Some(true)||!prior.observed_at_ms.is_some_and(|at|at>=prior.recorded_at_ms&&at<current.recorded_at_ms)||records.iter().any(|r|r.target_digest==scope&&r.id!=prior.id&&r.id!=current.id&&r.recorded_at_ms>=prior.recorded_at_ms){return Err(failure())}
 Ok((current,prior))
}
pub(super) fn commission_not_applied_ticket(base:&Path,target:&Value)->Result<CommissionNotApplied,String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;let records=load(&directory)?;let scope=scoped_digest(base,target)?;
 let(current,prior)=untouched_commission(&records,&scope)?;
 Ok(CommissionNotApplied{id:current.id.clone(),scope:scope.clone(),request:current.request_digest.clone(),readiness_dispatch:prior.request_digest.clone(),recorded_at_ms:current.recorded_at_ms,snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now()})
}
impl CommissionNotApplied{
 pub(super) fn original(&self)->Value{json!({"id":self.id,"target_digest":self.scope,"request_sha256":self.request,"recorded_at_ms":self.recorded_at_ms,"readiness_dispatch_sha256":self.readiness_dispatch})}
 pub(super) fn challenge(&self)->String{digest(&json!([self.id,self.scope,self.request,self.snapshot,now().unwrap_or(0)]))}
 pub(super) fn accepts_readiness(&self,pin:&str)->bool{self.readiness_dispatch==digest(&json!({"operation":"commission","request_sha256":self.request,"artifact_sha256":pin}))}
}
pub(super) fn verify_commission_not_applied(base:&Path,target:&Value,ticket:CommissionNotApplied,commit:impl FnOnce()->Result<(),String>)->Result<(),String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;let records=load(&directory)?;let scope=scoped_digest(base,target)?;
 if ticket.issued.elapsed()>std::time::Duration::from_secs(120)||scope!=ticket.scope||snapshot(&records,&scope)?!=ticket.snapshot{return Err(failure())}
 let(current,prior)=untouched_commission(&records,&scope)?;if current.id!=ticket.id||current.request_digest!=ticket.request||prior.request_digest!=ticket.readiness_dispatch{return Err(failure())}
 let observed=now()?;if observed<current.observed_at_ms.unwrap_or(current.recorded_at_ms){return Err(failure())}
 commit()?;let mut record=current.clone();record.state="verified_commission_not_applied".into();record.response_ok=Some(false);record.observed_at_ms=Some(observed);write(&directory,&record,false)
}

pub(super) struct UpgradeNotApplied {id:String,scope:String,request:String,snapshot:String,issued:std::time::Instant}
fn untouched_upgrade<'a>(records:&'a [Record],scope:&str,id:&str,request:&str)->Result<&'a Record,String>{
 let found=records.iter().find(|r|r.id==id&&r.target_digest==scope&&r.operation=="upgrade"&&r.request_digest==request&&r.state=="uncertain"&&r.response_ok.is_none()&&r.observed_at_ms.is_some_and(|v|v>=r.recorded_at_ms)).ok_or_else(failure)?;
 if records.iter().any(|r|r.target_digest==scope&&r.id!=id&&(r.recorded_at_ms>=found.recorded_at_ms||matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))){return Err(failure())}Ok(found)
}
pub(super) fn upgrade_not_applied_ticket(base:&Path,target:&Value,id:&str,request:&Value)->Result<UpgradeNotApplied,String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;
 let records=load(&directory)?;let scope=scoped_digest(base,target)?;let request=digest(request);
 untouched_upgrade(&records,&scope,id,&request)?;
 Ok(UpgradeNotApplied{id:id.into(),scope:scope.clone(),request,snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now()})
}
impl UpgradeNotApplied {pub(super) fn challenge(&self)->String{digest(&json!([self.id,self.scope,self.request,self.snapshot,now().unwrap_or(0)]))}}
pub(super) fn verify_upgrade_not_applied(base:&Path,target:&Value,request:&Value,ticket:UpgradeNotApplied)->Result<(),String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;
 let mut records=load(&directory)?;let scope=scoped_digest(base,target)?;
 if ticket.issued.elapsed()>std::time::Duration::from_secs(120)||scope!=ticket.scope||digest(request)!=ticket.request||snapshot(&records,&scope)?!=ticket.snapshot{return Err(failure())}
 untouched_upgrade(&records,&scope,&ticket.id,&ticket.request)?;
 let record=records.iter_mut().find(|r|r.id==ticket.id).ok_or_else(failure)?;let observed=now()?;
 if observed<record.observed_at_ms.unwrap_or(record.recorded_at_ms){return Err(failure())}
 record.state="verified_upgrade_not_applied".into();record.response_ok=Some(false);record.observed_at_ms=Some(observed);write(&directory,record,false)
}

pub(super) struct TransportNotApplied {id:String,scope:String,request:String,snapshot:String,issued:std::time::Instant,recorded_at_ms:u64,readiness:bool}
fn untouched_transport<'a>(records:&'a [Record],scope:&str,request:&str,readiness:bool)->Result<&'a Record,String>{
 let state=if readiness{"verified_readiness_not_applied"}else{"verified_transport_not_applied"};
 let found=records.iter().find(|r|r.target_digest==scope&&r.operation=="authorization_stage"&&r.request_digest==request&&((r.state=="uncertain"&&r.response_ok.is_none())||(r.state==state&&r.response_ok==Some(false)))&&r.observed_at_ms.is_some_and(|at|at>=r.recorded_at_ms)).ok_or_else(failure)?;
 if records.iter().any(|r|r.target_digest==scope&&r.id!=found.id&&(r.recorded_at_ms>=found.recorded_at_ms||matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))){return Err(failure())}Ok(found)
}
pub(super) fn transport_not_applied_ticket(base:&Path,target:&Value,request:&str)->Result<TransportNotApplied,String>{stage_not_applied_ticket(base,target,request,false)}
pub(super) fn readiness_not_applied_ticket(base:&Path,target:&Value,request:&str)->Result<TransportNotApplied,String>{stage_not_applied_ticket(base,target,request,true)}
fn stage_not_applied_ticket(base:&Path,target:&Value,request:&str,readiness:bool)->Result<TransportNotApplied,String>{
 if !pin(request){return Err(failure())}let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;
 let records=load(&directory)?;let scope=scoped_digest(base,target)?;let record=untouched_transport(&records,&scope,request,readiness)?;
 Ok(TransportNotApplied{id:record.id.clone(),scope:scope.clone(),request:request.into(),snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now(),recorded_at_ms:record.recorded_at_ms,readiness})
}
impl TransportNotApplied{pub(super) fn recorded_at_ms(&self)->u64{self.recorded_at_ms} pub(super) fn challenge(&self)->String{digest(&json!([self.id,self.scope,self.request,self.snapshot,now().unwrap_or(0)]))}}
pub(super) fn verify_transport_not_applied(base:&Path,target:&Value,request:&str,ticket:TransportNotApplied,commit:impl FnOnce()->Result<(),String>)->Result<(),String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;let scope=scoped_digest(base,target)?;let mut records=load(&directory)?;
 if ticket.issued.elapsed()>std::time::Duration::from_secs(120)||scope!=ticket.scope||request!=ticket.request||snapshot(&records,&scope)?!=ticket.snapshot{return Err(failure())}
 let record=untouched_transport(&records,&scope,request,ticket.readiness)?;if record.id!=ticket.id{return Err(failure())}
 let observed=now()?;if observed<record.observed_at_ms.unwrap_or(record.recorded_at_ms){return Err(failure())}
 commit()?;let record=records.iter_mut().find(|r|r.id==ticket.id).ok_or_else(failure)?;
 record.state=if ticket.readiness{"verified_readiness_not_applied"}else{"verified_transport_not_applied"}.into();record.response_ok=Some(false);record.observed_at_ms=Some(observed);write(&directory,record,false)
}

/// Replacement is authorized by a fresh remote full proof, not by this local
/// false-state marker. This ticket only binds that independently verified operation
/// to the exact prior journal record and prevents concurrent local dispatch.
pub(super) struct UpdateReplacement {scope:String,old_request:String,old_stage:String,unused:bool,new_request:String,snapshot:String,issued:std::time::Instant}
fn replaceable_upgrade<'a>(records:&'a [Record],scope:&str,request:&str)->Result<&'a Record,String>{
 let record=records.iter().find(|r|r.target_digest==scope&&r.operation=="upgrade"&&r.request_digest==request&&r.state=="verified_upgrade_not_applied"&&r.response_ok==Some(false)&&r.observed_at_ms.is_some_and(|at|at>=r.recorded_at_ms)).ok_or("Different staged update requires its exact verified non-application proof")?;
 let clock=now()?;
 if record.observed_at_ms.is_none_or(|at|at>clock)||records.iter().any(|r|r.target_digest==scope&&r.id!=record.id&&(r.recorded_at_ms>=record.recorded_at_ms||matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))){return Err(failure())}Ok(record)
}
fn unused_staged_upgrade<'a>(records:&'a [Record],scope:&str,stage:&str,upgrade:&str)->Result<&'a Record,String>{
 let record=records.iter().find(|r|r.target_digest==scope&&r.operation=="update_stage"&&r.request_digest==stage&&matches!(r.state.as_str(),"response_received"|"verified_target_outcome")&&r.response_ok==Some(true)&&r.observed_at_ms.is_some_and(|at|at>=r.recorded_at_ms&&at<=now().unwrap_or(0))).ok_or("Unused replacement requires exact completed original staging")?;
 if records.iter().any(|r|r.target_digest==scope&&(r.request_digest==upgrade||matches!(r.state.as_str(),"dispatch_intent"|"uncertain")||r.id!=record.id&&r.recorded_at_ms>=record.recorded_at_ms)){return Err("Original upgrade was dispatched or staging scope changed; unused proof refused".into())}Ok(record)
}
pub(super) fn update_replacement_ticket(base:&Path,target:&Value,old_request:&Value,new_request:&Value)->Result<UpdateReplacement,String>{
 if old_request["operation"]!="upgrade"||new_request["operation"]!="update_stage"||old_request["parameters"]["release_id"]==new_request["parameters"]["release_id"]||old_request["parameters"]["manifest_sha256"]==new_request["parameters"]["manifest_sha256"]{return Err(failure())}
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;
 let records=load(&directory)?;let scope=scoped_digest(base,target)?;let old_stage=digest(&json!({"version":1,"operation":"update_stage","parameters":old_request["parameters"]}));let old_request=digest(old_request);
 let unused=replaceable_upgrade(&records,&scope,&old_request).is_err();if unused{unused_staged_upgrade(&records,&scope,&old_stage,&old_request)?;}
 Ok(UpdateReplacement{scope:scope.clone(),old_request,old_stage,unused,new_request:digest(new_request),snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now()})
}
impl UpdateReplacement {pub(super) fn unused(&self)->bool{self.unused} pub(super) fn challenge(&self)->String{digest(&json!([self.scope,self.old_request,self.old_stage,self.unused,self.new_request,self.snapshot,now().unwrap_or(0)]))}}

pub(super) struct BootstrapRetry{scope:String,request:String,snapshot:String}
/// Only a contiguous, strictly ordered prefix of exact verified absences may
/// precede the saved successful-uninstall ticket. No other records are skipped.
pub(super) fn bootstrap_retry(base:&Path,target:&Value,request:&Value,removal:&Value)->Result<Option<BootstrapRetry>,String>{
    let _serial=SERIAL.lock().map_err(|_|failure())?;let path=directory(base,false)?.ok_or_else(failure)?;
    let _writer=WriterLock::acquire(&path)?;let records=load(&path)?;let scope=scoped_digest(base,target)?;
    let scoped=records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>();
    if scoped.first().is_none_or(|r|r.state!="verified_bootstrap_absence"){return Ok(None)}
    let clock=now()?;let request=digest(request);
    if scoped.len()<2||scoped.iter().any(|r|matches!(r.state.as_str(),"uncertain"|"dispatch_intent"))
        ||removal.as_object().is_none_or(|m|m.len()!=2)||!removal["id"].as_str().is_some_and(pin)||!removal["request_sha256"].as_str().is_some_and(pin){return Err(failure())}
    let count=scoped.iter().take_while(|r|r.state=="verified_bootstrap_absence").count();
    let uninstall=scoped.get(count).ok_or("Saved removal is absent behind the verified absence prefix")?;
    if scoped[..count].iter().any(|r|r.operation!="bootstrap"||r.request_digest!=request||r.recorded_at_ms>clock||r.observed_at_ms.is_none_or(|at|at<r.recorded_at_ms||at>clock))
        ||uninstall.operation!="uninstall"||uninstall.state!="response_received"||uninstall.response_ok!=Some(true)
        ||removal["id"]!=uninstall.id||removal["request_sha256"]!=uninstall.request_digest
        ||scoped[..=count].windows(2).any(|pair|pair[0].recorded_at_ms<=pair[1].observed_at_ms.unwrap_or(u64::MAX))
        ||scoped.iter().skip(count+1).any(|r|r.recorded_at_ms>=uninstall.recorded_at_ms){return Err("Saved reinstall ticket is not directly preceded by only exact, strictly ordered verified bootstrap absences".into())}
    Ok(Some(BootstrapRetry{scope:scope.clone(),request,snapshot:snapshot(&records,&scope)?}))
}

pub(super) fn require_resumable_scope(base:&Path,target:&Value)->Result<(),String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;
 let Some(path)=directory(base,false)? else{return Ok(())};let _writer=WriterLock::acquire(&path)?;
 let scope=scoped_digest(base,target)?;let records=load(&path)?;
 if records.iter().any(|r|r.target_digest==scope&&matches!(r.state.as_str(),"dispatch_intent"|"uncertain")){return Err("Read and reconcile the original unresolved outcome before another grant or dispatch".into())}
 if records.len()>=MAX_RECORDS{return Err("Local request journal is full; no new service-policy grant was staged".into())}Ok(())
}

pub struct Dispatch { directory: PathBuf, record: Record }
impl Dispatch {
    /// Caller must validate the typed target/request and obtain native consent first.
    pub fn begin(base: &Path, target: &Value, operation: &str, request: &Value) -> Result<Self, String> {Self::begin_checked(base,target,operation,request,None)}
    pub(super) fn begin_bootstrap(base:&Path,target:&Value,request:&Value,retry:Option<BootstrapRetry>)->Result<Self,String>{Self::begin_checked(base,target,"bootstrap",request,retry)}
    #[cfg(test)]
    pub(super) fn begin_digest(base:&Path,target:&Value,operation:&str,request_digest:String)->Result<Self,String>{
        if !pin(&request_digest){return Err(failure());}
        Self::begin_with_digest(base,target,operation,request_digest,None,None,None)
    }
    fn begin_checked(base:&Path,target:&Value,operation:&str,request:&Value,retry:Option<BootstrapRetry>)->Result<Self,String>{
        Self::begin_with_digest(base,target,operation,digest(request),retry,None,None)
    }
    pub(crate) fn begin_guest_stop(base:&Path,target:&Value,request:&Value,resume_request:&Value)->Result<Self,String>{
        if request["operation"]!="guest_stop"||resume_request["operation"]!="guest_resume"||request["parameters"]["guest_id"]!=resume_request["parameters"]["guest_id"]||!resume_request["parameters"]["create_request_sha256"].as_str().is_some_and(pin)||!resume_request["parameters"]["resume_sequence"].as_u64().is_some_and(|v|(1..=128).contains(&v)){return Err(failure())}
        Self::begin_with_digest(base,target,"guest_stop",digest(request),None,Some(&digest(resume_request)),None)
    }
    pub(super) fn begin_update_replacement(base:&Path,target:&Value,request:&Value,ticket:UpdateReplacement)->Result<Self,String>{
        Self::begin_with_digest(base,target,"update_stage",digest(request),None,None,Some(ticket))
    }
    fn begin_with_digest(base:&Path,target:&Value,operation:&str,request_digest:String,retry:Option<BootstrapRetry>,guest_stop:Option<&str>,replacement:Option<UpdateReplacement>)->Result<Self,String>{
        let _serial = SERIAL.lock().map_err(|_| failure())?;
        if !matches!(operation, "authorization_stage" | "update_stage" | "bare_bootstrap_rollback" | "bootstrap" | "install" | "identity_generate" | "network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "treasury_send_prepare" | "treasury_send_submit" | "guest_create" | "guest_resume" | "guest_stop" | "guest_remove" | "formation_prepare" | "genesis_stage" | "genesis_bind" | "commission" | "register" | "vpn_enroll" | "vpn_stop" | "vpn_resume" | "boot_policy" | "start" | "stop" | "restart" | "upgrade" | "uninstall") { return Err(failure()); }
        let directory = directory(base, true)?.ok_or_else(failure)?;
        let _writer = WriterLock::acquire(&directory)?;
        let records = load(&directory)?;
        let target_digest = scoped_digest(base,target)?;
        if let Some(ticket)=replacement{
            if operation!="update_stage"||ticket.issued.elapsed()>std::time::Duration::from_secs(120)||target_digest!=ticket.scope||request_digest!=ticket.new_request||snapshot(&records,&target_digest)?!=ticket.snapshot{return Err("Staged replacement journal changed; no update was sent".into())}
            if ticket.unused{unused_staged_upgrade(&records,&target_digest,&ticket.old_stage,&ticket.old_request)?;}else{replaceable_upgrade(&records,&target_digest,&ticket.old_request)?;}
        }
        if let Some(ticket)=retry{if operation!="bootstrap"||target_digest!=ticket.scope||request_digest!=ticket.request||snapshot(&records,&target_digest)?!=ticket.snapshot{return Err("Reinstallation retry journal changed; no bootstrap was sent".into())}}
        let pending:Vec<_>=records.iter().filter(|r|r.target_digest==target_digest&&matches!(r.state.as_str(),"dispatch_intent"|"uncertain")).collect();
        let permitted=if let Some(resume)=guest_stop {
            if pending.is_empty(){None}else{
                if operation!="guest_stop"||pending.len()!=1||pending[0].operation!="guest_resume"||pending[0].state!="uncertain"||pending[0].request_digest!=resume{return Err(failure())}
                let latest:Vec<_>=records.iter().filter(|r|r.target_digest==target_digest&&r.recorded_at_ms>=pending[0].recorded_at_ms).collect();
                if latest.len()!=1{return Err(failure())}Some(pending[0].id.as_str())
            }
        }else{None};
        if pending.iter().any(|r|Some(r.id.as_str())!=permitted) {
            return Err("An earlier local dispatch for this target has an uncertain outcome. Reconcile the target through a qualified procedure before another mutation; Portal will not replay or clear it automatically.".into());
        }
        if records.len() >= MAX_RECORDS { return Err("Local request journal is full. Records are retained; another mutation requires an approved retention procedure.".into()); }
        let recorded_at_ms = now()?;
        let id = digest(&json!([target_digest, request_digest, recorded_at_ms, std::process::id(), records.len()]));
        let record = Record { version: 1, id, target_digest, request_digest, operation: operation.into(), recorded_at_ms, observed_at_ms: None, state: "dispatch_intent".into(), response_ok: None };
        write(&directory, &record, true)?;
        Ok(Self { directory, record })
    }
    /// A valid response is local transport evidence, never remote job completion.
    pub fn finish(mut self, result: &Result<Value, String>) -> Result<(), String> {
        let _serial = SERIAL.lock().map_err(|_| failure())?;
        let _writer = WriterLock::acquire(&self.directory)?;
        let records = load(&self.directory)?;
        let recorded=records.iter().find(|r| r.id==self.record.id).ok_or_else(failure)?;
        // A read from another Portal process may already have confirmed durable
        // completion while the original transport response was still in flight.
        if recorded.state=="verified_target_outcome" {return Ok(());}
        if recorded.state!="dispatch_intent" {return Err(failure());}
        self.record.observed_at_ms = Some(now()?);
        self.record.response_ok = result.as_ref().ok().filter(|v| v["version"] == 1).and_then(|v| v["ok"].as_bool());
        self.record.state = if self.record.response_ok.is_some() { "response_received" } else { "uncertain" }.into();
        write(&self.directory, &self.record, false)
    }
}

/// No retries, clearing, or inferred failure. A target status can reconcile
/// only the matching original custody preparation, Genesis staging or Genesis bind.
pub(crate) fn reconcile_verified(base:&Path,target:&Value,operation:&str,request_digest:&str)->Result<bool,String>{
    if !matches!(operation,"vpn_stop"|"vpn_resume"|"boot_policy"|"authorization_stage"|"update_stage"|"identity_generate"|"network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "treasury_send_prepare" | "treasury_send_submit" | "guest_create" | "guest_resume" | "guest_stop" | "formation_prepare"|"genesis_stage"|"genesis_bind")||!pin(request_digest){return Err(failure());}
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let Some(directory)=directory(base,false)? else{return Ok(false);};
    let _writer=WriterLock::acquire(&directory)?;
    let target_digest=scoped_digest(base,target)?;
    let Some(mut record)=load(&directory)?.into_iter().find(|r|r.target_digest==target_digest&&r.operation==operation&&r.request_digest==request_digest&&matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))else{return Ok(false);};
    record.state="verified_target_outcome".into();
    record.observed_at_ms=Some(now()?);
    record.response_ok=Some(true);
    write(&directory,&record,false)?;
    Ok(true)
}

fn inspect_records(base: &Path) -> Result<Vec<Record>, String> {
    let _serial = SERIAL.lock().map_err(|_| failure())?;
    let lock = base.join("nodenetwork-requests-v1.lock");
    match fs::symlink_metadata(&lock) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        _ => return Err("Local request journal writer is busy or interrupted. History is unavailable; no empty state is inferred.".into()),
    }
    match directory(base, false)? { Some(path) => load(&path), None => Ok(Vec::new()) }
}

#[derive(Clone, Copy)]
pub(super) enum CustodyReceiptKind { GenesisStaging, GenesisBinding, Formation, Identity }

impl CustodyReceiptKind {
    pub(super) fn operation(self) -> &'static str {
        match self { Self::GenesisStaging => "genesis_stage", Self::GenesisBinding => "genesis_bind", Self::Formation => "formation_prepare", Self::Identity => "identity_generate" }
    }

    pub(super) fn label(self) -> &'static str {
        match self { Self::GenesisStaging => "Genesis staging", Self::GenesisBinding => "Genesis binding", Self::Formation => "formation preparation", Self::Identity => "identity preparation" }
    }
}

pub(super) fn unresolved_custody_receipt(base: &Path, target: &Value, record_id: &str, kind: CustodyReceiptKind) -> Result<Record, String> {
    unresolved_dispatch(base,target,record_id,kind.operation(),kind.label())
}

pub(super) fn unresolved_software_receipt(base: &Path, target: &Value, record_id: &str, operation: &str, request_digest: &str) -> Result<Record, String> {
    if !matches!(operation,"install"|"upgrade") { return Err("Select a supported installation receipt review.".into()); }
    let record=unresolved_dispatch(base,target,record_id,operation,operation)?;
    if record.request_digest!=request_digest {
        return Err(match operation {
            "install"=>"The entered references and validator identity do not match this install dispatch.",
            _=>"The entered release and manifest do not match this upgrade dispatch.",
        }.into());
    }
    Ok(record)
}

fn unresolved_dispatch(base: &Path, target: &Value, record_id: &str, operation: &str, label: &str) -> Result<Record, String> {
    if !pin(record_id) { return Err(format!("Select an exact local {label} journal entry.")); }
    let target_digest = scoped_digest(base,target)?;
    inspect_records(base)?.into_iter().find(|record| record.id == record_id && record.target_digest == target_digest
        && record.operation == operation && matches!(record.state.as_str(), "dispatch_intent" | "uncertain"))
        .ok_or_else(|| format!("The unresolved {label} entry does not match this target. Refresh local history and select it again."))
}

pub(super) struct TreasuryNotApplied{original:Value,scope:String,snapshot:String,issued:std::time::Instant}
pub(super) fn treasury_not_applied_ticket(base:&Path,target:&Value)->Result<TreasuryNotApplied,String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;
 let scope=scoped_digest(base,target)?;let records=load(&directory)?;let original=treasury_original_records(&records,&scope)?;
 Ok(TreasuryNotApplied{original,scope:scope.clone(),snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now()})
}
impl TreasuryNotApplied{pub(super) fn original(&self)->&Value{&self.original}}
pub(super) fn verify_treasury_not_applied(base:&Path,target:&Value,ticket:TreasuryNotApplied,commit:impl FnOnce()->Result<(),String>)->Result<(),String>{
 let _serial=SERIAL.lock().map_err(|_|failure())?;let directory=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&directory)?;let records=load(&directory)?;let scope=scoped_digest(base,target)?;
 if ticket.issued.elapsed()>std::time::Duration::from_secs(120)||scope!=ticket.scope||snapshot(&records,&scope)?!=ticket.snapshot||treasury_original_records(&records,&scope)?!=ticket.original{return Err(failure())}
 let id=ticket.original["id"].as_str().ok_or_else(failure)?;let current=records.iter().find(|r|r.id==id).ok_or_else(failure)?;let observed=now()?;
 if observed<current.observed_at_ms.unwrap_or(current.recorded_at_ms){return Err(failure())}
 commit()?;let mut changed=current.clone();changed.state="verified_treasury_prepare_not_applied".into();changed.response_ok=Some(false);changed.observed_at_ms=Some(observed);write(&directory,&changed,false)
}

pub(super) fn treasury_phase_original(base:&Path,target:&Value)->Result<Value,String>{
 let scope=scoped_digest(base,target)?;let records=inspect_records(base)?;treasury_original_records(&records,&scope)
}
fn treasury_original_records(records:&[Record],scope:&str)->Result<Value,String>{
 let mut selected=records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>();selected.sort_by_key(|r|r.recorded_at_ms);
 let r=selected.last().ok_or("No original treasury preparation is available")?;
 if r.operation!="treasury_send_prepare"||r.state!="uncertain"||r.response_ok.is_some()||r.observed_at_ms.is_none_or(|t|t<r.recorded_at_ms)||selected.iter().any(|v|v.id!=r.id&&(v.recorded_at_ms>=r.recorded_at_ms||matches!(v.state.as_str(),"uncertain"|"dispatch_intent"))){return Err("Select the unchanged original uncertain treasury preparation; no diagnostic replay is allowed".into())}
 serde_json::to_value(r).map_err(|_|failure())
}

pub fn inspect(base: &Path) -> Result<Value, String> {
    let records = inspect_records(base)?;
    Ok(json!({"schema":"nodenetwork-local-requests-v1", "records":records, "limit":MAX_RECORDS,
        "remoteJobRecovery":false, "automaticReplay":false}))
}

pub(crate) fn reconcile_guest_stopped(base:&Path,target:&Value,resume:&str,stop:&str)->Result<bool,String>{
    if !pin(resume)||!pin(stop){return Err(failure())}
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let Some(directory)=directory(base,false)? else{return Ok(false)};
    let _writer=WriterLock::acquire(&directory)?;let records=load(&directory)?;let scope=scoped_digest(base,target)?;
    let scoped:Vec<_>=records.iter().filter(|r|r.target_digest==scope).collect();
    let Some(original)=scoped.iter().find(|r|r.operation=="guest_resume"&&r.request_digest==resume&&matches!(r.state.as_str(),"uncertain"|"verified_guest_resume_stopped"))else{return Ok(false)};
    let Some(stopped)=scoped.iter().filter(|r|r.operation=="guest_stop"&&r.request_digest==stop&&r.recorded_at_ms>original.recorded_at_ms).max_by_key(|r|r.recorded_at_ms)else{return Err(failure())};
    if scoped.iter().any(|r|r.id!=original.id&&r.id!=stopped.id&&matches!(r.state.as_str(),"dispatch_intent"|"uncertain"))
        ||scoped.iter().any(|r|r.id!=stopped.id&&r.recorded_at_ms>=stopped.recorded_at_ms)
        ||!matches!(stopped.state.as_str(),"dispatch_intent"|"uncertain"|"response_received"|"verified_target_outcome")
        ||stopped.response_ok==Some(false){return Err(failure())}
    let mut stopped=(**stopped).clone();stopped.state="verified_target_outcome".into();stopped.observed_at_ms=Some(now()?);stopped.response_ok=Some(true);write(&directory,&stopped,false)?;
    let mut original=(**original).clone();original.state="verified_guest_resume_stopped".into();original.observed_at_ms=Some(now()?);original.response_ok=Some(false);write(&directory,&original,false)?;
    Ok(true)
}

#[cfg(test)]mod reinstallation_tests{
 use super::*;
 struct Cleanup(PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
 fn scratch()->Cleanup{static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);let p=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-incarnation-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));fs::create_dir(&p).unwrap();Cleanup(p)}
 #[test]fn treasury_nonapplication_is_fresh_exact_false_cas_and_durable_before_release(){
 let c=scratch();let target=json!({"host":"pinned"});let r=json!({"version":1,"operation":"treasury_send_prepare","parameters":{"nonce":0}});
 Dispatch::begin(&c.0,&target,"treasury_send_prepare",&r).unwrap().finish(&Err("lost".into())).unwrap();
 let mut stale=treasury_not_applied_ticket(&c.0,&target).unwrap();stale.issued-=std::time::Duration::from_secs(121);assert!(verify_treasury_not_applied(&c.0,&target,stale,||panic!("stale commit")).is_err());
 let ticket=treasury_not_applied_ticket(&c.0,&target).unwrap();assert!(verify_treasury_not_applied(&c.0,&json!({"host":"foreign"}),ticket,||panic!("foreign commit")).is_err());
 let ticket=treasury_not_applied_ticket(&c.0,&target).unwrap();assert!(verify_treasury_not_applied(&c.0,&target,ticket,||Err("durable receipt interrupted".into())).is_err());assert_eq!(inspect(&c.0).unwrap()["records"][0]["state"],"uncertain");assert!(require_resumable_scope(&c.0,&target).is_err());
 let ticket=treasury_not_applied_ticket(&c.0,&target).unwrap();let directory=directory(&c.0,false).unwrap().unwrap();let mut changed=load(&directory).unwrap()[0].clone();changed.request_digest="f".repeat(64);write(&directory,&changed,false).unwrap();assert!(verify_treasury_not_applied(&c.0,&target,ticket,||panic!("changed commit")).is_err());changed.request_digest=digest(&r);write(&directory,&changed,false).unwrap();
 let ticket=treasury_not_applied_ticket(&c.0,&target).unwrap();verify_treasury_not_applied(&c.0,&target,ticket,||Ok(())).unwrap();let v=inspect(&c.0).unwrap();assert_eq!(v["records"][0]["state"],"verified_treasury_prepare_not_applied");assert_eq!(v["records"][0]["response_ok"],false);require_resumable_scope(&c.0,&target).unwrap();assert!(treasury_not_applied_ticket(&c.0,&target).is_err());
 }
 #[test]fn treasury_phase_original_requires_exact_sole_latest_uncertainty_and_never_writes(){
 let c=scratch();let target=json!({"host":"pinned"});let r=json!({"version":1,"operation":"treasury_send_prepare","parameters":{"nonce":0}});
 Dispatch::begin(&c.0,&target,"treasury_send_prepare",&r).unwrap().finish(&Err("lost".into())).unwrap();let before=inspect(&c.0).unwrap();let original=treasury_phase_original(&c.0,&target).unwrap();assert_eq!(original["request_digest"],digest(&r));assert_eq!(inspect(&c.0).unwrap(),before);assert!(treasury_phase_original(&c.0,&json!({"host":"foreign"})).is_err());
 let directory=directory(&c.0,false).unwrap().unwrap();let mut newer=load(&directory).unwrap()[0].clone();newer.id="f".repeat(64);newer.operation="register".into();newer.recorded_at_ms+=1;newer.observed_at_ms=Some(newer.recorded_at_ms+1);newer.state="response_received".into();newer.response_ok=Some(true);write(&directory,&newer,true).unwrap();assert!(treasury_phase_original(&c.0,&target).is_err());
 }
 #[test]fn transport_nonapplication_cas_is_false_exact_fresh_and_never_replays(){
  let c=scratch();let target=json!({"host":"pinned","root":"/opt/synergy"});let request=json!({"operation":"commission","artifact_sha256":{"fixed":"a".repeat(64)}});let key=digest(&request);
  Dispatch::begin(&c.0,&target,"authorization_stage",&request).unwrap().finish(&Err("lost reply".into())).unwrap();
  assert!(transport_not_applied_ticket(&c.0,&json!({"host":"foreign"}),&key).is_err());assert!(transport_not_applied_ticket(&c.0,&target,&"f".repeat(64)).is_err());
  let mut stale=transport_not_applied_ticket(&c.0,&target,&key).unwrap();stale.issued-=std::time::Duration::from_secs(121);
  assert!(verify_transport_not_applied(&c.0,&target,&key,stale,||panic!("stale proof committed")).is_err());
  let ticket=transport_not_applied_ticket(&c.0,&target,&key).unwrap();assert!(verify_transport_not_applied(&c.0,&target,&key,ticket,||Err("receipt interrupted".into())).is_err());
  let directory=directory(&c.0,false).unwrap().unwrap();assert_eq!(load(&directory).unwrap()[0].state,"uncertain");
  let ticket=transport_not_applied_ticket(&c.0,&target,&key).unwrap();verify_transport_not_applied(&c.0,&target,&key,ticket,||Ok(())).unwrap();
  let records=load(&directory).unwrap();assert_eq!(records[0].state,"verified_transport_not_applied");assert_eq!(records[0].response_ok,Some(false));
  // A retained intent can obtain a fresh proof after an interrupted local cleanup.
  let ticket=transport_not_applied_ticket(&c.0,&target,&key).unwrap();verify_transport_not_applied(&c.0,&target,&key,ticket,||Ok(())).unwrap();
  let ticket=transport_not_applied_ticket(&c.0,&target,&key).unwrap();Dispatch::begin(&c.0,&target,"register",&json!({})).unwrap().finish(&Ok(json!({"ok":true}))).unwrap();
  assert!(verify_transport_not_applied(&c.0,&target,&key,ticket,||panic!("changed journal committed")).is_err());
 }
 #[test]fn unused_stage_replacement_is_direct_distinct_and_never_invents_upgrade_dispatch(){
  let c=scratch();let target=json!({"host":"pinned","root":"/opt/synergy"});let upgrade=json!({"version":1,"operation":"upgrade","parameters":{"release_id":"unused","manifest_sha256":"a".repeat(64)}});
  let original=json!({"version":1,"operation":"update_stage","parameters":upgrade["parameters"]});let new=json!({"version":1,"operation":"update_stage","parameters":{"release_id":"corrected","manifest_sha256":"b".repeat(64)}});
  assert!(update_replacement_ticket(&c.0,&target,&upgrade,&new).is_err());
  Dispatch::begin(&c.0,&target,"update_stage",&original).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  let ticket=update_replacement_ticket(&c.0,&target,&upgrade,&new).unwrap();assert!(ticket.unused());
  assert!(update_replacement_ticket(&c.0,&json!({"host":"foreign"}),&upgrade,&new).is_err());
  let mut changed=upgrade.clone();changed["parameters"]["manifest_sha256"]=json!("f".repeat(64));assert!(update_replacement_ticket(&c.0,&target,&changed,&new).is_err());
  let mut stale=update_replacement_ticket(&c.0,&target,&upgrade,&new).unwrap();stale.issued-=std::time::Duration::from_secs(121);assert!(Dispatch::begin_update_replacement(&c.0,&target,&new,stale).is_err());
  Dispatch::begin_update_replacement(&c.0,&target,&new,ticket).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  let path=directory(&c.0,false).unwrap().unwrap();let records=load(&path).unwrap();assert_eq!(records.len(),2);assert!(records.iter().all(|r|r.operation=="update_stage"&&r.response_ok==Some(true)));assert!(update_replacement_ticket(&c.0,&target,&upgrade,&new).is_err());
 }
 #[test]fn unused_stage_refuses_any_upgrade_dispatch_other_uncertainty_or_newer_mutation(){
  for operation in ["upgrade","register"]{let c=scratch();let target=json!({"host":"pinned","root":"/opt/synergy"});let old=json!({"version":1,"operation":"upgrade","parameters":{"release_id":"old","manifest_sha256":"a".repeat(64)}});let stage=json!({"version":1,"operation":"update_stage","parameters":old["parameters"]});let new=json!({"version":1,"operation":"update_stage","parameters":{"release_id":"new","manifest_sha256":"b".repeat(64)}});
   Dispatch::begin(&c.0,&target,"update_stage",&stage).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();let ticket=update_replacement_ticket(&c.0,&target,&old,&new).unwrap();
   Dispatch::begin(&c.0,&target,operation,&old).unwrap().finish(&Err("unknown".into())).unwrap();assert!(update_replacement_ticket(&c.0,&target,&old,&new).is_err());assert!(Dispatch::begin_update_replacement(&c.0,&target,&new,ticket).is_err());
  }
 }
 #[test]fn staged_replacement_requires_latest_false_upgrade_and_new_request_cas(){
  let c=scratch();let t=json!({"host":"pinned","root":"/opt/synergy"});let old=json!({"version":1,"operation":"upgrade","parameters":{"release_id":"old-stage","manifest_sha256":"a".repeat(64)}});
  let new=json!({"version":1,"operation":"update_stage","parameters":{"release_id":"new-stage","manifest_sha256":"b".repeat(64)}});
  Dispatch::begin(&c.0,&t,"upgrade",&old).unwrap().finish(&Err("lost reply".into())).unwrap();
  assert!(update_replacement_ticket(&c.0,&t,&old,&new).is_err());
  let path=directory(&c.0,false).unwrap().unwrap();let id=load(&path).unwrap()[0].id.clone();let proof=upgrade_not_applied_ticket(&c.0,&t,&id,&old).unwrap();verify_upgrade_not_applied(&c.0,&t,&old,proof).unwrap();
  assert!(update_replacement_ticket(&c.0,&json!({"host":"other"}),&old,&new).is_err());
  let mut replay=new.clone();replay["parameters"]=old["parameters"].clone();assert!(update_replacement_ticket(&c.0,&t,&old,&replay).is_err());
  let ticket=update_replacement_ticket(&c.0,&t,&old,&new).unwrap();assert!(Dispatch::begin_update_replacement(&c.0,&t,&replay,ticket).is_err());
  let mut expired=update_replacement_ticket(&c.0,&t,&old,&new).unwrap();expired.issued-=std::time::Duration::from_secs(121);assert!(Dispatch::begin_update_replacement(&c.0,&t,&new,expired).is_err());
  let ticket=update_replacement_ticket(&c.0,&t,&old,&new).unwrap();
  let mut foreign=load(&path).unwrap().remove(0);foreign.id="f".repeat(64);foreign.recorded_at_ms+=1;foreign.observed_at_ms=Some(foreign.recorded_at_ms);foreign.operation="install".into();foreign.state="response_received".into();foreign.response_ok=Some(false);write(&path,&foreign,true).unwrap();
  assert!(Dispatch::begin_update_replacement(&c.0,&t,&new,ticket).is_err());assert!(update_replacement_ticket(&c.0,&t,&old,&new).is_err());fs::remove_file(path.join(format!("{}.json",foreign.id))).unwrap();
  let ticket=update_replacement_ticket(&c.0,&t,&old,&new).unwrap();let repeat=update_replacement_ticket(&c.0,&t,&old,&new).unwrap();
  let dispatch=Dispatch::begin_update_replacement(&c.0,&t,&new,ticket).unwrap();assert!(Dispatch::begin_update_replacement(&c.0,&t,&new,repeat).is_err());dispatch.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  let records=load(&path).unwrap();assert_eq!(records.len(),2);assert!(records.iter().any(|r|r.id==id&&r.state=="verified_upgrade_not_applied"&&r.response_ok==Some(false)));
 }
 #[test]fn upgrade_not_applied_requires_exact_latest_uncertainty_and_cas(){
  let c=scratch();let t=json!({"host":"pinned","root":"/opt/synergy"});let q=json!({"version":1,"operation":"upgrade","parameters":{"release_id":"exact","manifest_sha256":"a".repeat(64)}});
  Dispatch::begin(&c.0,&t,"upgrade",&q).unwrap().finish(&Err("lost reply".into())).unwrap();
  let path=directory(&c.0,false).unwrap().unwrap();let id=load(&path).unwrap()[0].id.clone();
  assert!(upgrade_not_applied_ticket(&c.0,&t,&id,&json!({"changed":true})).is_err());
  assert!(upgrade_not_applied_ticket(&c.0,&json!({"host":"foreign"}),&id,&q).is_err());
  let ticket=upgrade_not_applied_ticket(&c.0,&t,&id,&q).unwrap();
  assert!(verify_upgrade_not_applied(&c.0,&t,&json!({"changed":true}),ticket).is_err());
  let mut expired=upgrade_not_applied_ticket(&c.0,&t,&id,&q).unwrap();expired.issued-=std::time::Duration::from_secs(121);
  assert!(verify_upgrade_not_applied(&c.0,&t,&q,expired).is_err());
  let changed=upgrade_not_applied_ticket(&c.0,&t,&id,&q).unwrap();
  let mut foreign=load(&path).unwrap().remove(0);foreign.id="f".repeat(64);foreign.operation="install".into();foreign.recorded_at_ms+=1;foreign.observed_at_ms=Some(foreign.recorded_at_ms);foreign.state="response_received".into();foreign.response_ok=Some(false);write(&path,&foreign,true).unwrap();
  assert!(verify_upgrade_not_applied(&c.0,&t,&q,changed).is_err());assert!(upgrade_not_applied_ticket(&c.0,&t,&id,&q).is_err());
  fs::remove_file(path.join(format!("{}.json",foreign.id))).unwrap();
  let proof=upgrade_not_applied_ticket(&c.0,&t,&id,&q).unwrap();let replay=upgrade_not_applied_ticket(&c.0,&t,&id,&q).unwrap();
  verify_upgrade_not_applied(&c.0,&t,&q,proof).unwrap();assert!(verify_upgrade_not_applied(&c.0,&t,&q,replay).is_err());
  let result=load(&path).unwrap().remove(0);assert_eq!(result.state,"verified_upgrade_not_applied");assert_eq!(result.response_ok,Some(false));
  assert!(upgrade_not_applied_ticket(&c.0,&t,&id,&q).is_err());
 }
 #[test]fn reinstall_retry_requires_direct_exact_removal_and_cas_unchanged_scope(){
  let c=scratch();let t=json!({"host":"pinned","root":"/opt/synergy"});let q=json!({"bootstrap":"exact"});
  Dispatch::begin(&c.0,&t,"uninstall",&json!({})).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  let removal=with_latest_success(&c.0,&t,"uninstall",Ok).unwrap();std::thread::sleep(std::time::Duration::from_millis(2));
  Dispatch::begin(&c.0,&t,"bootstrap",&q).unwrap().finish(&Err("timeout".into())).unwrap();
  let proof=bootstrap_absence_candidate(&c.0,&t,&q).unwrap().unwrap();let replay=bootstrap_absence_candidate(&c.0,&t,&q).unwrap().unwrap();
  verify_bootstrap_absence(&c.0,&t,&q,proof).unwrap();assert!(verify_bootstrap_absence(&c.0,&t,&q,replay).is_err());
  assert!(bootstrap_retry(&c.0,&t,&json!({"changed":true}),&removal).is_err());
  let mut changed=removal.clone();changed["id"]=json!("a".repeat(64));assert!(bootstrap_retry(&c.0,&t,&q,&changed).is_err());
  let retry=bootstrap_retry(&c.0,&t,&q,&removal).unwrap().unwrap();
  let path=directory(&c.0,false).unwrap().unwrap();let mut newer=load(&path).unwrap().remove(0);newer.id="f".repeat(64);newer.operation="install".into();newer.recorded_at_ms+=1;newer.state="response_received".into();newer.response_ok=Some(false);write(&path,&newer,true).unwrap();
  assert!(Dispatch::begin_bootstrap(&c.0,&t,&q,Some(retry)).is_err());assert!(bootstrap_retry(&c.0,&t,&q,&removal).unwrap().is_none());
  fs::remove_file(path.join(format!("{}.json",newer.id))).unwrap();
  let retry=bootstrap_retry(&c.0,&t,&q,&removal).unwrap().unwrap();
  let parent=c.0.join("nodenetwork-engineering-v1");fs::create_dir(&parent).unwrap();
  let pointer=parent.join(format!("incarnation-{}.json",digest(&t)));fs::write(&pointer,serde_json::to_vec(&json!({"initial_sha256":"a".repeat(64),"target_sha256":digest(&t)})).unwrap()).unwrap();
  #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&pointer,fs::Permissions::from_mode(0o600)).unwrap();}
  assert!(Dispatch::begin_bootstrap(&c.0,&t,&q,Some(retry)).is_err());assert!(bootstrap_retry(&c.0,&t,&q,&removal).unwrap().is_none());
  fs::remove_file(pointer).unwrap();
  for _ in 0..2{
   std::thread::sleep(std::time::Duration::from_millis(2));
   let retry=bootstrap_retry(&c.0,&t,&q,&removal).unwrap().unwrap();Dispatch::begin_bootstrap(&c.0,&t,&q,Some(retry)).unwrap().finish(&Err("retry interrupted".into())).unwrap();
   assert!(bootstrap_retry(&c.0,&t,&q,&removal).unwrap().is_none());
   let proof=bootstrap_absence_candidate(&c.0,&t,&q).unwrap().unwrap();verify_bootstrap_absence(&c.0,&t,&q,proof).unwrap();
  }
  let retry=bootstrap_retry(&c.0,&t,&q,&removal).unwrap().unwrap();
  // A same-state different request cannot join the allowed absence prefix.
  let prior=load(&path).unwrap();
  let older=prior.iter().rfind(|r|r.state=="verified_bootstrap_absence").unwrap();let mut foreign=Record{version:older.version,id:older.id.clone(),target_digest:older.target_digest.clone(),request_digest:"a".repeat(64),operation:older.operation.clone(),recorded_at_ms:older.recorded_at_ms,observed_at_ms:older.observed_at_ms,state:older.state.clone(),response_ok:older.response_ok};write(&path,&foreign,false).unwrap();
  assert!(bootstrap_retry(&c.0,&t,&q,&removal).is_err());foreign.request_digest=digest(&q);foreign.state="response_received".into();foreign.response_ok=Some(false);foreign.operation="install".into();write(&path,&foreign,false).unwrap();assert!(bootstrap_retry(&c.0,&t,&q,&removal).is_err());
  foreign.state="verified_bootstrap_absence".into();foreign.operation="bootstrap".into();foreign.response_ok=None;write(&path,&foreign,false).unwrap();
  std::thread::sleep(std::time::Duration::from_millis(2));Dispatch::begin_bootstrap(&c.0,&t,&q,Some(retry)).unwrap();
 }
 #[test]fn uncertain_bootstrap_absence_is_exact_terminal_and_never_success(){
  let c=scratch();let t=json!({"host":"pinned","root":"/opt/synergy"});let q=json!({"operation":"bootstrap","operator":"admin","bootstrapPin":"script","parameters":{"manifest":"exact"}});
  assert!(bootstrap_absence_candidate(&c.0,&t,&q).unwrap().is_none());
  let d=Dispatch::begin(&c.0,&t,"bootstrap",&q).unwrap();
  assert!(bootstrap_absence_candidate(&c.0,&t,&q).is_err());
  d.finish(&Err("timeout".into())).unwrap();
  let changed_ticket=bootstrap_absence_candidate(&c.0,&t,&json!({"changed":true})).unwrap().unwrap();
  assert!(verify_bootstrap_absence(&c.0,&t,&q,changed_ticket).is_err());
  assert!(bootstrap_absence_candidate(&c.0,&json!({"host":"foreign"}),&q).unwrap().is_none());
  let ticket=bootstrap_absence_candidate(&c.0,&t,&q).unwrap().unwrap();
  verify_bootstrap_absence(&c.0,&t,&q,ticket).unwrap();
  let records=inspect(&c.0).unwrap();let r=&records["records"][0];
  assert_eq!(r["state"],"verified_bootstrap_absence");assert!(r["response_ok"].is_null());
  assert!(with_latest_success(&c.0,&t,"bootstrap",Ok).is_err());
  assert!(bootstrap_absence_candidate(&c.0,&t,&q).unwrap().is_none());
  std::thread::sleep(std::time::Duration::from_millis(2));
  Dispatch::begin(&c.0,&t,"bootstrap",&q).unwrap().finish(&Err("new timeout".into())).unwrap();
  let mut ticket=bootstrap_absence_candidate(&c.0,&t,&q).unwrap().unwrap();ticket.issued=std::time::Instant::now()-std::time::Duration::from_secs(121);
  assert!(verify_bootstrap_absence(&c.0,&t,&q,ticket).is_err());
 }
 #[test]fn bootstrap_absence_reconciles_original_record_across_release_and_script_drift_only(){
  let c=scratch();let target=json!({"kind":"remote","host":"pinned.example","root":"/opt/synergy"});
  let original=json!({"version":1,"operation":"bootstrap","operator":"original-admin","parameters":{"release_id":"old-release","manifest_sha256":"a".repeat(64)},"bootstrapPin":"b".repeat(64)});
  let current=json!({"version":1,"operation":"bootstrap","operator":"reviewed-admin","parameters":{"release_id":"current-release","manifest_sha256":"c".repeat(64)},"bootstrapPin":"d".repeat(64)});
  let review=json!({"request":current,"operator_public_key_sha256":"e".repeat(64)});
  Dispatch::begin(&c.0,&target,"bootstrap",&original).unwrap().finish(&Err("upload uncertain".into())).unwrap();
  let ticket=bootstrap_absence_candidate(&c.0,&target,&review).unwrap().unwrap();
  assert_eq!(ticket.original_request_sha256(),digest(&original));
  let mut changed=review.clone();changed["operator_public_key_sha256"]=json!("f".repeat(64));
  assert!(verify_bootstrap_absence(&c.0,&target,&changed,ticket).is_err());
  let ticket=bootstrap_absence_candidate(&c.0,&target,&review).unwrap().unwrap();
  let replay=bootstrap_absence_candidate(&c.0,&target,&review).unwrap().unwrap();
  let before=inspect(&c.0).unwrap()["records"][0].clone();
  verify_bootstrap_absence(&c.0,&target,&review,ticket).unwrap();
  assert!(verify_bootstrap_absence(&c.0,&target,&review,replay).is_err());
  let after=inspect(&c.0).unwrap()["records"][0].clone();
  for field in ["id","request_digest","target_digest","recorded_at_ms"]{assert_eq!(after[field],before[field],"{field}");}
  assert_eq!(after["request_digest"],digest(&original));assert_ne!(after["request_digest"],digest(&current));
  assert_eq!(after["state"],"verified_bootstrap_absence");assert!(after["response_ok"].is_null());
  assert!(with_latest_success(&c.0,&target,"bootstrap",Ok).is_err());
  std::thread::sleep(std::time::Duration::from_millis(2));
  // Reconciliation did not dispatch. Only a separate call can record a fresh attempt.
  Dispatch::begin(&c.0,&target,"bootstrap",&current).unwrap().finish(&Err("second upload uncertain".into())).unwrap();
  let ticket=bootstrap_absence_candidate(&c.0,&target,&review).unwrap().unwrap();
  assert!(verify_bootstrap_absence(&c.0,&json!({"host":"foreign"}),&review,ticket).is_err());
 }
 #[test]fn bootstrap_absence_cas_rejects_cross_operation_newer_and_changed_journal(){
  let c=scratch();let t=json!({"host":"pinned"});let q=json!({"same":1});
  Dispatch::begin(&c.0,&t,"install",&q).unwrap().finish(&Err("lost".into())).unwrap();
  assert!(bootstrap_absence_candidate(&c.0,&t,&q).is_err());
  let c=scratch();Dispatch::begin(&c.0,&t,"bootstrap",&q).unwrap().finish(&Err("lost".into())).unwrap();
  let ticket=bootstrap_absence_candidate(&c.0,&t,&q).unwrap().unwrap();
  let path=directory(&c.0,false).unwrap().unwrap();let mut records=load(&path).unwrap();
  let r=&mut records[0];r.observed_at_ms=Some(r.observed_at_ms.unwrap().saturating_sub(1));write(&path,r,false).unwrap();
  assert!(verify_bootstrap_absence(&c.0,&t,&q,ticket).is_err());
  let mut newer=load(&path).unwrap().remove(0);newer.id="e".repeat(64);newer.operation="install".into();newer.recorded_at_ms+=1;newer.state="response_received".into();newer.response_ok=Some(false);write(&path,&newer,true).unwrap();
  assert!(bootstrap_absence_candidate(&c.0,&t,&q).is_err());
  assert_eq!(inspect(&c.0).unwrap()["records"].as_array().unwrap().len(),2);
 }
 #[test]fn terminal_uninstall_requires_latest_success_and_never_clears_uncertainty(){
  let c=scratch();let t=json!({"host":"example","root":"/opt/synergy"});
  assert!(with_latest_success(&c.0,&t,"uninstall",Ok).is_err());
  let d=Dispatch::begin(&c.0,&t,"uninstall",&json!({})).unwrap();d.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  assert!(with_latest_success(&c.0,&t,"uninstall",Ok).is_ok());
  std::thread::sleep(std::time::Duration::from_millis(2));
  let d=Dispatch::begin(&c.0,&t,"bootstrap",&json!({"new":1})).unwrap();d.finish(&Err("interrupted".into())).unwrap();
  assert!(with_latest_success(&c.0,&t,"uninstall",Ok).is_err());assert!(with_latest_success(&c.0,&t,"bootstrap",Ok).is_err());
  assert!(Dispatch::begin(&c.0,&t,"install",&json!({})).is_err());assert_eq!(inspect(&c.0).unwrap()["records"].as_array().unwrap().len(),2);
 }
 #[test]fn terminal_selection_rejects_all_uncertainty_and_ambiguous_timestamp_ties(){
  let c=scratch();let t=json!({"host":"example","root":"/opt/synergy"});let path=directory(&c.0,true).unwrap().unwrap();let when=now().unwrap();
  let terminal=Record{version:1,id:"a".repeat(64),target_digest:scoped_digest(&c.0,&t).unwrap(),request_digest:"b".repeat(64),operation:"uninstall".into(),recorded_at_ms:when,observed_at_ms:Some(when),state:"response_received".into(),response_ok:Some(true)};write(&path,&terminal,true).unwrap();
  let mut other=Record{version:1,id:"f".repeat(64),target_digest:terminal.target_digest.clone(),request_digest:"c".repeat(64),operation:"bootstrap".into(),recorded_at_ms:when,observed_at_ms:Some(when),state:"uncertain".into(),response_ok:None};write(&path,&other,true).unwrap();
  assert!(with_latest_success(&c.0,&t,"uninstall",|_|->Result<(),String>{panic!("uncertainty must not invoke transition")}).is_err());
  other.recorded_at_ms=when.saturating_sub(1);write(&path,&other,false).unwrap();assert!(with_latest_success(&c.0,&t,"uninstall",|_|->Result<(),String>{panic!("older uncertainty must remain visible")}).is_err());
  other.recorded_at_ms=when;other.state="response_received".into();other.response_ok=Some(true);write(&path,&other,false).unwrap();assert!(with_latest_success(&c.0,&t,"uninstall",|_|->Result<(),String>{panic!("tie must not authorize transition")}).is_err());
  assert_eq!(inspect(&c.0).unwrap()["records"].as_array().unwrap().len(),2);
 }
 #[test]fn incarnation_changes_journal_scope_without_deleting_old_history(){
  let c=scratch();let t=json!({"host":"example","root":"/opt/synergy"});
  let d=Dispatch::begin(&c.0,&t,"uninstall",&json!({})).unwrap();d.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
  let old=scoped_digest(&c.0,&t).unwrap();let directory=c.0.join("nodenetwork-engineering-v1");fs::create_dir(&directory).unwrap();
  #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&directory,fs::Permissions::from_mode(0o700)).unwrap();}
  let pin="a".repeat(64);let path=directory.join(format!("incarnation-{}.json",digest(&t)));
  fs::write(&path,json!({"initial_sha256":pin,"target_sha256":digest(&t)}).to_string()).unwrap();
  #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&path,fs::Permissions::from_mode(0o600)).unwrap();}
  assert_ne!(scoped_digest(&c.0,&t).unwrap(),old);assert!(with_latest_success(&c.0,&t,"uninstall",Ok).is_err());
  let d=Dispatch::begin(&c.0,&t,"install",&json!({})).unwrap();d.finish(&Ok(json!({"version":1,"ok":true}))).unwrap();assert_eq!(inspect(&c.0).unwrap()["records"].as_array().unwrap().len(),2);
  fs::write(path.with_extension("pending"),b"partial").unwrap();assert!(Dispatch::begin(&c.0,&t,"register",&json!({})).is_err());assert_eq!(inspect(&c.0).unwrap()["records"].as_array().unwrap().len(),2);
 }
 #[test]fn vpn_stop_uncertainty_cannot_be_blindly_replayed(){
  let c=scratch();let t=json!({"kind":"remote","host":"same.example","port":22,"root":"/opt/synergy"});
  let q=json!({"version":1,"operation":"vpn_stop","parameters":{}});
  Dispatch::begin(&c.0,&t,"vpn_stop",&q).unwrap().finish(&Err("reply lost".into())).unwrap();
  assert!(Dispatch::begin(&c.0,&t,"vpn_stop",&q).is_err());
  assert!(Dispatch::begin(&c.0,&t,"vpn_enroll",&json!({})).is_err());
  let records=inspect(&c.0).unwrap();assert_eq!(records["records"][0]["operation"],"vpn_stop");assert_eq!(records["records"][0]["state"],"uncertain");
  assert!(!reconcile_verified(&c.0,&t,"vpn_stop",&"f".repeat(64)).unwrap());
  assert!(reconcile_verified(&c.0,&t,"vpn_stop",&digest(&q)).unwrap());
  assert!(!reconcile_verified(&c.0,&t,"vpn_stop",&digest(&q)).unwrap());
  assert_eq!(inspect(&c.0).unwrap()["records"][0]["state"],"verified_target_outcome");

 }
 #[test]fn boot_policy_lost_reply_blocks_all_new_grants_until_exact_observed_digest(){
  let c=scratch();let t=json!({"kind":"remote","host":"same.example","port":22,"root":"/opt/synergy"});
  let q=json!({"version":1,"operation":"boot_policy","parameters":{"service":"vpn","enabled":true}});
  Dispatch::begin(&c.0,&t,"boot_policy",&q).unwrap().finish(&Err("reply lost".into())).unwrap();
  let mut grants=0;if require_resumable_scope(&c.0,&t).is_ok(){grants+=1}assert_eq!(grants,0);
  let other=json!({"version":1,"operation":"boot_policy","parameters":{"service":"node","enabled":true}});
  assert!(!reconcile_verified(&c.0,&t,"boot_policy",&digest(&other)).unwrap());assert!(require_resumable_scope(&c.0,&t).is_err());
  assert!(reconcile_verified(&c.0,&t,"boot_policy",&digest(&q)).unwrap());require_resumable_scope(&c.0,&t).unwrap();
  Dispatch::begin(&c.0,&t,"boot_policy",&q).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
 }
 #[test]fn vpn_resume_uncertainty_cannot_be_blindly_replayed(){
  let c=scratch();let t=json!({"kind":"remote","host":"same.example","port":22,"root":"/opt/synergy"});
  let q=json!({"version":1,"operation":"vpn_resume","parameters":{}});
  Dispatch::begin(&c.0,&t,"vpn_resume",&q).unwrap().finish(&Err("reply lost".into())).unwrap();
  let mut grant_calls=0;
  if require_resumable_scope(&c.0,&t).is_ok(){grant_calls+=1;}
  assert_eq!(grant_calls,0);assert!(Dispatch::begin(&c.0,&t,"vpn_resume",&q).is_err());
  assert!(Dispatch::begin(&c.0,&t,"vpn_enroll",&json!({})).is_err());
  let records=inspect(&c.0).unwrap();assert_eq!(records["records"][0]["operation"],"vpn_resume");assert_eq!(records["records"][0]["state"],"uncertain");
  assert!(!reconcile_verified(&c.0,&t,"vpn_resume",&"f".repeat(64)).unwrap());
  assert!(reconcile_verified(&c.0,&t,"vpn_resume",&digest(&q)).unwrap());
  assert!(!reconcile_verified(&c.0,&t,"vpn_resume",&digest(&q)).unwrap());
  assert_eq!(inspect(&c.0).unwrap()["records"][0]["state"],"verified_target_outcome");
  require_resumable_scope(&c.0,&t).unwrap();
  Dispatch::begin(&c.0,&t,"vpn_resume",&q).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();

 }

 #[test]fn guest_resume_uncertainty_only_allows_exact_reviewed_stop_and_cancelled_outcome(){
  let c=scratch();let t=json!({"host":"physical","root":"/opt/synergy"});
  let resume=json!({"version":1,"operation":"guest_resume","parameters":{"guest_id":"fifth","resume_sequence":1,"create_request_sha256":"a".repeat(64)}});
  let stop=json!({"version":1,"operation":"guest_stop","parameters":{"guest_id":"fifth"}});
  let dispatch=Dispatch::begin(&c.0,&t,"guest_resume",&resume).unwrap();
  assert!(Dispatch::begin_guest_stop(&c.0,&t,&stop,&resume).is_err()); // Still running, not uncertain.
  dispatch.finish(&Err("lost start response".into())).unwrap();
  assert!(Dispatch::begin(&c.0,&t,"guest_stop",&stop).is_err());
  let mut foreign=resume.clone();foreign["parameters"]["create_request_sha256"]=json!("b".repeat(64));
  assert!(Dispatch::begin_guest_stop(&c.0,&t,&stop,&foreign).is_err());
  let mut foreign_stop=stop.clone();foreign_stop["parameters"]["guest_id"]=json!("other");
  assert!(Dispatch::begin_guest_stop(&c.0,&t,&foreign_stop,&resume).is_err());
  assert!(reconcile_guest_stopped(&c.0,&t,&digest(&resume),&digest(&stop)).is_err()); // No reviewed/audited stop dispatch.
  std::thread::sleep(std::time::Duration::from_millis(2));
  Dispatch::begin_guest_stop(&c.0,&t,&stop,&resume).unwrap().finish(&Err("lost stop response".into())).unwrap();
  assert!(reconcile_guest_stopped(&c.0,&t,&digest(&resume),&digest(&stop)).unwrap());
  let records=load(&directory(&c.0,false).unwrap().unwrap()).unwrap();
  let old=records.iter().find(|r|r.operation=="guest_resume").unwrap();assert_eq!(old.state,"verified_guest_resume_stopped");assert_eq!(old.response_ok,Some(false));
  let mut next=resume.clone();next["parameters"]["resume_sequence"]=json!(2);
  Dispatch::begin(&c.0,&t,"guest_resume",&next).unwrap().finish(&Ok(json!({"version":1,"ok":true}))).unwrap();
 }
 #[test]fn guest_stop_exception_rejects_other_uncertainty_and_newer_records(){
  for other in ["vpn_enroll","guest_resume"]{
   let c=scratch();let t=json!({"host":"same","root":"/opt/synergy"});let resume=json!({"version":1,"operation":"guest_resume","parameters":{"guest_id":"fifth","resume_sequence":1,"create_request_sha256":"a".repeat(64)}});let stop=json!({"operation":"guest_stop","parameters":{"guest_id":"fifth"}});
   Dispatch::begin(&c.0,&t,other,&resume).unwrap().finish(&Err("unknown".into())).unwrap();
   if other=="guest_resume"{let directory=directory(&c.0,false).unwrap().unwrap();let mut newer=load(&directory).unwrap().remove(0);newer.id="f".repeat(64);newer.operation="install".into();newer.recorded_at_ms+=1;newer.state="response_received".into();newer.response_ok=Some(true);write(&directory,&newer,true).unwrap();}
   assert!(Dispatch::begin_guest_stop(&c.0,&t,&stop,&resume).is_err());
  }
 }

}

#[cfg(test)]mod continuation_reconciliation_tests{
 use super::*;
 struct Cleanup(PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
 fn scratch()->Cleanup{let p=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-continuation-{}-{}",std::process::id(),now().unwrap()));fs::create_dir(&p).unwrap();Cleanup(p)}
 #[test]fn continuation_reconciliation_cas_refuses_dispatch_uncertainty_and_changed_snapshot(){
  let c=scratch();let target=json!({"host":"pinned","root":"/opt/synergy"});let request=json!({"version":1,"operation":"genesis_stage","parameters":{}});let key=digest(&request);
  let snapshot=undispatched_continuation_snapshot(&c.0,&target,&key).unwrap();
  assert_eq!(with_undispatched_continuation(&c.0,&target,&key,&snapshot,||Ok(17)).unwrap(),17);
  assert!(with_undispatched_continuation(&c.0,&json!({"host":"foreign"}),&key,&snapshot,||Ok(())).is_err());
  Dispatch::begin(&c.0,&target,"genesis_stage",&request).unwrap().finish(&Err("ambiguous".into())).unwrap();
  assert!(undispatched_continuation_snapshot(&c.0,&target,&key).is_err());
  assert!(with_undispatched_continuation(&c.0,&target,&key,&snapshot,|| -> Result<(),String>{panic!("must not retire")}).is_err());
  let directory=directory(&c.0,false).unwrap().unwrap();let mut record=load(&directory).unwrap().remove(0);record.state="response_received".into();record.response_ok=Some(true);record.observed_at_ms=Some(record.recorded_at_ms);write(&directory,&record,false).unwrap();
  assert!(undispatched_continuation_snapshot(&c.0,&target,&key).is_err());
  assert!(with_undispatched_continuation(&c.0,&target,&"f".repeat(64),&snapshot,||Ok(())).is_err());
 }
}

#[cfg(test)]mod commission_reconciliation_tests{
 use super::*;
 struct Clean(PathBuf);impl Drop for Clean{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
 fn fixture()->(Clean,Value,PathBuf,Record,Record){
  static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);let p=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-commission-proof-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));fs::create_dir(&p).unwrap();let base=Clean(p);let target=json!({"host":"approved","root":"/opt/synergy"});let scope=scoped_digest(&base.0,&target).unwrap();let directory=directory(&base.0,true).unwrap().unwrap();let at=now().unwrap()-1000;let key=digest(&json!({"version":1,"operation":"commission","parameters":{}}));
  let prior=Record{version:1,id:"a".repeat(64),target_digest:scope.clone(),request_digest:digest(&json!({"operation":"commission","request_sha256":key,"artifact_sha256":"c".repeat(64)})),operation:"authorization_stage".into(),recorded_at_ms:at,observed_at_ms:Some(at+10),state:"response_received".into(),response_ok:Some(true)};
  let current=Record{version:1,id:"b".repeat(64),target_digest:scope,request_digest:key,operation:"commission".into(),recorded_at_ms:at+100,observed_at_ms:Some(at+110),state:"uncertain".into(),response_ok:None};write(&directory,&prior,true).unwrap();write(&directory,&current,true).unwrap();(base,target,directory,prior,current)
 }
 #[test]fn commission_ticket_refuses_foreign_stale_ties_uncertainty_and_changed_predecessor(){
  let(base,target,directory,prior,current)=fixture();assert!(commission_not_applied_ticket(&base.0,&json!({"host":"foreign"})).is_err());let ticket=commission_not_applied_ticket(&base.0,&target).unwrap();assert!(ticket.accepts_readiness(&"c".repeat(64)));assert!(!ticket.accepts_readiness(&"d".repeat(64)));
  let mut stale=commission_not_applied_ticket(&base.0,&target).unwrap();stale.issued-=std::time::Duration::from_secs(121);assert!(verify_commission_not_applied(&base.0,&target,stale,||panic!("stale commit")).is_err());
  for kind in 0..5{let mut changed=prior.clone();match kind{0=>changed.operation="register".into(),1=>{changed.state="uncertain".into();changed.response_ok=None},2=>changed.response_ok=Some(false),3=>changed.recorded_at_ms=current.recorded_at_ms,4=>changed.observed_at_ms=Some(current.recorded_at_ms),_=>unreachable!()};write(&directory,&changed,false).unwrap();assert!(commission_not_applied_ticket(&base.0,&target).is_err());}write(&directory,&prior,false).unwrap();
  let mut changed=current.clone();changed.request_digest="f".repeat(64);write(&directory,&changed,false).unwrap();assert!(commission_not_applied_ticket(&base.0,&target).is_err());write(&directory,&current,false).unwrap();
  let mut newer=prior.clone();newer.id="d".repeat(64);newer.operation="register".into();newer.recorded_at_ms=current.recorded_at_ms+1;newer.observed_at_ms=Some(current.recorded_at_ms+2);write(&directory,&newer,true).unwrap();assert!(verify_commission_not_applied(&base.0,&target,ticket,||panic!("changed journal commit")).is_err());
 }
 #[test]fn commission_receipt_failure_preserves_uncertainty_then_false_state_allows_new_review(){
  let(base,target,_,_,_)=fixture();let ticket=commission_not_applied_ticket(&base.0,&target).unwrap();assert!(verify_commission_not_applied(&base.0,&target,ticket,||Err("durable receipt failed".into())).is_err());assert_eq!(inspect(&base.0).unwrap()["records"][0]["state"],"uncertain");
  assert!(require_resumable_scope(&base.0,&target).is_err());let ticket=commission_not_applied_ticket(&base.0,&target).unwrap();verify_commission_not_applied(&base.0,&target,ticket,||Ok(())).unwrap();assert_eq!(inspect(&base.0).unwrap()["records"][0]["state"],"verified_commission_not_applied");assert_eq!(inspect(&base.0).unwrap()["records"][0]["response_ok"],false);require_resumable_scope(&base.0,&target).unwrap();
 }
}
