//! Bounded inspection of an operator-selected folder before any target is configured.
mod apqe;

use super::node_bootstrap::{declared_files, safe_member, archive_limit};
use rustix::fd::OwnedFd;
use rustix::fs::{self, AtFlags, Dir, FileType, Mode, OFlags, Stat};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::CStr;
use std::io::Read;
use std::path::{Component, Path};

const DIRECTORY: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::CLOEXEC);
const FILE: OFlags = OFlags::RDONLY
    .union(OFlags::NOFOLLOW)
    .union(OFlags::NONBLOCK)
    .union(OFlags::CLOEXEC);
const MANIFEST_LIMIT: u64 = 1_000_000;
const MEMBER_LIMIT: usize = 8192;
const ROLE_CATALOG: &str = "roles/roles.json";
const ROLE_CATALOG_LIMIT: u64 = 16 * 1024;
const RUNTIME_AREAS: [&str; 10] = [
    "keys",
    "data",
    "run",
    "logs",
    "cache",
    "tmp",
    "vpn",
    "snapshots",
    "recovery",
    "evidence",
];
const LINUX_BINARIES: [&str; 4] = [
    "bin/synergy-node",
    "bin/synergy-keytool",
    "bin/synergy-genesis",
    "bin/netbird",
];
const ELF_HEADER_SIZE: u64 = 20;

pub(super) fn read_manifest(root: &Path) -> Result<(OwnedFd, Vec<u8>), String> {
    const INVALID_ROOT: &str = "Choose the direct Synergy master directory.";
    let mut folder = fs::open("/", DIRECTORY, Mode::empty()).map_err(|_| INVALID_ROOT)?;
    for component in root.components().skip(1) {
        let Component::Normal(part) = component else {
            return Err(INVALID_ROOT.into());
        };
        folder = fs::openat(&folder, part, DIRECTORY, Mode::empty()).map_err(|_| INVALID_ROOT)?;
    }
    let member = c"package.json";
    let metadata = fs::statat(&folder, member, AtFlags::SYMLINK_NOFOLLOW)
        .map_err(|_| "Cannot inspect the master manifest.")?;
    if metadata.st_size < 0 || metadata.st_size as u64 > MANIFEST_LIMIT {
        return Err("Master manifest exceeds its size limit.".into());
    }
    let file = open_regular(&folder, member, &metadata)
        .map_err(|_| "Cannot read the direct master manifest.")?;
    let mut bytes = Vec::new();
    file.take(MANIFEST_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read the master manifest.")?;
    if bytes.len() as u64 != metadata.st_size as u64 {
        return Err("Master manifest changed during inspection.".into());
    }
    Ok((folder, bytes))
}

type ReviewResult<T> = Result<T, &'static str>;

fn open_regular(folder: &OwnedFd, name: &CStr, expected: &Stat) -> ReviewResult<std::fs::File> {
    if FileType::from_raw_mode(expected.st_mode) != FileType::RegularFile || expected.st_nlink != 1
    {
        return Err("unsafe_member");
    }
    let file = fs::openat(folder, name, FILE, Mode::empty()).map_err(|_| "unreadable")?;
    let opened = fs::fstat(&file).map_err(|_| "unreadable")?;
    if opened.st_dev != expected.st_dev
        || opened.st_ino != expected.st_ino
        || opened.st_size != expected.st_size
        || opened.st_nlink != 1
        || FileType::from_raw_mode(opened.st_mode) != FileType::RegularFile
    {
        return Err("changed");
    }
    Ok(file.into())
}

struct Review {
    entries: usize,
    archive_bytes: u64,
    archive_limit: u64,
    verified_bytes: u64,
    manifest_seen: bool,
    remaining: BTreeMap<String, String>,
    layout: Layout,
    gateway_declared: bool,
    provider_report: Option<Vec<u8>>,
}

#[derive(Default)]
struct Layout {
    roles: BTreeSet<String>,
    declared_roles: Option<BTreeSet<String>>,
    runtime_areas: BTreeSet<String>,
    runtime_content: bool,
    linux_headers: usize,
}

impl Layout {
    fn report(&self) -> Value {
        json!({
            "roles": self.declared_roles.as_ref() == Some(&self.roles),
            "runtimeAreas": !self.runtime_content && self.runtime_areas.len() == RUNTIME_AREAS.len(),
            "linuxHeaders": self.linux_headers == LINUX_BINARIES.len(),
        })
    }
}

#[derive(serde::Deserialize)]
struct RoleCatalog {
    roles: Vec<String>,
    implemented: Vec<String>,
}

fn declared_roles(bytes: &[u8], gateway_declared: bool) -> Option<BTreeSet<String>> {
    let catalog: RoleCatalog = serde_json::from_slice(bytes).ok()?;
    if catalog.roles.len() != 20 {
        return None;
    }
    let roles: BTreeSet<_> = catalog.roles.into_iter().collect();
    let implemented = catalog.implemented.as_slice();
    if roles.len() == 20
        && (implemented == ["validator"]
            || (implemented == ["validator", "rpc_gateway"]
                && gateway_declared
                && roles.contains("rpc_gateway")))
    {
        return Some(roles);
    }
    None
}

impl Review {
    fn charge(&mut self, bytes: u64) -> ReviewResult<()> {
        self.archive_bytes = self
            .archive_bytes
            .checked_add(bytes)
            .filter(|total| *total <= self.archive_limit)
            .ok_or("limits")?;
        Ok(())
    }

    fn walk(&mut self, folder: &OwnedFd, prefix: &str, manifest_sha256: &str) -> ReviewResult<()> {
        for entry in Dir::read_from(folder).map_err(|_| "unreadable")? {
            let entry = entry.map_err(|_| "unreadable")?;
            let name = entry.file_name();
            if matches!(name.to_bytes(), b"." | b"..") {
                continue;
            }
            self.entries += 1;
            if self.entries > MEMBER_LIMIT {
                return Err("limits");
            }
            let part = name.to_str().map_err(|_| "unsafe_member")?;
            let path = if prefix.is_empty() {
                part.to_string()
            } else {
                format!("{prefix}/{part}")
            };
            let metadata =
                fs::statat(folder, name, AtFlags::SYMLINK_NOFOLLOW).map_err(|_| "unreadable")?;
            let file_type = FileType::from_raw_mode(metadata.st_mode);
            if RUNTIME_AREAS.contains(&prefix) {
                self.layout.runtime_content = true;
            }
            if part.starts_with("._")
                && file_type == FileType::RegularFile
                && metadata.st_nlink == 1
            {
                continue;
            }
            if !safe_member(&path) || part.starts_with("._") {
                return Err("unsafe_member");
            }
            match file_type {
                FileType::Directory => {
                    self.charge(512)?;
                    let child = fs::openat(folder, name, DIRECTORY, Mode::empty())
                        .map_err(|_| "unreadable")?;
                    let opened = fs::fstat(&child).map_err(|_| "unreadable")?;
                    if opened.st_dev != metadata.st_dev || opened.st_ino != metadata.st_ino {
                        return Err("changed");
                    }
                    if prefix == "roles" {
                        self.layout.roles.insert(part.into());
                    }
                    if RUNTIME_AREAS.contains(&path.as_str()) {
                        self.layout.runtime_areas.insert(path.clone());
                    }
                    self.walk(&child, &path, manifest_sha256)?;
                }
                FileType::RegularFile if metadata.st_nlink == 1 => {
                    let limit = if path == "package.json" {
                        MANIFEST_LIMIT
                    } else {
                        self.archive_limit
                    };
                    let size = u64::try_from(metadata.st_size)
                        .ok()
                        .filter(|size| *size <= limit)
                        .ok_or("limits")?;
                    self.charge(512 + size.div_ceil(512) * 512)?;
                    let expected = if path == "package.json" {
                        manifest_sha256.to_string()
                    } else {
                        self.remaining.remove(&path).ok_or("inventory_mismatch")?
                    };
                    let mut file = open_regular(folder, name, &metadata)?.take(size + 1);
                    let role_catalog = path == ROLE_CATALOG && size <= ROLE_CATALOG_LIMIT;
                    let provider_report = path == apqe::REPORT_PATH && size <= apqe::REPORT_LIMIT;
                    let linux_binary = LINUX_BINARIES.contains(&path.as_str());
                    let sample_size = if role_catalog || provider_report {
                        size
                    } else if linux_binary {
                        size.min(ELF_HEADER_SIZE)
                    } else {
                        0
                    };
                    let mut sample = vec![0; sample_size as usize];
                    file.read_exact(&mut sample).map_err(|_| "changed")?;
                    let mut hash = Sha256::new();
                    hash.update(&sample);
                    let bytes = sample_size
                        + std::io::copy(&mut file, &mut hash).map_err(|_| "unreadable")?;
                    if bytes != size {
                        return Err("changed");
                    }
                    if format!("{:x}", hash.finalize()) != expected {
                        return Err("digest_mismatch");
                    }
                    if path == "package.json" {
                        self.manifest_seen = true;
                    } else {
                        self.verified_bytes += bytes;
                    }
                    if role_catalog {
                        self.layout.declared_roles = declared_roles(&sample, self.gateway_declared);
                    }
                    if linux_binary
                        && sample.starts_with(b"\x7fELF\x02\x01\x01")
                        && sample.get(18..20) == Some(b"\x3e\x00")
                    {
                        self.layout.linux_headers += 1;
                    }
                    if provider_report {
                        self.provider_report = Some(sample);
                    }
                }
                _ => return Err("unsafe_member"),
            }
        }
        Ok(())
    }
}

pub(super) fn review(folder: &OwnedFd, manifest: &Value, manifest_sha256: &str) -> Value {
    let Ok(remaining) = declared_files(manifest) else {
        return json!({"status":"unavailable","reason":"invalid_inventory"});
    };
    let Ok(archive_limit)=archive_limit(manifest) else { return json!({"status":"unavailable","reason":"invalid_inventory"}); };
    let files = remaining.len();
    let gateway_declared = remaining.contains_key("tools/canary_rpc_relay.py");
    let mut review = Review {
        entries: 0,
        archive_bytes: 1024,
        archive_limit,
        verified_bytes: 0,
        manifest_seen: false,
        remaining,
        layout: Layout::default(),
        gateway_declared,
        provider_report: None,
    };
    let outcome = review.walk(folder, "", manifest_sha256).and_then(|()| {
        if review.manifest_seen && review.remaining.is_empty() {
            Ok(())
        } else {
            Err("inventory_mismatch")
        }
    });
    match outcome {
        Ok(()) => {
            json!({"status":"matched","verifiedFiles":files,"verifiedBytes":review.verified_bytes,
                "layout":review.layout.report(), "apqeProvider":apqe::review(manifest, review.provider_report.as_deref())})
        }
        Err(reason) => json!({"status":"unavailable","reason":reason}),
    }
}
