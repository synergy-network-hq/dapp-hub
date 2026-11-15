//! Bounded inspection of an operator-selected folder before any target is configured.
use super::node_bootstrap::{declared_files, safe_member, MAX_ARCHIVE};
use rustix::fd::OwnedFd;
use rustix::fs::{self, AtFlags, Dir, FileType, Mode, OFlags, Stat};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
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
    verified_bytes: u64,
    manifest_seen: bool,
    remaining: BTreeMap<String, String>,
}

impl Review {
    fn charge(&mut self, bytes: u64) -> ReviewResult<()> {
        self.archive_bytes = self
            .archive_bytes
            .checked_add(bytes)
            .filter(|total| *total <= MAX_ARCHIVE)
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
                    self.walk(&child, &path, manifest_sha256)?;
                }
                FileType::RegularFile if metadata.st_nlink == 1 => {
                    let limit = if path == "package.json" {
                        MANIFEST_LIMIT
                    } else {
                        MAX_ARCHIVE
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
                    let mut hash = Sha256::new();
                    let bytes = std::io::copy(&mut file, &mut hash).map_err(|_| "unreadable")?;
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
    let files = remaining.len();
    let mut review = Review {
        entries: 0,
        archive_bytes: 1024,
        verified_bytes: 0,
        manifest_seen: false,
        remaining,
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
            json!({"status":"matched","verifiedFiles":files,"verifiedBytes":review.verified_bytes})
        }
        Err(reason) => json!({"status":"unavailable","reason":reason}),
    }
}
