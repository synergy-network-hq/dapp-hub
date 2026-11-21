//! Explicit engineering-only credential locator. The token stays off disk and IPC.
use crate::node_controller::{self, Target};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::{Path,PathBuf}, process::Stdio, time::Duration};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
use zeroize::Zeroizing;

const PROFILE: &str = "nodenetwork-remote-vpn-credential-v1";
static SESSIONS: tokio::sync::Mutex<BTreeMap<PathBuf,(String,u32)>> = tokio::sync::Mutex::const_new(BTreeMap::new());

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Locator {
    version: u8,
    profile: String,
    provider_sha256: String,
    host: String,
    port: u16,
    account: String,
    host_key: String,
    identity_file: String,
    credential_file: String,
}

fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn clean_path(value: &str) -> bool {
    value.starts_with('/') && value.len() <= 1024 && value.split('/').skip(1).all(|s| {
        !s.is_empty() && s != "." && s != ".."
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    })
}
fn decode(raw: &[u8], pin: Option<&str>, provider: &str, debug: bool) -> Result<Locator, String> {
    if !debug || !pin.is_some_and(|s| s.len() == 64 && s == digest(raw)) {
        return Err("Remote VPN credential locator lacks exact native approval".into());
    }
    let value: Locator = serde_json::from_slice(raw).map_err(|_| "Invalid bounded credential locator")?;
    if value.version != 1 || value.profile != PROFILE || value.provider_sha256 != provider
        || value.account != "root" || !clean_path(&value.identity_file)
        || !clean_path(&value.credential_file) || !value.credential_file.starts_with("/opt/synergy/")
    {
        return Err("Credential locator differs from its approved provider or custody scope".into());
    }
    let target = Target { kind: "remote".into(), host: Some(value.host.clone()), port: Some(value.port), root: node_controller::ROOT.into(), guest: None };
    target.validate()?;
    let endpoint = if value.port == 22 { value.host.clone() } else { format!("[{}]:{}", value.host, value.port) };
    let fields = value.host_key.split(' ').collect::<Vec<_>>();
    if fields.len() != 3 || fields[0] != endpoint || fields[1] != "ssh-ed25519" {
        return Err("Credential coordinator needs one exact pinned SSH endpoint".into());
    }
    use base64::Engine as _;
    let key = base64::engine::general_purpose::STANDARD.decode(fields[2]).map_err(|_| "Malformed coordinator host key")?;
    if key.len() != 51 || !key.starts_with(b"\0\0\0\x0bssh-ed25519\0\0\0\x20")
        || base64::engine::general_purpose::STANDARD.encode(&key) != fields[2]
    { return Err("Malformed coordinator host key".into()); }
    Ok(value)
}

pub(super) fn public_review(raw:&[u8],provider:&str,runtime_pin:Option<&str>)->Result<serde_json::Value,String>{
 let locator=decode(raw,runtime_pin.or(option_env!("SYNERGY_NODENETWORK_QUALIFICATION_VPN_CREDENTIAL_SHA256")),provider,cfg!(all(debug_assertions,unix)))?;
 Ok(serde_json::json!({"host":locator.host,"port":locator.port,"account":locator.account,"locator_sha256":digest(raw)}))
}

// This fixed read-only program never installs a provider or issues credentials.
// The selected path is independently compiled into the authenticated locator pin.
const READ_PRIVATE: &str = r#"import os,stat,sys
try:
 p=sys.argv[1]
 q=os.path.dirname(p)
 while q!='/':
  if not stat.S_ISDIR(os.lstat(q).st_mode): raise ValueError()
  q=os.path.dirname(q)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  m=os.fstat(fd)
  if not stat.S_ISREG(m.st_mode) or m.st_uid!=0 or m.st_nlink!=1 or m.st_mode&0o077 or not 0<m.st_size<=4098: raise ValueError()
  raw=os.read(fd,4099)
  n=os.fstat(fd)
  if len(raw)!=m.st_size or (m.st_dev,m.st_ino,m.st_size,m.st_mtime_ns,m.st_ctime_ns)!=(n.st_dev,n.st_ino,n.st_size,n.st_mtime_ns,n.st_ctime_ns): raise ValueError()
  token=raw.rstrip(b'\r\n')
  if not 0<len(token)<=4096 or not all(33<=c<=126 for c in token): raise ValueError()
 finally: os.close(fd)
 sys.stdout.buffer.write(raw)
except Exception: sys.exit(1)
"#;

async fn master_pid(target: &Target, control: &Path, account: &str) -> Result<Option<u32>,String> {
    let mut command = tokio::process::Command::new("/usr/bin/ssh");
    command.args(["-F","/dev/null","-S"]).arg(node_controller::control_socket(target,control,account))
        .args(["-O","check","--"]).arg(target.host.as_deref().ok_or("Missing credential coordinator")?)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = command.spawn().map_err(|_|"Cannot inspect coordinator connection")?;
    let mut error = child.stderr.take().ok_or("Connection inspection unavailable")?.take(513);
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut bytes=Vec::new(); error.read_to_end(&mut bytes).await.map_err(|_|"Connection inspection interrupted")?;
        let status=child.wait().await.map_err(|_|"Connection inspection unavailable")?;
        if !status.success() { return Ok(None); }
        let text=std::str::from_utf8(&bytes).map_err(|_|"Unsupported coordinator connection receipt")?.trim();
        let pid=text.strip_prefix("Master running (pid=").and_then(|s|s.strip_suffix(')'))
            .and_then(|s|s.parse::<u32>().ok()).filter(|n|*n>0).ok_or("Exact coordinator session identity unavailable")?;
        Ok(Some(pid))
    }).await.map_err(|_|"Coordinator connection inspection timed out".to_string())?
}

fn same_session(saved: Option<&(String,u32)>, locator: &str, actual: Option<u32>) -> bool {
    saved.is_some_and(|(pin,pid)|pin==locator && actual==Some(*pid))
}

pub(super) async fn load(raw: Zeroizing<Vec<u8>>, provider: &str, controlled: bool, runtime_pin: Option<&str>, control: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
    // Existing private-file provider credentials remain supported for isolated tests.
    if runtime_pin.is_none() && raw.first() != Some(&b'{') { return Ok(raw); }
    if !controlled { return Err("Remote credential access requires its controlled VPN provider".into()); }
    coordinator_read(&raw, provider, runtime_pin, control, Read::Credential).await
}

enum Read<'a> {
    Credential,
    LegacyPeerProof(&'a [u8]),
}

pub(super) async fn legacy_peer_proof(raw: &[u8], provider: &str, control: &Path, request: &[u8]) -> Result<Zeroizing<Vec<u8>>,String> {
    if request.is_empty() || request.len() > 4096 { return Err("Invalid bounded peer proof request".into()); }
    coordinator_read(raw, provider, None, control, Read::LegacyPeerProof(request)).await
}

async fn coordinator_read(raw: &[u8], provider: &str, runtime_pin: Option<&str>, control: &Path, read: Read<'_>) -> Result<Zeroizing<Vec<u8>>, String> {
    let locator = decode(raw, runtime_pin.or(option_env!("SYNERGY_NODENETWORK_QUALIFICATION_VPN_CREDENTIAL_SHA256")), provider, cfg!(all(debug_assertions, unix)))?;
    let locator_pin = digest(raw);
    let (command, input) = match read {
        Read::Credential => {
            let script = READ_PRIVATE.replace('\'', "'\\''");
            (format!("/usr/bin/python3 -I -B -c '{script}' '{}'", locator.credential_file), None)
        }
        Read::LegacyPeerProof(request) => {
            if locator.host != "68.183.139.56" || locator.port != 22 {
                return Err("Exact legacy coordinator SSH endpoint required".into());
            }
            (crate::node_bootstrap::legacy_peer_key_proof_command()?, Some(request))
        }
    };
    let identity = Path::new(&locator.identity_file);
    let metadata = std::fs::symlink_metadata(identity).map_err(|_| "Approved coordinator SSH identity is unavailable")?;
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 || metadata.nlink() != 1 {
            return Err("Coordinator SSH identity must remain a private native-owned regular file".into());
        }
    }
    let target = Target { kind: "remote".into(), host: Some(locator.host), port: Some(locator.port), root: node_controller::ROOT.into(), guest: None };
    #[cfg(unix)] node_controller::protect_control_directory(control)?;
    let known = node_controller::qualification_host_pin(control, &locator.host_key)?;
    // A multiplexed SSH session does not recheck host keys. Retain only the
    // exact process-local session created with this locator; reconcile any
    // inherited/changed connection before opening the pinned transport.
    let socket=node_controller::control_socket(&target,control,&locator.account);
    let mut sessions=SESSIONS.lock().await;
    let actual=master_pid(&target,control,&locator.account).await?;
    if !same_session(sessions.get(&socket),&locator_pin,actual) {
        node_controller::close_connection_checked(&target,control,&locator.account).await?;
        sessions.remove(&socket);
    }
    let mut process = node_controller::remote_command_with_identity(&target, control, &locator.account, &command, Some(&known), Some(identity))?;
    process.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child = process.spawn().map_err(|_| "Approved coordinator connection is unavailable")?;
    let result=tokio::time::timeout(Duration::from_secs(30), async {
        if let Some(request) = input {
            let mut stream = child.stdin.take().ok_or("Coordinator proof request stream unavailable")?;
            stream.write_all(request).await.map_err(|_| "Coordinator proof request interrupted")?;
            stream.shutdown().await.map_err(|_| "Coordinator proof request interrupted")?;
        }
        let mut stdout = child.stdout.take().ok_or("Coordinator result stream unavailable")?.take(4099);
        let mut bytes = Zeroizing::new(Vec::new());
        stdout.read_to_end(&mut bytes).await.map_err(|_| "Coordinator read interrupted")?;
        if bytes.is_empty() || bytes.len() > 4098 {
            return Err("Coordinator read outside the approved response bound".into());
        }
        if !child.wait().await.map_err(|_| "Coordinator read outcome unavailable")?.success() {
            return Err("Approved coordinator read refused".into());
        }
        Ok(bytes)
    }).await.unwrap_or_else(|_| Err("Coordinator read deadline exceeded".into()));
    drop(child);
    match result {
        Ok(bytes) => {
            let pid=master_pid(&target,control,&locator.account).await?.ok_or("Pinned coordinator session did not persist")?;
            sessions.insert(socket,(locator_pin,pid)); Ok(bytes)
        }
        Err(error) => {
            node_controller::close_connection_checked(&target,control,&locator.account).await?;
            sessions.remove(&socket); Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use serde_json::{json, Value};
    fn fixture() -> Value {
        let key = base64::engine::general_purpose::STANDARD.encode([b"\0\0\0\x0bssh-ed25519\0\0\0\x20".as_slice(), &[3u8;32]].concat());
        json!({"version":1,"profile":PROFILE,"provider_sha256":"a".repeat(64),"host":"coordinator.example","port":22,"account":"root","host_key":format!("coordinator.example ssh-ed25519 {key}"),"identity_file":"/Users/operator/.ssh/coordinator_ed25519","credential_file":"/opt/synergy/netbird/etc/broker.pat"})
    }
    fn verify(value: &Value) -> Result<Locator,String> {
        let raw = serde_json::to_vec(value).unwrap();
        decode(&raw, Some(&digest(&raw)), &"a".repeat(64), true)
    }
    #[test] fn exact_locator_requires_compiled_provider_and_debug_authority() {
        let value = fixture(); assert!(verify(&value).is_ok());
        let raw = serde_json::to_vec(&value).unwrap(); let pin = digest(&raw);
        assert!(decode(&raw, None, &"a".repeat(64), true).is_err());
        assert!(decode(&raw, Some(&pin), &"a".repeat(64), false).is_err());
        assert!(decode(&raw, Some(&pin), &"b".repeat(64), true).is_err());
        assert!(decode(&raw, Some(&"0".repeat(64)), &"a".repeat(64), true).is_err());
    }
    #[test] fn no_unpinned_hosts_paths_fields_or_shell_injection() {
        for (field,value) in [("host",json!("other.example")),("port",json!(0)),("account",json!("operator")),("credential_file",json!("/etc/shadow")),("credential_file",json!("/opt/synergy/../elsewhere")),("credential_file",json!("/opt/synergy/x';id")),("identity_file",json!("relative/key")),("profile",json!("production")),("extra",json!(true))] {
            let mut bad = fixture(); bad[field] = value; assert!(verify(&bad).is_err(),"{field}");
        }
        let raw = serde_json::to_vec(&fixture()).unwrap();
        let duplicate = String::from_utf8(raw).unwrap().replace("\"version\":1", "\"version\":1,\"version\":1");
        assert!(decode(duplicate.as_bytes(),Some(&digest(duplicate.as_bytes())),&"a".repeat(64),true).is_err());
    }
    #[tokio::test] async fn isolated_secret_files_do_not_gain_remote_authority() {
        let raw = Zeroizing::new(b"existing-test-token".to_vec());
        let provider = "a".repeat(64);
        assert_eq!(load(raw.clone(),&provider,false,None,Path::new("/unused")).await.unwrap().as_slice(),b"existing-test-token");
        let pin = digest(raw.as_slice());
        assert!(load(raw, &provider, true, Some(&pin), Path::new("/unused")).await.is_err());
        assert!(load(Zeroizing::new(serde_json::to_vec(&fixture()).unwrap()),&provider,false,None,Path::new("/unused")).await.is_err());
    }
    #[test] fn inherited_changed_or_unattributed_mux_is_never_trusted() {
        let saved=("approved-locator".into(),42);
        assert!(same_session(Some(&saved),"approved-locator",Some(42)));
        assert!(!same_session(None,"approved-locator",Some(42)));
        assert!(!same_session(Some(&saved),"different-locator",Some(42)));
        assert!(!same_session(Some(&saved),"approved-locator",Some(43)));
        assert!(!same_session(Some(&saved),"approved-locator",None));
    }
}
