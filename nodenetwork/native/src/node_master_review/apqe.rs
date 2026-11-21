//! Local consistency checks for the pinned portable APQE package candidate.
use super::safe_member;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub(super) const REPORT_PATH: &str = "lib/apqe/build-report.json";
pub(super) const REPORT_LIMIT: u64 = 1_000_000;
const PROVIDER_PREFIX: &str = "lib/apqe/";
const LIBRARY_COUNT: usize = 8;

#[derive(Deserialize)]
struct ProviderReport {
    validation: bool,
    backend_policy: BackendPolicy,
    required_variant_count: usize,
    artifacts: Vec<Library>,
}

#[derive(Deserialize)]
struct BackendPolicy {
    selected_backend: String,
}

#[derive(Deserialize)]
struct Library {
    path: String,
    sha256: String,
}

fn verify<'a>(manifest: &'a Value, report: Option<&[u8]>) -> Result<&'a str, &'static str> {
    let declaration = manifest["apqe_provider"]
        .as_object()
        .ok_or("declaration_missing")?;
    if declaration.get("report_path").and_then(Value::as_str) != Some(REPORT_PATH)
        || declaration.get("profile").and_then(Value::as_str) != Some("PQ-VSESSION-01-candidate-v1")
        || declaration
            .get("production_qualified")
            .and_then(Value::as_bool)
            != Some(false)
    {
        return Err("declaration_invalid");
    }
    let inventory = manifest["files"].as_object().ok_or("report_digest")?;
    let report_digest = inventory
        .get(REPORT_PATH)
        .and_then(Value::as_str)
        .ok_or("report_digest")?;
    if declaration.get("report_sha256").and_then(Value::as_str) != Some(report_digest) {
        return Err("report_digest");
    }

    let report: ProviderReport = serde_json::from_slice(report.ok_or("report_unavailable")?)
        .map_err(|_| "report_invalid")?;
    if report.validation
        || report.backend_policy.selected_backend != "portable"
        || report.required_variant_count != LIBRARY_COUNT
        || report.artifacts.len() != LIBRARY_COUNT
    {
        return Err("report_invalid");
    }

    let mut paths = BTreeSet::new();
    for library in report.artifacts {
        let name = library.path;
        let path = format!("{PROVIDER_PREFIX}{name}");
        if name.contains('/')
            || !name.starts_with("libaegis")
            || !name.ends_with(".so")
            || !safe_member(&path)
        {
            return Err("libraries_mismatch");
        }
        if inventory.get(&path).and_then(Value::as_str) != Some(library.sha256.as_str())
            || !paths.insert(path)
        {
            return Err("libraries_mismatch");
        }
    }
    if inventory
        .keys()
        .filter(|path| path.starts_with(PROVIDER_PREFIX))
        .count()
        != LIBRARY_COUNT + 1
    {
        return Err("libraries_mismatch");
    }
    // The enclosing inventory inspection already hashed these exact report bytes.
    Ok(report_digest)
}

pub(super) fn review(manifest: &Value, report: Option<&[u8]>) -> Value {
    match verify(manifest, report) {
        Ok(report_sha256) => json!({"status":"matched","libraryCount":LIBRARY_COUNT,"reportSha256":report_sha256}),
        Err(reason) => json!({"status":"unavailable","reason":reason}),
    }
}
