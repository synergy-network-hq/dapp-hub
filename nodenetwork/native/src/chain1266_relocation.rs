//! Exact two-host relocation for the separately verified Chain 1266 gateway.
use crate::{gateway_admission::{exact, pin}, node_bootstrap, node_controller::{self, Target}};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::{Path, PathBuf}, process::Stdio, time::Duration};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, process::Child};

const ACCOUNT: &str = "root";
const SOURCE_IP: &str = "167.86.83.83";
const DESTINATION_IP: &str = "209.145.50.9";
const DESTINATION_HOST_KEY: &str = "209.145.50.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJnr+Phs0sYodiS/wD+ZjKwp//mcPofEzjzZnnGFy27x";
const SOURCE_MACHINE: &str = "8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d";
const DESTINATION_MACHINE: &str = "ca5c0c0942ab929347f279038fdcf001662a47c2cf3b53a5c631e74830755303";
const GENESIS: &str = "2272fe2b48c6e2019b27223f61ba8d8a82b58656fe9daab50c81f224a301ca74";
const DESTINATION_PATH: &str = "/opt/synergy/chain1266/relocated-rpc-gateway-incarnation-4";
const RECORDS_PATH: &str = "/opt/synergy/chain1266/relocated-rpc-gateway-records";
const UNCERTAIN: &str = "Chain 1266 relocation is unverified. Read the exact destination receipt before another transfer.";
const MARKER: &str = "synergy-chain1266-relocation-complete-v1\n";

pub(super) fn destination_pin(target: &Target, control: &Path) -> Result<Option<PathBuf>, String> {
    if cfg!(debug_assertions) && target.kind == "remote"
        && target.host.as_deref() == Some(DESTINATION_IP) && target.port.unwrap_or(22) == 22
        && target.root == "/opt/synergy" && target.guest.is_none()
    { node_controller::qualification_host_pin(control, DESTINATION_HOST_KEY).map(Some) }
    else { Ok(None) }
}

struct Host {
    target: Target,
    known_hosts: PathBuf,
    identity: PathBuf,
}

impl Host {
    fn bind(target: Target, control: &Path, destination: bool) -> Result<Self, String> {
        let known_hosts = if destination { destination_pin(&target, control)?.ok_or(UNCERTAIN)? }
            else { node_controller::bootstrap_host_pin(&target, control)? };
        let identity = node_bootstrap::controller_operator_identity(&target, control)?
            .ok_or(if destination { "Select and load the existing synergy-testrpc SSH identity first." }
                   else { "Select and load the existing synergy-devrpc SSH identity first." })?;
        node_bootstrap::selected_operator_key(&identity)?;
        Ok(Self { target, known_hosts, identity })
    }

    fn spawn(&self, control: &Path, operation: &str) -> Result<Child, String> {
        let command = node_bootstrap::chain1266_relocation_command(operation)?;
        node_controller::remote_command_with_identity(&self.target, control, ACCOUNT, &command,
            Some(&self.known_hosts), Some(&self.identity))?
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true)
            .spawn().map_err(|_| UNCERTAIN.into())
    }

    async fn observe(&self, control: &Path, operation: &str, side: &str, records: bool) -> Result<Value, String> {
        let mut child = self.spawn(control, &mode(operation, records))?;
        drop(child.stdin.take());
        decode(&collect(&mut child).await?, side, records)
    }

    async fn require_loaded_identity(&self, control: &Path, message: &str) -> Result<(), String> {
        let status = crate::operator_auth::status(&self.target, control).await?;
        if status["ready"] != true {
            return Err(message.into());
        }
        Ok(())
    }
}

fn mode(operation: &str, records: bool) -> String {
    if records { format!("{operation}-records") } else { operation.into() }
}

async fn collect(child: &mut Child) -> Result<Value, String> {
    let mut bytes = Vec::new();
    child.stdout.take().ok_or(UNCERTAIN)?.take(65537)
        .read_to_end(&mut bytes).await.map_err(|_| UNCERTAIN)?;
    if bytes.len() > 65536 || !child.wait().await.map_err(|_| UNCERTAIN)?.success() {
        return Err(UNCERTAIN.into());
    }
    serde_json::from_slice(&bytes).map_err(|_| UNCERTAIN.into())
}

fn decode(value: &Value, side: &str, records: bool) -> Result<Value, String> {
    let review = &value["review"];
    let schema = if records { "nodenetwork-chain1266-records-relocation-v1" } else { "nodenetwork-chain1266-relocation-v1" };
    if !exact(value, &["side", "review", "relocated"]) || value["side"] != side
        || !value["relocated"].is_boolean() || side == "source" && value["relocated"] != false
        || !exact(review, &["schema", "source", "destination", "context", "assets", "total_bytes", "review_sha256"])
        || review["schema"] != schema || review["source"] != SOURCE_MACHINE
        || review["destination"] != DESTINATION_MACHINE || !pin(&review["review_sha256"])
        || review["context"] != json!({"chain_id":1266, "chain_incarnation":5, "genesis_hash":GENESIS})
    { return Err(UNCERTAIN.into()); }
    let mut unsigned = review.as_object().ok_or(UNCERTAIN)?.clone();
    unsigned.remove("review_sha256");
    let encoded = serde_json::to_vec(&unsigned.into_iter().collect::<std::collections::BTreeMap<_, _>>())
        .map_err(|_| UNCERTAIN)?;
    let assets = review["assets"].as_array().ok_or(UNCERTAIN)?;
    let names = ["coordinated-round-robin-finality.json", "identity-manifest.json",
        "identity.enc.json", "identity.pub.json"];
    let mut size = 0u64;
    let mut previous = "";
    let max = if records { 3 * 1024 * 1024 * 1024 } else { 40 * 1024 * 1024 };
    let count = if records { 216 } else { names.len() };
    if assets.len() != count { return Err(UNCERTAIN.into()); }
    for (i, asset) in assets.iter().enumerate() {
        let name = asset["file"].as_str().ok_or(UNCERTAIN)?;
        if !exact(asset, &["file", "bytes", "sha256"]) || !pin(&asset["sha256"])
            || name <= previous || name.len() > 85 || name.starts_with('.')
            || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            || !records && name != names[i]
        {
            return Err(UNCERTAIN.into());
        }
        previous = name;
        size += asset["bytes"].as_u64().filter(|n| *n <= 96 * 1024 * 1024)
            .ok_or(UNCERTAIN)?;
    }
    if review["total_bytes"] != size || size == 0 || size > max
        || review["review_sha256"] != format!("{:x}", Sha256::digest(encoded))
    { return Err(UNCERTAIN.into()); }
    Ok(value.clone())
}

async fn transfer(source: &Host, destination: &Host, control: &Path, review: &Value, records: bool)
    -> Result<Value, String>
{
    let challenge = format!("{}\n", review["review_sha256"].as_str().ok_or(UNCERTAIN)?);
    let mut export = source.spawn(control, &mode("export", records))?;
    let mut input = export.stdin.take().ok_or(UNCERTAIN)?;
    input.write_all(challenge.as_bytes()).await.map_err(|_| UNCERTAIN)?;
    input.shutdown().await.map_err(|_| UNCERTAIN)?;
    drop(input);
    let mut receiver = destination.spawn(control, &mode("receive", records))?;
    let mut output = receiver.stdin.take().ok_or(UNCERTAIN)?;
    output.write_all(challenge.as_bytes()).await.map_err(|_| UNCERTAIN)?;
    let size = review["total_bytes"].as_u64().ok_or(UNCERTAIN)? + MARKER.len() as u64;
    let mut bytes = export.stdout.take().ok_or(UNCERTAIN)?.take(size + 1);
    let copied = tokio::io::copy(&mut bytes, &mut output).await.map_err(|_| UNCERTAIN)?;
    if copied != size || !export.wait().await.map_err(|_| UNCERTAIN)?.success() {
        return Err(UNCERTAIN.into());
    }
    output.shutdown().await.map_err(|_| UNCERTAIN)?;
    drop(output);
    decode(&collect(&mut receiver).await?, "destination", records)
}

pub(super) async fn run(window: &tauri::WebviewWindow, target: &Target, control: &Path, apply: bool, records: bool)
    -> Result<Value, String>
{
    if !cfg!(debug_assertions) || target.kind != "remote" || target.host.as_deref() != Some(SOURCE_IP)
        || target.port.unwrap_or(22) != 22 || target.root != "/opt/synergy" || target.guest.is_some()
    { return Err("Select the exact synergy-devrpc administrative target.".into()); }
    let _serial = node_controller::SERIAL.lock().await;
    let peer = Target { kind: "remote".into(), host: Some(DESTINATION_IP.into()),
        port: Some(22), root: "/opt/synergy".into(), guest: None };
    let destination = Host::bind(peer, control, true)?;
    let source = if apply { Some(Host::bind(target.clone(), control, false)?) } else { None };
    let result = async {
        let observe = destination.observe(control, "destination-plan", "destination", records);
        let observe_timeout = Duration::from_secs(if records { 110 } else { 35 });
        let original = tokio::time::timeout(observe_timeout, observe).await.map_err(|_| UNCERTAIN)??;
        let Some(source) = &source else { return Ok(original) };
        if original["relocated"] == true { return Ok(original); }
        let observe = source.observe(control, "source-plan", "source", records);
        let expected = tokio::time::timeout(observe_timeout, observe).await.map_err(|_| UNCERTAIN)??;
        let review = expected["review"].clone();
        if original["review"] != review { return Err(UNCERTAIN.into()); }
        let prompt = window.clone();
        let path = if records { RECORDS_PATH } else { DESTINATION_PATH };
        let description = if records {
            "The reviewed files include gateway logs, released gateway binaries, configuration, archived gateway state, and a verified historical support snapshot. They stay inactive."
        } else { "The files contain the encrypted gateway identity, public identity and manifest, and the incarnation-4 finality history. The encrypted file stays encrypted." };
        let message = format!("Relocate reviewed Chain 1266 gateway files from synergy-devrpc to synergy-testrpc.\n\nDestination: {path}\nFiles: {}\nBytes: {}\nReview SHA-256: {}\n\n{description}\n\nThis action leaves the source and the running services in place.",
            review["assets"].as_array().ok_or(UNCERTAIN)?.len(), review["total_bytes"], review["review_sha256"]);
        let accepted = tauri::async_runtime::spawn_blocking(move || prompt.dialog().message(message).parent(&prompt)
            .title("Relocate verified Chain 1266 gateway files")
            .buttons(MessageDialogButtons::OkCancelCustom("Relocate reviewed files once".into(), "Cancel".into()))
            .blocking_show()).await.map_err(|_| "Chain 1266 relocation review interrupted.")?;
        if !accepted { return Ok(original); }
        let seconds = if records { 1200 } else { 180 };
        let receipt = tokio::time::timeout(Duration::from_secs(seconds), transfer(source, &destination, control, &review, records))
            .await.map_err(|_| UNCERTAIN)??;
        if receipt["review"] != review || receipt["relocated"] != true { return Err(UNCERTAIN.into()); }
        Ok(receipt)
    }.await;
    node_controller::close_connection_checked(&destination.target, control, ACCOUNT).await?;
    if source.is_some() { node_controller::close_connection_checked(target, control, ACCOUNT).await?; }
    result.map(|proof| json!({"version": 1, "ok": true, "result": proof}))
}

const RETIREMENT_RECEIPTS: [&str; 2] = [
    "fd7eac8b0d44082fa1ebb964e53730a49109a12023384f194ecf70ab0533af5c",
    "1be1629dad84d0ad0a7016345d9975e3d0bc73cbd8196a0a280336d9bbaaebae",
];
const RETIREMENT_UNCERTAIN: &str =
    "Chain 1266 retirement is unverified. Read the exact retirement status before another operation.";

fn decode_retirement(value: Value) -> Result<Value, String> {
    let review = &value["review"];
    if !exact(&value, &["review", "removed"]) || !value["removed"].is_boolean()
        || !exact(review, &["machine_sha256", "chain", "destination_receipts", "paths", "units", "review_sha256"])
        || review["machine_sha256"] != SOURCE_MACHINE
        || review["chain"] != json!({"chain_id":1266, "chain_incarnation":5, "genesis_hash":GENESIS})
        || review["destination_receipts"] != json!(RETIREMENT_RECEIPTS)
    {
        return Err(RETIREMENT_UNCERTAIN.into());
    }
    let paths = review["paths"].as_object().ok_or(RETIREMENT_UNCERTAIN)?;
    if paths.len() > 40 || paths.iter().any(|(path, entry)| {
        !path.starts_with('/') || path.len() > 175 || !path.bytes().all(|b| b.is_ascii_alphanumeric()
            || b"/_.-@".contains(&b)) || !exact(entry, &["entries", "bytes", "sha256"])
            || entry["entries"].as_u64().is_none() || entry["bytes"].as_u64().is_none()
            || !pin(&entry["sha256"])
    }) {
        return Err(RETIREMENT_UNCERTAIN.into());
    }
    let mut unsigned = review.as_object().ok_or(RETIREMENT_UNCERTAIN)?.clone();
    unsigned.remove("review_sha256");
    let bytes = serde_json::to_vec(&unsigned.into_iter().collect::<std::collections::BTreeMap<_, _>>())
        .map_err(|_| RETIREMENT_UNCERTAIN)?;
    if review["review_sha256"] != format!("{:x}", Sha256::digest(bytes)) {
        return Err(RETIREMENT_UNCERTAIN.into());
    }
    Ok(value)
}

async fn retirement_source(host: &Host, control: &Path, pin: Option<&str>) -> Result<Value, String> {
    let operation = if pin.is_some() { "source-retire" } else { "source-retire-plan" };
    let mut child = host.spawn(control, operation).map_err(|_| RETIREMENT_UNCERTAIN)?;
    let mut input = child.stdin.take().ok_or(RETIREMENT_UNCERTAIN)?;
    if let Some(pin) = pin {
        input.write_all(format!("{pin}\n").as_bytes()).await.map_err(|_| RETIREMENT_UNCERTAIN)?;
    }
    drop(input);
    decode_retirement(collect(&mut child).await.map_err(|_| RETIREMENT_UNCERTAIN)?)
}

async fn verify_relocation_receipts(destination: &Host, control: &Path) -> Result<(), String> {
    for (slot, receipt) in RETIREMENT_RECEIPTS.into_iter().enumerate() {
        let response = tokio::time::timeout(Duration::from_secs(75),
            destination.observe(control, "status", "destination", slot == 1))
            .await.map_err(|_| RETIREMENT_UNCERTAIN)??;
        if response["relocated"] != true || response["review"]["review_sha256"] != receipt {
            return Err("The destination must verify both exact Chain 1266 relocation receipts.".into());
        }
    }
    Ok(())
}

pub(super) async fn run_retirement(
    window: &tauri::WebviewWindow, target: &Target, control: &Path, apply: bool,
) -> Result<Value, String> {
    if !cfg!(debug_assertions) || target.kind != "remote" || target.host.as_deref() != Some(SOURCE_IP)
        || target.port.unwrap_or(22) != 22 || target.root != "/opt/synergy" || target.guest.is_some()
    {
        return Err("Select the exact synergy-devrpc administrative target.".into());
    }
    let _serial = node_controller::SERIAL.lock().await;
    let peer = Target { kind: "remote".into(), host: Some(DESTINATION_IP.into()),
        port: Some(22), root: "/opt/synergy".into(), guest: None };
    let destination = Host::bind(peer, control, true)?;
    let source = Host::bind(target.clone(), control, false)?;
    let result = async {
        const SOURCE_LEASE: &str = "Load the existing synergy-devrpc SSH credential in Portal before reviewing retirement.";
        const DESTINATION_LEASE: &str = "Load the existing synergy-testrpc SSH credential in Portal before verifying migration receipts.";
        source.require_loaded_identity(control, SOURCE_LEASE).await?;
        destination.require_loaded_identity(control, DESTINATION_LEASE).await?;
        verify_relocation_receipts(&destination, control).await?;
        let observed = tokio::time::timeout(Duration::from_secs(100), retirement_source(&source, control, None))
            .await.map_err(|_| RETIREMENT_UNCERTAIN)??;
        if !apply || observed["removed"] == true {
            return Ok(observed);
        }
        let review = &observed["review"];
        let paths = review["paths"].as_object().ok_or(RETIREMENT_UNCERTAIN)?;
        let digest = review["review_sha256"].as_str().ok_or(RETIREMENT_UNCERTAIN)?;
        let bytes: u64 = paths.values().map(|entry| entry["bytes"].as_u64().unwrap_or(0)).sum();
        let message = format!("Permanently retire the old Chain 1266 installation on synergy-devrpc.\n\nBoth relocation receipts and the independent synergy-testrpc connection to Val1 were verified.\n\n{} attributed paths, {bytes} bytes.\nReview SHA-256: {digest}\n\n{}",
            paths.len(), paths.keys().cloned().collect::<Vec<_>>().join("\n"));
        let prompt = window.clone();
        let approved = tauri::async_runtime::spawn_blocking(move || prompt.dialog().message(message).parent(&prompt)
            .title("Retire reviewed Chain 1266 installation")
            .buttons(MessageDialogButtons::OkCancelCustom("Retire reviewed Chain 1266 files".into(), "Cancel".into()))
            .blocking_show()).await.map_err(|_| RETIREMENT_UNCERTAIN)?;
        if !approved {
            return Ok(observed);
        }
        source.require_loaded_identity(control, SOURCE_LEASE).await?;
        destination.require_loaded_identity(control, DESTINATION_LEASE).await?;
        verify_relocation_receipts(&destination, control).await?;
        let result = tokio::time::timeout(Duration::from_secs(180), retirement_source(&source, control, Some(digest)))
            .await.map_err(|_| RETIREMENT_UNCERTAIN)??;
        if result["removed"] != true || &result["review"] != review {
            return Err(RETIREMENT_UNCERTAIN.into());
        }
        Ok(result)
    }.await;
    let destination_closed = node_controller::close_connection_checked(&destination.target, control, ACCOUNT).await;
    let source_closed = node_controller::close_connection_checked(target, control, ACCOUNT).await;
    destination_closed?;
    source_closed?;
    result.map(|proof| json!({"version":1, "ok":true, "result":proof}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_current_master_review_and_rejects_another_genesis() {
        let script = include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"), "/chain1266_gateway_relocation.py"));
        let fixture = format!("__name__='fixture'\n{script}\nprint(encoded({{'side':'source','review':review(),'relocated':False}}).decode())");
        let output = std::process::Command::new("python3").args(["-BI", "-c", &fixture]).output().unwrap();
        assert!(output.status.success());
        let mut value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(decode(&value, "source", false).is_ok());
        value["review"]["context"]["genesis_hash"] = json!("wrong");
        assert!(decode(&value, "source", false).is_err());
    }

    #[test]
    fn records_commitment_has_separate_scope() {
        let script = include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"), "/chain1266_gateway_relocation.py"));
        let fixture = format!("__name__='fixture'\n{script}\nselect_records()\nprint(encoded({{'side':'source','review':review(),'relocated':False}}).decode())");
        let output = std::process::Command::new("python3").args(["-BI", "-c", &fixture]).output().unwrap();
        assert!(output.status.success());
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(decode(&value, "source", true).is_ok());
        assert!(decode(&value, "source", false).is_err());
    }
}
