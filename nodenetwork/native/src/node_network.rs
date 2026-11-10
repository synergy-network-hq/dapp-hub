//! Read-only local host discovery. It grants no installation or signing authority.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, Component}};

fn read_public_bytes(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let relative = Path::new(relative);
    if relative.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Invalid public installation path".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        if fs::symlink_metadata(&path).map_err(|_| "Public installation metadata is inaccessible")?.file_type().is_symlink() {
            return Err("Installation metadata contains a symlink".into());
        }
    }
    let metadata = fs::metadata(&path).map_err(|_| "Public installation metadata is inaccessible")?;
    if !metadata.is_file() || metadata.len() > 1_000_000 {
        return Err("Public installation metadata exceeds its limit".into());
    }
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|_| "Public installation metadata is inaccessible")?
        .take(1_000_001).read_to_end(&mut bytes).map_err(|_| "Cannot read public installation metadata")?;
    if bytes.len() > 1_000_000 { return Err("Public installation metadata exceeds its limit".into()); }
    Ok(bytes)
}

fn read_public(root: &Path, relative: &str) -> Result<Value, String> {
    serde_json::from_slice(&read_public_bytes(root, relative)?)
        .map_err(|_| "Invalid public installation metadata".into())
}

/// A review of the master manifest, never release authorization or execution.
pub fn review_master(root: &Path) -> Result<Value, String> {
    if root.file_name().and_then(|name| name.to_str()) != Some("Synergy")
        || root.ancestors().any(|p| !fs::symlink_metadata(p).is_ok_and(|m| m.is_dir()))
    {
        return Err("Choose the direct Synergy master directory.".into());
    }
    let bytes = read_public_bytes(root, "package.json")?;
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid master manifest")?;
    if manifest["format"] != "synergy-universal-linux-v1" || manifest["architecture"] != "x86_64" {
        return Err("Unsupported Synergy Linux master format.".into());
    }
    let files = manifest["files"].as_object().filter(|m| (1..=4096).contains(&m.len()))
        .ok_or("Missing master file inventory")?;
    for name in ["bin/synergy-node", "tools/synergy_linux.py", "tools/lifecycle.py", "lib/apqe/build-report.json"] {
        if !files.contains_key(name) { return Err("Master inventory is missing a required component.".into()); }
    }
    let release = manifest["release_id"].as_str().filter(|id|
        (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)))
        .ok_or("Invalid master release identifier")?;
    Ok(json!({"release":release,"architecture":"Linux x86_64","fileCount":files.len(),
        "manifestSha256":format!("{:x}", Sha256::digest(&bytes)),
        "releaseTrustVerified":false,"installAuthorized":false}))
}

fn inspect(root: &Path) -> Result<Value, String> {
    // Inspect every ancestor: an internal-looking path must not resolve elsewhere.
    for ancestor in root.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => return Err("Installation root is not a direct directory".into()),
            Ok(_) => {},
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && ancestor == root =>
                return Ok(json!({"installed":false,"root":root,"qualification":"not-verified","controlAvailable":false})),
            Err(_) => return Err("Installation root is inaccessible; absence is not established".into()),
        }
    }
    let receipt = read_public(root, "installation.json")?;
    if receipt.get("root").and_then(Value::as_str) != root.to_str() {
        return Err("Installation receipt names a different root".into());
    }
    Ok(json!({"installed":true,"root":root,"qualification":"not-verified","controlAvailable":false,
        "chainId":receipt.get("chain_id"),"networkId":receipt.get("network_id"),
        "packageSha256":receipt.get("package_sha256"),"role":receipt.get("role")}))
}

pub fn status() -> Result<Value, String> {
    if !cfg!(target_os = "linux") {
        return Ok(json!({"platform":std::env::consts::OS,"localValidatorSupported":false,
            "controlAvailable":false,"qualification":"not-verified",
            "reason":"The current master validator package targets Linux x86_64. Use an authenticated remote Linux target."}));
    }
    let mut value = inspect(Path::new("/opt/Synergy"))?;
    value["platform"] = json!(std::env::consts::OS);
    value["localValidatorSupported"] = json!(cfg!(target_arch = "x86_64"));
    Ok(value)
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn refuses_traversal_before_opening_any_public_file() {
        assert_eq!(read_public(Path::new("/opt/Synergy"), "../keys/unlock").unwrap_err(), "Invalid public installation path");
        assert!(read_public(Path::new("/opt/Synergy"), "/root/file").is_err());
    }
    #[test] fn host_discovery_never_grants_control_authority() {
        if !cfg!(target_os="linux") {
            let value=status().unwrap();
            assert_eq!(value["controlAvailable"],false);
            assert_eq!(value["qualification"],"not-verified");
        }
    }
    #[test] fn master_review_hashes_exact_bytes_without_granting_authority() {
        // Use the operator's selected artifact when explicitly supplied.
        let Some(path) = std::env::var_os("SYNERGY_NODE_MASTER_TEST_PATH") else { return };
        let root = Path::new(&path);
        let value = review_master(root).unwrap();
        assert_eq!(value["manifestSha256"], format!("{:x}", Sha256::digest(fs::read(root.join("package.json")).unwrap())));
        assert_eq!(value["releaseTrustVerified"], false);
        assert_eq!(value["installAuthorized"], false);
    }
}
