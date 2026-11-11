//! Read-only local host discovery. It grants no installation or signing authority.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, Component}};

fn public_path(root: &Path, relative: &str) -> Result<std::path::PathBuf, String> {
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
    Ok(path)
}
fn read_public_bytes(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let path = public_path(root, relative)?;
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

fn provider_digest(root: &Path, name: &str) -> Result<String, String> {
    use std::io::Read;
    const MAX: u64 = 64 * 1024 * 1024;
    let path = public_path(root, name)?;
    let metadata = fs::metadata(&path).map_err(|_| "APQE provider library is inaccessible")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX {
        return Err("APQE provider library is not a bounded regular file".into());
    }
    let file = fs::File::open(path).map_err(|_| "APQE provider library is inaccessible")?;
    let mut file = file.take(MAX + 1);
    let mut hash = Sha256::new();
    let mut total = 0;
    let mut chunk = [0u8; 65536];
    loop {
        let n = file.read(&mut chunk).map_err(|_| "Cannot hash APQE provider library")?;
        if n == 0 { break; }
        total += n as u64;
        if total > MAX { return Err("APQE provider library exceeds size limit".into()); }
        hash.update(&chunk[..n]);
    }
    if total != metadata.len() { return Err("APQE provider library changed during inspection".into()); }
    Ok(format!("{:x}", hash.finalize()))
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
    let apqe = &manifest["apqe_provider"];
    let report_path = "lib/apqe/build-report.json";
    let report_bytes = read_public_bytes(root, report_path)?;
    let report_sha = format!("{:x}", Sha256::digest(&report_bytes));
    if apqe["report_path"] != report_path || apqe["report_sha256"] != report_sha
        || files.get(report_path).and_then(Value::as_str) != Some(report_sha.as_str())
        || apqe["profile"] != "PQ-VSESSION-01-candidate-v1" || apqe["production_qualified"] != false {
        return Err("Master APQE report bytes or engineering profile do not match the package manifest.".into());
    }
    let report: Value = serde_json::from_slice(&report_bytes).map_err(|_| "Invalid APQE build report")?;
    let libraries = report["artifacts"].as_array().filter(|a| a.len()==8)
        .ok_or("Master APQE report must declare all eight provider artifacts")?;
    if report["validation"] != false || report["required_variant_count"] != 8
        || report["backend_policy"]["selected_backend"] != "portable" {
        return Err("Master APQE report does not declare the expected portable engineering provider.".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for library in libraries {
        let name = library["path"].as_str().filter(|n| n.starts_with("libaegis") && n.ends_with(".so")
            && n.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)))
            .ok_or("Unsafe APQE library name")?;
        let hash = library["sha256"].as_str().filter(|h| h.len()==64
            && h.bytes().all(|b|b.is_ascii_digit()|| (b'a'..=b'f').contains(&b)))
            .ok_or("Invalid APQE library digest")?;
        let relative = format!("lib/apqe/{name}");
        if !seen.insert(name) || files.get(&relative).and_then(Value::as_str)!=Some(hash) {
            return Err("APQE library inventory differs between the master manifest and build report.".into());
        }
        if provider_digest(root, &relative)? != hash {
            return Err("APQE provider library bytes differ from the declared digest.".into());
        }
    }
    let release = manifest["release_id"].as_str().filter(|id|
        (1..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)))
        .ok_or("Invalid master release identifier")?;
    Ok(json!({"release":release,"architecture":"Linux x86_64","fileCount":files.len(),
        "manifestSha256":format!("{:x}", Sha256::digest(&bytes)),
        "apqeReportSha256":report_sha,"apqeProfile":apqe["profile"],"apqeLibraryCount":libraries.len(),
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
    #[test] fn master_review_refuses_altered_provider_bytes() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().canonicalize().unwrap()
            .join(format!("nodenetwork-master-{}-{nonce}", std::process::id()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
        fs::create_dir(&base).unwrap();
        let _cleanup = Cleanup(base.clone());
        let root = base.join("Synergy");
        fs::create_dir_all(root.join("lib/apqe")).unwrap();
        let mut files = serde_json::Map::new();
        let mut artifacts = Vec::new();
        for n in 0..8 {
            let name = format!("libaegis-test-{n}.so");
            let path = format!("lib/apqe/{name}");
            let content = format!("test provider artifact {n}");
            let digest = format!("{:x}", Sha256::digest(content.as_bytes()));
            fs::write(root.join(&path), content).unwrap();
            files.insert(path, json!(digest));
            artifacts.push(json!({"path":name,"sha256":digest}));
        }
        let report = json!({"artifacts":artifacts,"validation":false,"required_variant_count":8,
            "backend_policy":{"selected_backend":"portable"}}).to_string();
        let report_path = "lib/apqe/build-report.json";
        fs::write(root.join(report_path), &report).unwrap();
        let digest = format!("{:x}", Sha256::digest(report.as_bytes()));
        files.insert(report_path.into(), json!(digest));
        for name in ["bin/synergy-node", "tools/synergy_linux.py", "tools/lifecycle.py"] {
            files.insert(name.into(), json!("0".repeat(64)));
        }
        fs::write(root.join("package.json"), json!({"format":"synergy-universal-linux-v1",
            "architecture":"x86_64","release_id":"test-fixture","files":files,
            "apqe_provider":{"profile":"PQ-VSESSION-01-candidate-v1","production_qualified":false,
            "report_path":report_path,"report_sha256":digest}}).to_string()).unwrap();
        let value = review_master(&root).unwrap();
        assert_eq!(value["apqeLibraryCount"], 8);
        assert_eq!(value["installAuthorized"], false);
        fs::write(root.join("lib/apqe/libaegis-test-0.so"), b"changed").unwrap();
        assert!(review_master(&root).unwrap_err().contains("library bytes differ"));
        fs::write(root.join(report_path), format!("{report}\n")).unwrap();
        assert!(review_master(&root).unwrap_err().contains("report bytes"));
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
