//! Read-only local host discovery. It grants no installation or signing authority.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, Component}};
use super::node_bootstrap::matches_builtin_release;

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

/// A read-only inventory and byte consistency check against the selected manifest.
pub fn review_master(root: &Path) -> Result<Value, String> {
    if root.file_name().and_then(|name| name.to_str()) != Some("synergy")
        || root.ancestors().any(|p| !fs::symlink_metadata(p).is_ok_and(|m| m.is_dir()))
    {
        return Err("Choose the direct lowercase synergy master directory.".into());
    }
    #[cfg(unix)]
    let (folder, bytes) = super::node_master_review::read_manifest(root)?;
    #[cfg(not(unix))]
    if root.ancestors().any(|p| !fs::symlink_metadata(p).is_ok_and(|m| m.is_dir())) {
        return Err("Choose the direct Synergy master directory.".into());
    }
    #[cfg(not(unix))]
    let bytes = read_public_bytes(root, "package.json")?;
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid master manifest")?;
    if manifest["format"] != "synergy-universal-linux-v1" || manifest["architecture"] != "x86_64" {
        return Err("Unsupported Synergy Linux master format.".into());
    }
    let files = manifest["files"].as_object().filter(|m| (1..=4096).contains(&m.len()))
        .ok_or("Missing master file inventory")?;
    for name in ["bin/synergy-node", "tools/synergy_linux.py", "tools/lifecycle.py", "lib/apqe/build-report.json", "roles/roles.json"] {
        if !files.contains_key(name) { return Err("Master inventory is missing a required component.".into()); }
    }
    let roles_bytes = read_public_bytes(root, "roles/roles.json")?;
    let roles_sha = format!("{:x}", Sha256::digest(&roles_bytes));
    if files["roles/roles.json"] != roles_sha { return Err("Master role catalog digest differs.".into()); }
    let catalog: Value = serde_json::from_slice(&roles_bytes).map_err(|_| "Invalid master role catalog")?;
    let roles = catalog["roles"].as_array().filter(|roles| (1..=64).contains(&roles.len()))
        .ok_or("Invalid master role count")?;
    let mut roles_seen = std::collections::BTreeSet::new();
    for role in roles {
        let id = role.as_str().filter(|id| !id.is_empty() && id.len()<=64
            && id.as_bytes()[0].is_ascii_lowercase() && id.bytes().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||b"_-".contains(&c)))
            .ok_or("Invalid master role ID")?;
        if !roles_seen.insert(id) { return Err("Duplicate master role ID.".into()); }
    }
    if !roles_seen.contains("validator") { return Err("Master does not declare the validator role.".into()); }
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
    let manifest_sha256 = format!("{:x}", Sha256::digest(&bytes));
    #[cfg(unix)]
    let inventory = super::node_master_review::review(&folder, &manifest, &manifest_sha256);
    #[cfg(not(unix))]
    let inventory = json!({"status":"unavailable","reason":"platform"});
    let allowed_engineering_runtime = matches_builtin_release(release, &manifest_sha256);
    Ok(json!({"release":release,"architecture":"Linux x86_64","fileCount":files.len(),
        "apqeReportSha256":report_sha,"apqeProfile":apqe["profile"],"apqeLibraryCount":libraries.len(),"roleCatalog":roles,
        "manifestSha256":manifest_sha256,"inventory":inventory,
        "allowedEngineeringRuntime":allowed_engineering_runtime,"archiveLimitBytes":super::node_bootstrap::archive_limit(&manifest)?,
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
    let mut value = inspect(Path::new("/opt/synergy"))?;
    value["platform"] = json!(std::env::consts::OS);
    value["localValidatorSupported"] = json!(cfg!(target_arch = "x86_64"));
    Ok(value)
}

#[cfg(test)] mod tests {
    use super::*;
    #[cfg(unix)]
    const FIXTURE_MEMBERS: [&str; 4] = ["bin/synergy-node", "tools/synergy_linux.py", "tools/lifecycle.py", "lib/apqe/build-report.json"];

    #[cfg(unix)]
    struct MasterFixture(std::path::PathBuf);

    #[cfg(unix)]
    impl MasterFixture {
        fn new() -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().canonicalize().unwrap()
                .join(format!("nodenetwork-master-{}-{stamp}-{sequence}", std::process::id()));
            fs::create_dir(&path).unwrap();
            let fixture = Self(path);
            let root = fixture.root();
            let mut files = serde_json::Map::new();
            for name in FIXTURE_MEMBERS {
                let member = root.join(name);
                fs::create_dir_all(member.parent().unwrap()).unwrap();
                fs::write(member, name).unwrap();
                files.insert(name.into(), json!(format!("{:x}", Sha256::digest(name.as_bytes()))));
            }
            let manifest = json!({"release_id":"local-test","format":"synergy-universal-linux-v1","architecture":"x86_64","files":files});
            fs::write(root.join("package.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
            fixture.declare_file("roles/roles.json",br#"{"roles":["validator"],"implemented":["validator"]}"#);
            fixture.with_apqe_candidate();
            fixture
        }
        fn root(&self) -> std::path::PathBuf { self.0.join("synergy") }

        fn declare_file(&self, name: &str, bytes: &[u8]) {
            let member = self.root().join(name);
            fs::create_dir_all(member.parent().unwrap()).unwrap();
            fs::write(member, bytes).unwrap();
            let manifest_path = self.root().join("package.json");
            let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
            manifest["files"][name] = json!(format!("{:x}", Sha256::digest(bytes)));
            fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        }

        fn with_owner_layout(&self, implemented: &[&str]) -> Vec<&'static str> {
            // Names are the pinned owner's NodeRole taxonomy in build_package.py order.
            let roles = vec!["validator", "sentry", "archive", "consensus_audit", "cross_chain", "witness",
                "oracle", "uma_coordinator", "synq_execution", "network_analytics", "aegis_cryptography",
                "data_availability", "ai_compute", "ai_coordination", "ai_data", "ai_assurance", "rpc_gateway",
                "indexer", "observer_light", "bootseed"];
            let root = self.root();
            for role in &roles { fs::create_dir_all(root.join("roles").join(role)).unwrap(); }
            for area in ["keys", "data", "run", "logs", "cache", "tmp", "vpn", "snapshots", "recovery", "evidence"] {
                fs::create_dir(root.join(area)).unwrap();
            }
            for path in ["bin/synergy-node", "bin/synergy-keytool", "bin/synergy-genesis", "bin/netbird"] {
                self.declare_file(path, b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\0\0\x3e\x00");
            }
            self.declare_file("roles/roles.json", &serde_json::to_vec(&json!({"roles":roles,"implemented":implemented})).unwrap());
            roles
        }

        fn with_apqe_candidate(&self) -> Value {
            let mut artifacts = Vec::new();
            for index in 0..8 {
                let name = format!("libaegisvariant{index}.so");
                let bytes = format!("owner-compatible synthetic library {index}");
                self.declare_file(&format!("lib/apqe/{name}"), bytes.as_bytes());
                artifacts.push(json!({"path":name,"sha256":format!("{:x}",Sha256::digest(bytes.as_bytes()))}));
            }
            let report = json!({"validation":false,"backend_policy":{"selected_backend":"portable"},
                "required_variant_count":8,"artifacts":artifacts});
            self.declare_apqe_report(&report);
            report
        }

        fn declare_apqe_report(&self, report: &Value) {
            let path = "lib/apqe/build-report.json";
            self.declare_file(path, &serde_json::to_vec(report).unwrap());
            let manifest_path = self.root().join("package.json");
            let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
            manifest["apqe_provider"] = json!({"report_path":path,"report_sha256":manifest["files"][path],
                "profile":"PQ-VSESSION-01-candidate-v1","production_qualified":false});
            fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        }
    }

    #[cfg(unix)]
    impl Drop for MasterFixture {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[cfg(unix)]
    #[test]
    fn master_review_matches_bounded_bytes_without_promotion_to_approval() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        fs::write(root.join("bin/._synergy-node"), b"AppleDouble sidecar").unwrap();
        let result = review_master(&root).unwrap();
        let manifest:Value=serde_json::from_slice(&fs::read(root.join("package.json")).unwrap()).unwrap();
        let members=manifest["files"].as_object().unwrap();
        let size:u64=members.keys().map(|name|fs::metadata(root.join(name)).unwrap().len()).sum();
        assert_eq!(result["inventory"]["status"],"matched");
        assert_eq!(result["inventory"]["verifiedFiles"],members.len());
        assert_eq!(result["inventory"]["verifiedBytes"],size);
        assert_eq!(result["inventory"]["layout"],json!({"roles":false,"runtimeAreas":false,"linuxHeaders":false}));
        assert_eq!(result["inventory"]["apqeProvider"]["status"],"matched");
        let bytes = fs::read(root.join("package.json")).unwrap();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(result["manifestSha256"], hash);
        assert_eq!(result["allowedEngineeringRuntime"], false);
        assert_eq!(result["releaseTrustVerified"], false);
        assert_eq!(result["installAuthorized"], false);

        // The public release ID alone cannot make other manifest bytes match the pin.
        let mut manifest: Value = serde_json::from_slice(&bytes).unwrap();
        manifest["release_id"] = json!("synergy-linux-389c509e47e55219");
        fs::write(root.join("package.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        let result = review_master(&root).unwrap();
        assert_eq!(result["inventory"]["status"], "matched");
        assert_eq!(result["allowedEngineeringRuntime"], false);
        assert_eq!(result["releaseTrustVerified"], false);
        assert_eq!(result["installAuthorized"], false);
    }

    #[cfg(unix)]
    #[test]
    fn master_review_binds_the_portable_apqe_report_to_the_eight_verified_libraries() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        fixture.with_apqe_candidate();
        let result = review_master(&root).unwrap();
        let verified_report = fs::read(root.join("lib/apqe/build-report.json")).unwrap();
        assert_eq!(result["inventory"]["apqeProvider"], json!({"status":"matched","libraryCount":8,
            "reportSha256":format!("{:x}",Sha256::digest(&verified_report))}));
        assert_eq!(result["releaseTrustVerified"], false);
        assert_eq!(result["installAuthorized"], false);

        let manifest_path = root.join("package.json");
        let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["apqe_provider"]["production_qualified"] = json!(true);
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(review_master(&root).unwrap_err().contains("engineering profile"));

        manifest["apqe_provider"]["production_qualified"] = json!(false);
        manifest["apqe_provider"]["report_sha256"] = json!("0".repeat(64));
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(review_master(&root).unwrap_err().contains("report bytes"));

        manifest["apqe_provider"]["report_sha256"] = json!(format!("{:x}",Sha256::digest(&verified_report)));
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let mut different_report = verified_report.clone();
        different_report.push(b'\n');
        fs::write(root.join("lib/apqe/build-report.json"), different_report).unwrap();
        assert!(review_master(&root).unwrap_err().contains("report bytes"));
        fs::write(root.join("lib/apqe/build-report.json"), &verified_report).unwrap();

        fs::write(root.join("lib/apqe/libaegisvariant0.so"), b"changed binary bytes").unwrap();
        assert!(review_master(&root).unwrap_err().contains("library bytes"));
    }

    #[cfg(unix)]
    #[test]
    fn master_review_refuses_inconsistent_apqe_report_scope_even_for_matching_package_digests() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        let report = fixture.with_apqe_candidate();
        let mut changed = report.clone();
        changed["backend_policy"]["selected_backend"] = json!("optimized");
        fixture.declare_apqe_report(&changed);
        assert!(review_master(&root).unwrap_err().contains("portable engineering provider"));

        let first = &report["artifacts"][0];
        for value in [json!({"path":"../libaegisvariant0.so","sha256":first["sha256"]}),
            json!({"path":first["path"],"sha256":"0".repeat(64)}), report["artifacts"][1].clone()] {
            let mut changed = report.clone();
            changed["artifacts"][0] = value;
            fixture.declare_apqe_report(&changed);
            assert!(review_master(&root).is_err());
        }

        fixture.declare_apqe_report(&report);
        fixture.declare_file("lib/apqe/libaegisextra.so", b"unexpected declared library");
        assert_eq!(review_master(&root).unwrap()["inventory"]["apqeProvider"]["reason"], "libraries_mismatch");
    }

    #[cfg(unix)]
    #[test]
    fn master_review_checks_owner_layout_with_manifest_consistent_binary_bytes() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        fixture.with_owner_layout(&["validator"]);
        let result = review_master(&root).unwrap();
        assert_eq!(result["inventory"]["layout"], json!({"roles":true,"runtimeAreas":true,"linuxHeaders":true}));
        assert_eq!(result["releaseTrustVerified"], false);
        assert_eq!(result["installAuthorized"], false);

        fixture.declare_file("bin/netbird", b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\0\0\xb7\x00");
        fs::remove_dir(root.join("run")).unwrap();
        let result = review_master(&root).unwrap();
        assert_eq!(result["inventory"]["status"], "matched");
        assert_eq!(result["inventory"]["layout"], json!({"roles":true,"runtimeAreas":false,"linuxHeaders":false}));

        fs::write(root.join("bin/netbird"), b"changed outside manifest").unwrap();
        let result = review_master(&root).unwrap();
        assert_eq!(result["inventory"]["status"], "unavailable");
        assert!(result["inventory"].get("layout").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn master_review_checks_role_catalog_gateway_and_runtime_directory_contents() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        let mut roles = fixture.with_owner_layout(&["validator", "rpc_gateway"]);
        assert_eq!(review_master(&root).unwrap()["inventory"]["layout"]["roles"], false);
        fixture.declare_file("tools/canary_rpc_relay.py", b"fixture relay bytes");
        assert_eq!(review_master(&root).unwrap()["inventory"]["layout"]["roles"], true);

        fs::create_dir(root.join("roles/unexpected")).unwrap();
        fs::write(root.join("keys/._sidecar"), b"fixture metadata").unwrap();
        let result = review_master(&root).unwrap();
        assert_eq!(result["inventory"]["status"], "matched");
        assert_eq!(result["inventory"]["layout"], json!({"roles":false,"runtimeAreas":false,"linuxHeaders":true}));
        fs::remove_dir(root.join("roles/unexpected")).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["layout"]["roles"], true);

        roles.push("validator");
        fixture.declare_file("roles/roles.json", &serde_json::to_vec(&json!({"roles":roles,"implemented":["validator"]})).unwrap());
        assert!(review_master(&root).unwrap_err().contains("Duplicate master role"));
    }

    #[cfg(unix)]
    #[test]
    fn master_review_refuses_modified_missing_and_undeclared_files() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        let original = FIXTURE_MEMBERS[0];
        let file = root.join(original);
        fs::write(&file, vec![b'x'; original.len()]).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "digest_mismatch");
        fs::remove_file(&file).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "inventory_mismatch");
        fs::write(&file, original).unwrap();
        let unexpected = root.join("undeclared");
        fs::write(&unexpected, b"extra").unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "inventory_mismatch");
        fs::remove_file(unexpected).unwrap();
        fs::OpenOptions::new().write(true).open(file).unwrap().set_len(super::super::node_bootstrap::MAX_ARCHIVE + 1).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "limits");
    }

    #[cfg(unix)]
    #[test]
    fn master_review_rejects_direct_indirection_and_invalid_manifest_entries() {
        let fixture = MasterFixture::new();
        let root = fixture.root();
        let member = root.join(FIXTURE_MEMBERS[0]);
        let link_target = fixture.0.join("outside");
        fs::rename(&member, &link_target).unwrap();
        std::os::unix::fs::symlink(&link_target, &member).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "unsafe_member");
        fs::remove_file(&member).unwrap();
        fs::hard_link(&link_target, &member).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "unsafe_member");
        fs::remove_file(link_target).unwrap();
        let alias = fixture.0.join("alias");
        std::os::unix::fs::symlink(&fixture.0, &alias).unwrap();
        assert!(review_master(&alias.join("synergy")).is_err());
        let manifest_path = root.join("package.json");
        let mut manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["files"][FIXTURE_MEMBERS[0]] = json!("not-a-sha256");
        fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert_eq!(review_master(&root).unwrap()["inventory"]["reason"], "invalid_inventory");
    }

    #[test] fn refuses_traversal_before_opening_any_public_file() {
        assert_eq!(read_public(Path::new("/opt/synergy"), "../keys/unlock").unwrap_err(), "Invalid public installation path");
        assert!(read_public(Path::new("/opt/synergy"), "/root/file").is_err());
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
        let root = base.join("synergy");
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
        fs::create_dir(root.join("roles")).unwrap();
        let roles = br#"{"roles":["validator","archive"],"implemented":["validator"]}"#;
        fs::write(root.join("roles/roles.json"), roles).unwrap();
        files.insert("roles/roles.json".into(), json!(format!("{:x}", Sha256::digest(roles))));
        for name in ["bin/synergy-node", "tools/synergy_linux.py", "tools/lifecycle.py"] {
            files.insert(name.into(), json!("0".repeat(64)));
        }
        fs::write(root.join("package.json"), json!({"format":"synergy-universal-linux-v1",
            "architecture":"x86_64","release_id":"test-fixture","files":files,
            "apqe_provider":{"profile":"PQ-VSESSION-01-candidate-v1","production_qualified":false,
            "report_path":report_path,"report_sha256":digest}}).to_string()).unwrap();
        let value = review_master(&root).unwrap();
        assert_eq!(value["apqeLibraryCount"], 8);
        assert_eq!(value["roleCatalog"], json!(["validator","archive"]));
        assert_eq!(value["installAuthorized"], false);
        fs::write(root.join("roles/roles.json"), b"{}").unwrap();
        assert!(review_master(&root).unwrap_err().contains("role catalog digest differs"));
        fs::write(root.join("roles/roles.json"), roles).unwrap();
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
        let pin = format!("{:x}", Sha256::digest(fs::read(root.join("package.json")).unwrap()));
        assert_eq!(value["manifestSha256"], pin);
        assert_eq!(value["allowedEngineeringRuntime"], matches_builtin_release(value["release"].as_str().unwrap(), &pin));
        assert_eq!(value["releaseTrustVerified"], false);
        assert_eq!(value["installAuthorized"], false);
    }
}
