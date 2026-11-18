//! Local dispatch evidence only: never a target job, approval or replay queue.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};

const MAX_RECORDS: usize = 256;
const MAX_BYTES: u64 = 4096;
static SERIAL: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, PartialEq, Eq)]
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
fn journaled_operation(operation: &str) -> bool { matches!(operation, "authorization_stage" | "update_stage" | "bare_bootstrap_rollback" | "bootstrap" | "install" | "identity_generate" | "network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "guest_create" | "guest_stop" | "guest_remove" | "formation_prepare" | "genesis_stage" | "genesis_bind" | "commission" | "register" | "vpn_enroll" | "start" | "stop" | "restart" | "upgrade" | "uninstall") }

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
            "verified_bootstrap_absence" => record.operation=="bootstrap" && record.observed_at_ms.is_some_and(|at|at>=record.recorded_at_ms) && record.response_ok.is_none(),
            "verified_target_outcome" => record.observed_at_ms.is_some() && record.response_ok==Some(true) && matches!(record.operation.as_str(),"authorization_stage"|"update_stage"|"identity_generate"|"network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "guest_create" | "formation_prepare"|"genesis_stage"|"genesis_bind"),
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
    id:String, scope:String, request:String, recorded:u64, observed:u64,
    snapshot:String, issued:std::time::Instant,
}
fn bootstrap_candidate(records:&[Record],scope:&str,request:&str)->Result<Option<&'static str>,String>{
    let scoped=records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>();
    let pending=scoped.iter().filter(|r|matches!(r.state.as_str(),"dispatch_intent"|"uncertain")).collect::<Vec<_>>();
    if pending.is_empty(){return Ok(None)}
    let latest=scoped.first().ok_or_else(failure)?;let clock=now()?;
    if pending.len()!=1||latest.id!=pending[0].id||latest.state!="uncertain"||latest.operation!="bootstrap"||latest.request_digest!=request
        ||latest.recorded_at_ms>clock||latest.observed_at_ms.is_none_or(|at|at>clock)
        ||scoped.iter().skip(1).any(|r|r.recorded_at_ms>=latest.recorded_at_ms){
        return Err("Only the exact latest uncertain bootstrap can be reconciled; other operations and changed requests remain fenced.".into())
    }
    Ok(Some("exact uncertain bootstrap"))
}
fn snapshot(records:&[Record],scope:&str)->Result<String,String>{
    Ok(digest(&serde_json::to_value(records.iter().filter(|r|r.target_digest==scope).collect::<Vec<_>>()).map_err(|_|failure())?))
}
pub(super) fn bootstrap_absence_candidate(base:&Path,target:&Value,request:&Value)->Result<Option<BootstrapAbsence>,String>{
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let Some(path)=directory(base,false)?else{return Ok(None)};
    let _writer=WriterLock::acquire(&path)?;
    let scope=scoped_digest(base,target)?;let records=load(&path)?;let request=digest(request);
    if bootstrap_candidate(&records,&scope,&request)?.is_none(){return Ok(None)}
    let r=records.iter().find(|r|r.target_digest==scope).ok_or_else(failure)?;
    Ok(Some(BootstrapAbsence{id:r.id.clone(),scope:scope.clone(),request,recorded:r.recorded_at_ms,observed:r.observed_at_ms.ok_or_else(failure)?,snapshot:snapshot(&records,&scope)?,issued:std::time::Instant::now()}))
}
impl BootstrapAbsence {pub(super) fn challenge(&self)->String{digest(&json!([self.id,self.scope,self.request,self.recorded,self.observed,now().unwrap_or(0),std::process::id()]))}}
pub(super) fn verify_bootstrap_absence(base:&Path,target:&Value,request:&Value,ticket:BootstrapAbsence)->Result<(),String>{
    let _serial=SERIAL.lock().map_err(|_|failure())?;
    let path=directory(base,false)?.ok_or_else(failure)?;let _writer=WriterLock::acquire(&path)?;
    let scope=scoped_digest(base,target)?;let mut records=load(&path)?;let request=digest(request);
    if ticket.issued.elapsed()>std::time::Duration::from_secs(120)||scope!=ticket.scope||request!=ticket.request
        ||snapshot(&records,&scope)?!=ticket.snapshot||bootstrap_candidate(&records,&scope,&request)?.is_none(){return Err("Bootstrap absence proof is stale or its journal changed; no outcome was reconciled.".into())}
    let r=records.iter_mut().find(|r|r.id==ticket.id).ok_or_else(failure)?;
    if r.recorded_at_ms!=ticket.recorded||r.observed_at_ms!=Some(ticket.observed){return Err(failure())}
    let observed=now()?;if observed<ticket.observed||observed<r.recorded_at_ms{return Err("Bootstrap reconciliation clock moved backwards; journal remains uncertain".into())}
    r.state="verified_bootstrap_absence".into();r.observed_at_ms=Some(observed);
    // Explicit verified absence is neither success nor custody completion.
    write(&path,r,false)
}

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

pub struct Dispatch { directory: PathBuf, record: Record }
impl Dispatch {
    /// Caller must validate the typed target/request and obtain native consent first.
    pub fn begin(base: &Path, target: &Value, operation: &str, request: &Value) -> Result<Self, String> {Self::begin_checked(base,target,operation,request,None)}
    pub(super) fn begin_bootstrap(base:&Path,target:&Value,request:&Value,retry:Option<BootstrapRetry>)->Result<Self,String>{Self::begin_checked(base,target,"bootstrap",request,retry)}
    #[cfg(test)]
    pub(super) fn begin_digest(base:&Path,target:&Value,operation:&str,request_digest:String)->Result<Self,String>{
        if !pin(&request_digest){return Err(failure());}
        Self::begin_with_digest(base,target,operation,request_digest,None)
    }
    fn begin_checked(base:&Path,target:&Value,operation:&str,request:&Value,retry:Option<BootstrapRetry>)->Result<Self,String>{
        Self::begin_with_digest(base,target,operation,digest(request),retry)
    }
    fn begin_with_digest(base:&Path,target:&Value,operation:&str,request_digest:String,retry:Option<BootstrapRetry>)->Result<Self,String>{
        let _serial = SERIAL.lock().map_err(|_| failure())?;
        if !matches!(operation, "authorization_stage" | "update_stage" | "bare_bootstrap_rollback" | "bootstrap" | "install" | "identity_generate" | "network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "guest_create" | "guest_stop" | "guest_remove" | "formation_prepare" | "genesis_stage" | "genesis_bind" | "commission" | "register" | "vpn_enroll" | "start" | "stop" | "restart" | "upgrade" | "uninstall") { return Err(failure()); }
        let directory = directory(base, true)?.ok_or_else(failure)?;
        let _writer = WriterLock::acquire(&directory)?;
        let records = load(&directory)?;
        let target_digest = scoped_digest(base,target)?;
        if let Some(ticket)=retry{if operation!="bootstrap"||target_digest!=ticket.scope||request_digest!=ticket.request||snapshot(&records,&target_digest)?!=ticket.snapshot{return Err("Reinstallation retry journal changed; no bootstrap was sent".into())}}
        if records.iter().any(|r| r.target_digest == target_digest && matches!(r.state.as_str(),"dispatch_intent"|"uncertain")) {
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
    if !matches!(operation,"authorization_stage"|"update_stage"|"identity_generate"|"network_formation_prepare" | "network_formation_sign" | "network_transport_prepare" | "network_transport_sign" | "treasury_prepare" | "guest_create" | "formation_prepare"|"genesis_stage"|"genesis_bind")||!pin(request_digest){return Err(failure());}
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

pub fn inspect(base: &Path) -> Result<Value, String> {
    let records = inspect_records(base)?;
    Ok(json!({"schema":"nodenetwork-local-requests-v1", "records":records, "limit":MAX_RECORDS,
        "remoteJobRecovery":false, "automaticReplay":false}))
}

#[cfg(test)]mod reinstallation_tests{
 use super::*;
 struct Cleanup(PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
 fn scratch()->Cleanup{static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);let p=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-incarnation-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));fs::create_dir(&p).unwrap();Cleanup(p)}
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
  assert!(bootstrap_absence_candidate(&c.0,&t,&json!({"changed":true})).is_err());
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
}
