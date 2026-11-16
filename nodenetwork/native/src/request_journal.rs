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
fn journaled_operation(operation: &str) -> bool {
    matches!(operation, "bootstrap" | "install" | "identity_generate" | "formation_prepare" | "genesis_stage" | "genesis_bind" | "commission" | "register" | "vpn_enroll" | "start" | "stop" | "restart" | "upgrade" | "uninstall")
}
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

pub struct Dispatch { directory: PathBuf, record: Record }
impl Dispatch {
    /// Caller must validate the typed target/request and obtain native consent first.
    pub fn begin(base: &Path, target: &Value, operation: &str, request: &Value) -> Result<Self, String> {
        Self::begin_digest(base,target,operation,digest(request))
    }

    /// Digest computed from an exact native-only prepared wire payload.
    pub(super) fn begin_digest(base:&Path,target:&Value,operation:&str,request_digest:String) -> Result<Self,String> {
        let _serial = SERIAL.lock().map_err(|_| failure())?;
        if !journaled_operation(operation) || !pin(&request_digest) { return Err(failure()); }
        let directory = directory(base, true)?.ok_or_else(failure)?;
        let _writer = WriterLock::acquire(&directory)?;
        let records = load(&directory)?;
        let target_digest = digest(target);
        if records.iter().any(|r| r.target_digest == target_digest && r.state != "response_received") {
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
        if !records.iter().any(|r| r.id == self.record.id && r.state == "dispatch_intent") { return Err(failure()); }
        self.record.observed_at_ms = Some(now()?);
        self.record.response_ok = result.as_ref().ok().filter(|v| v["version"] == 1).and_then(|v| v["ok"].as_bool());
        self.record.state = if self.record.response_ok.is_some() { "response_received" } else { "uncertain" }.into();
        write(&self.directory, &self.record, false)
    }
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
pub(super) enum CustodyReceiptKind { GenesisStaging, GenesisBinding, Formation }

impl CustodyReceiptKind {
    pub(super) fn operation(self) -> &'static str {
        match self { Self::GenesisStaging => "genesis_stage", Self::GenesisBinding => "genesis_bind", Self::Formation => "formation_prepare" }
    }

    pub(super) fn label(self) -> &'static str {
        match self { Self::GenesisStaging => "Genesis staging", Self::GenesisBinding => "Genesis binding", Self::Formation => "formation preparation" }
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
    let target_digest = digest(target);
    inspect_records(base)?.into_iter().find(|record| record.id == record_id && record.target_digest == target_digest
        && record.operation == operation && matches!(record.state.as_str(), "dispatch_intent" | "uncertain"))
        .ok_or_else(|| format!("The unresolved {label} entry does not match this target. Refresh local history and select it again."))
}

pub fn inspect(base: &Path) -> Result<Value, String> {
    let records = inspect_records(base)?;
    Ok(json!({"schema":"nodenetwork-local-requests-v1", "records":records, "limit":MAX_RECORDS,
        "remoteJobRecovery":false, "automaticReplay":false}))
}
