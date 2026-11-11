//! Local dispatch evidence only: never a target job, approval or replay queue.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};

const MAX_RECORDS: usize = 256;
const MAX_BYTES: u64 = 4096;
static SERIAL: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
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

fn digest(value: &Value) -> String { format!("{:x}", Sha256::digest(value.to_string().as_bytes())) }
fn pin(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
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
        let operation = matches!(record.operation.as_str(), "bootstrap" | "install" | "commission" | "register" | "start" | "stop" | "restart" | "upgrade" | "uninstall");
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
        let _serial = SERIAL.lock().map_err(|_| failure())?;
        if !matches!(operation, "bootstrap" | "install" | "commission" | "register" | "start" | "stop" | "restart" | "upgrade" | "uninstall") { return Err(failure()); }
        let directory = directory(base, true)?.ok_or_else(failure)?;
        let _writer = WriterLock::acquire(&directory)?;
        let records = load(&directory)?;
        let target_digest = digest(target);
        if records.iter().any(|r| r.target_digest == target_digest && r.state != "response_received") {
            return Err("An earlier local dispatch for this target has an uncertain outcome. Reconcile the target through a qualified procedure before another mutation; Portal will not replay or clear it automatically.".into());
        }
        if records.len() >= MAX_RECORDS { return Err("Local request journal is full. Records are retained; another mutation requires an approved retention procedure.".into()); }
        let recorded_at_ms = now()?;
        let request_digest = digest(request);
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

pub fn inspect(base: &Path) -> Result<Value, String> {
    let _serial = SERIAL.lock().map_err(|_| failure())?;
    let lock = base.join("nodenetwork-requests-v1.lock");
    match fs::symlink_metadata(&lock) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        _ => return Err("Local request journal writer is busy or interrupted. History is unavailable; no empty state is inferred.".into()),
    }
    let records = match directory(base, false)? { Some(path) => load(&path)?, None => Vec::new() };
    Ok(json!({"schema":"nodenetwork-local-requests-v1", "records":records, "limit":MAX_RECORDS,
        "remoteJobRecovery":false, "automaticReplay":false}))
}
