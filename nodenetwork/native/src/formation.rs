//! Public-only boundary for artifacts returned by the authenticated host controller.
use crate::node_controller::Request;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_PUBLIC_ARTIFACT: usize = 128 * 1024;
const FORMATION_SCHEMA: &str = "apqe-validator-formation-registration-v1";
const ENROLLMENT_SCHEMA: &str = "apqe-validator-enrollment-request-v3";

fn hex(value: &str, chars: usize) -> bool {
    value.len() == chars
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn pin(value: &Value) -> Option<&str> {
    value.as_str().filter(|s| hex(s, 64))
}
fn address(s: &str) -> bool {
    (15..=95).contains(&s.len())
        && s.starts_with("synv1")
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}
fn network(s: &str) -> bool {
    (2..=128).contains(&s.len())
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))
}
fn chain(s: &str) -> Option<u64> {
    s.parse::<u64>()
        .ok()
        .filter(|n| *n > 0 && n.to_string() == s)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Formation {
    network_id: String,
    chain_id_hex: String,
    formation_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Network {
    chain_id_hex: String,
    genesis_sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicKey {
    algorithm: String,
    public_key: String,
    peer_id: Option<String>,
}
impl PublicKey {
    fn matches(&self, algorithm: &str, size: usize, peer: bool) -> bool {
        self.algorithm == algorithm
            && hex(&self.public_key, size * 2)
            && if peer {
                self.peer_id.as_deref().is_some_and(|id| hex(id, 64))
            } else {
                self.peer_id.is_none()
            }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    schema_version: String,
    binary_encoding: String,
    address: String,
    public_key: String,
    address_type: String,
    algorithm: String,
    created_at: String,
    consensus_key: PublicKey,
    node_identity_key: PublicKey,
    account_key: PublicKey,
    entropy_contribution_key: PublicKey,
}
impl Identity {
    fn matches(&self, expected_address: &str) -> bool {
        self.schema_version == "synergy-validator-public-identity-v4"
            && self.binary_encoding == "lowercase-hex"
            && self.address == expected_address
            && self.algorithm == "FN-DSA-1024"
            && hex(&self.public_key, 1793 * 2)
            && matches!(
                self.address_type.as_str(),
                "NodeClass1" | "NodeClass2" | "NodeClass3" | "NodeClass4" | "NodeClass5"
            )
            && (20..=40).contains(&self.created_at.len())
            && self
                .created_at
                .bytes()
                .all(|b| b.is_ascii_digit() || b"TtZz:+-.".contains(&b))
            && self.consensus_key.matches("ML-DSA-65", 1952, false)
            && self.node_identity_key.matches("ML-DSA-65", 1952, true)
            && self.account_key.matches("ML-DSA-87", 2592, false)
            && self
                .entropy_contribution_key
                .matches("ML-KEM-768", 1184, false)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Proof {
    role: String,
    algorithm: String,
    signature: String,
}
fn proofs_match(proofs: &[Proof]) -> bool {
    proofs.len() == 4
        && [
            ("primary", "FN-DSA-1024", 1328),
            ("consensus", "ML-DSA-65", 3309),
            ("node_identity", "ML-DSA-65", 3309),
            ("account", "ML-DSA-87", 4627),
        ]
        .iter()
        .all(|&(role, algo, bytes)| {
            proofs
                .iter()
                .filter(|proof| {
                    proof.role == role
                        && proof.algorithm == algo
                        && if role == "primary" {
                            (84..=bytes * 2).contains(&proof.signature.len())
                                && proof.signature.len() % 2 == 0
                                && hex(&proof.signature, proof.signature.len())
                        } else {
                            hex(&proof.signature, bytes * 2)
                        }
                })
                .count()
                == 1
        })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicArtifact<T> {
    payload: T,
    signature_possession_proofs: Vec<Proof>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FormationPayload {
    schema_version: String,
    formation: Formation,
    identity: Identity,
    ingress_key: PublicKey,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnrollmentPayload {
    schema_version: String,
    network: Network,
    identity: Identity,
    ingress_key: PublicKey,
}

pub(crate) enum Export {
    Formation,
    BoundEnrollment,
}

pub(crate) fn export_bytes(value: &Value, export: Export) -> Result<(&[u8], Value), String> {
    let expected_address = value["address"]
        .as_str()
        .filter(|s| address(s))
        .ok_or("Invalid public validator address")?;
    let (content_key, digest_key) = match export {
        Export::Formation => ("registration_json", "registration_sha256"),
        Export::BoundEnrollment => ("enrollment_json", "enrollment_sha256"),
    };
    let text = value[content_key]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= MAX_PUBLIC_ARTIFACT)
        .ok_or("Public validator artifact unavailable or exceeds its size bound")?;
    let expected = pin(&value[digest_key]).ok_or("Invalid public artifact SHA-256")?;
    if format!("{:x}", Sha256::digest(text.as_bytes())) != expected {
        return Err("Public validator artifact bytes differ from the authenticated digest".into());
    }
    let valid = match export {
        Export::Formation => {
            let artifact: PublicArtifact<FormationPayload> = serde_json::from_str(text)
                .map_err(|_| "Unsupported public formation registration shape")?;
            value["schema"] == "nodenetwork-formation-export-v1"
                && pin(&value["formation_sha256"]).is_some()
                && artifact.payload.schema_version == FORMATION_SCHEMA
                && network(&artifact.payload.formation.network_id)
                && hex(&artifact.payload.formation.chain_id_hex, 64)
                && artifact.payload.formation.chain_id_hex != "0".repeat(64)
                && hex(&artifact.payload.formation.formation_id, 64)
                && artifact.payload.formation.formation_id != "0".repeat(64)
                && artifact.payload.identity.matches(expected_address)
                && artifact
                    .payload
                    .ingress_key
                    .matches("ML-KEM-1024", 1568, false)
                && proofs_match(&artifact.signature_possession_proofs)
        }
        Export::BoundEnrollment => {
            let artifact: PublicArtifact<EnrollmentPayload> = serde_json::from_str(text)
                .map_err(|_| "Unsupported public bound enrollment shape")?;
            let chain = value["chain_id"]
                .as_str()
                .and_then(chain)
                .ok_or("Invalid bound enrollment chain ID")?;
            value["schema"] == "nodenetwork-genesis-binding-v1"
                && value["bound"] == true
                && value["genesis_authority_verified"] == true
                && value["membership_verified"] == true
                && artifact.payload.schema_version == ENROLLMENT_SCHEMA
                && artifact.payload.network.chain_id_hex == format!("{chain:064x}")
                && pin(&value["genesis_sha256"])
                    == Some(artifact.payload.network.genesis_sha256.as_str())
                && artifact.payload.identity.matches(expected_address)
                && artifact
                    .payload
                    .ingress_key
                    .matches("ML-KEM-1024", 1568, false)
                && proofs_match(&artifact.signature_possession_proofs)
        }
    };
    if !valid {
        return Err(
            "Public artifact does not match the authenticated validator identity or profile".into(),
        );
    }
    Ok((
        text.as_bytes(),
        json!({"address":expected_address,"sha256":expected}),
    ))
}

/// Called on successful status responses only. A target-issued hash must also
/// equal the independently reconstructed canonical mutation, before the local
/// journal may match it to a previously recorded dispatch.
pub(crate) fn reconcile_evidence<'a>(
    operation: &str,
    value: &'a Value,
) -> Result<Option<(&'static str, &'a str)>, String> {
    let (mutation, field, expected_schema) = match operation {
        "formation_status"
            if value["pending"] == true
                && value["possession_verified"] == true
                && value["membership_granted"] == false =>
        {
            (
                "formation_prepare",
                "formation_sha256",
                "nodenetwork-formation-v1",
            )
        }
        "genesis_binding_preflight"
            if value["bound"] == true
                && value["genesis_authority_verified"] == true
                && value["membership_verified"] == true =>
        {
            export_bytes(value, Export::BoundEnrollment)?;
            (
                "genesis_bind",
                "genesis_sha256",
                "nodenetwork-genesis-binding-v1",
            )
        }
        _ => return Ok(None),
    };
    let scope = pin(&value[field]).ok_or("Invalid target recovery scope")?;
    let request = pin(&value["request_sha256"])
        .ok_or("Target did not report exact verified dispatch evidence")?;
    if value["schema"] != expected_schema
        || !value["address"].as_str().is_some_and(address)
        || !value["network_id"].as_str().is_some_and(network)
        || !value["chain_id"]
            .as_str()
            .is_some_and(|s| chain(s).is_some())
        || (operation == "formation_status"
            && pin(&value["formation_id"]).is_none_or(|s| s == "0".repeat(64)))
        || (Request {
            version: 1,
            operation: mutation.into(),
            parameters: json!({(field):scope}),
        })
        .approval_id()
            != request
    {
        return Err("Verified target status does not match an exact canonical dispatch".into());
    }
    Ok(Some((mutation, request)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ADDR: &str = "synv1unrelatedfixture";

    #[test]
    fn only_exact_public_bound_enrollment_bytes_can_be_exported() {
        let key = |algorithm, bytes: usize| json!({"algorithm":algorithm,"public_key":"ab".repeat(bytes)});
        let mut transport = key("ML-DSA-65", 1952);
        transport["peer_id"] = json!("ab".repeat(32));
        let genesis = "01".repeat(32);
        let mut artifact = json!({
            "payload": {
                "schema_version": ENROLLMENT_SCHEMA,
                "network": {"chain_id_hex":format!("{:064x}",99999),"genesis_sha256":genesis},
                "identity": {"schema_version":"synergy-validator-public-identity-v4","binary_encoding":"lowercase-hex",
                    "address":ADDR,"public_key":"ab".repeat(1793),"address_type":"NodeClass1",
                    "algorithm":"FN-DSA-1024","created_at":"2026-11-12T00:00:00Z",
                    "consensus_key":key("ML-DSA-65",1952),"node_identity_key":transport,
                    "account_key":key("ML-DSA-87",2592),"entropy_contribution_key":key("ML-KEM-768",1184)},
                "ingress_key":key("ML-KEM-1024",1568)
            },
            "signature_possession_proofs": [
                {"role":"primary","algorithm":"FN-DSA-1024","signature":"ab".repeat(1267)},
                {"role":"consensus","algorithm":"ML-DSA-65","signature":"ab".repeat(3309)},
                {"role":"node_identity","algorithm":"ML-DSA-65","signature":"ab".repeat(3309)},
                {"role":"account","algorithm":"ML-DSA-87","signature":"ab".repeat(4627)}
            ]
        });
        let bind = |text: &str| {
            json!({"address":ADDR,"schema":"nodenetwork-genesis-binding-v1",
            "chain_id":"99999","genesis_sha256":genesis,"bound":true,
            "genesis_authority_verified":true,"membership_verified":true,
            "enrollment_json":text,"enrollment_sha256":format!("{:x}", Sha256::digest(text.as_bytes()))})
        };
        let text = serde_json::to_string_pretty(&artifact).unwrap() + "\n";
        let mut value = bind(&text);
        assert_eq!(
            export_bytes(&value, Export::BoundEnrollment).unwrap().0,
            text.as_bytes()
        );
        value["enrollment_json"] = json!(text.trim());
        assert!(export_bytes(&value, Export::BoundEnrollment).is_err());
        artifact["payload"]["identity"]["node_identity_key"]["private_key"] = json!("unexpected");
        assert!(export_bytes(&bind(&artifact.to_string()), Export::BoundEnrollment).is_err());
        artifact["payload"]["identity"]["node_identity_key"]
            .as_object_mut()
            .unwrap()
            .remove("private_key");
        artifact["payload"]["network"]["genesis_sha256"] = json!("02".repeat(32));
        assert!(export_bytes(&bind(&artifact.to_string()), Export::BoundEnrollment).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn signed_genesis_picker_hashes_exact_public_bytes_and_rejects_substitution() {
        use std::{fs, os::unix::fs::symlink, time::SystemTime};
        let temp = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "nodenetwork-stage-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&temp).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(temp.clone());
        let mut policy = json!({"address":ADDR,"schema":"nodenetwork-genesis-stage-policy-v1"});
        for (name, field, bytes) in [
            (
                "genesis.json",
                "genesis_sha256",
                "{\"test\":\"β\"}\n".as_bytes(),
            ),
            ("authority.json", "authority_sha256", b"{}\n"),
            ("authority-root.pub", "authority_root_sha256", &[0, 255]),
        ] {
            fs::write(temp.join(name), bytes).unwrap();
            policy[field] = json!(format!("{:x}", Sha256::digest(bytes)));
        }
        stage_policy(&policy, ADDR).unwrap();
        let mut artifacts = select_stage_artifacts(&temp, &policy).unwrap();
        assert_eq!(artifacts["authority-root.pub"], "AP8=");
        let request = Request {
            version: 1,
            operation: "genesis_stage".into(),
            parameters: json!({"artifacts":artifacts}),
        };
        assert_eq!(request.validate(), Ok(true));
        // The authenticated controller hashes the same sorted compact UTF-8 JSON.
        assert_eq!(
            request.approval_id(),
            "8d36830f011ff1c18001d26015e1cec30dca4abe71e42241cd23b6ceb839863c"
        );
        let target =
            json!({"kind":"remote","host":"stage-fixture.invalid","port":22,"root":"/opt/Synergy"});
        let dispatch = crate::request_journal::Dispatch::begin(
            &temp,
            &target,
            "genesis_stage",
            &request.canonical(),
        )
        .unwrap();
        dispatch
            .finish(&Err("uncertain test transport".into()))
            .unwrap();
        assert!(crate::request_journal::Dispatch::begin(
            &temp,
            &target,
            "genesis_stage",
            &request.canonical()
        )
        .is_err());
        let wrong_target =
            json!({"kind":"remote","host":"other-fixture.invalid","port":22,"root":"/opt/Synergy"});
        assert!(!crate::request_journal::reconcile_verified(
            &temp,
            &wrong_target,
            "genesis_stage",
            &request.approval_id()
        )
        .unwrap());
        assert!(!crate::request_journal::reconcile_verified(
            &temp,
            &target,
            "genesis_stage",
            &"00".repeat(32)
        )
        .unwrap());
        assert!(crate::request_journal::reconcile_verified(
            &temp,
            &target,
            "genesis_stage",
            &request.approval_id()
        )
        .unwrap());
        assert_eq!(
            crate::request_journal::inspect(&temp).unwrap()["records"][0]["state"],
            "verified_target_outcome"
        );
        artifacts["authority-root.pub"] = json!("AP8");
        assert!(stage_artifacts(&artifacts).is_err());
        fs::write(temp.join("authority-root.pub"), [1, 255]).unwrap();
        assert!(select_stage_artifacts(&temp, &policy).is_err());
        fs::rename(temp.join("genesis.json"), temp.join("other.json")).unwrap();
        symlink(temp.join("other.json"), temp.join("genesis.json")).unwrap();
        assert!(select_stage_artifacts(&temp, &policy).is_err());
    }

    #[test]
    fn formation_recovery_reconstructs_the_exact_reviewed_mutation() {
        let scope = "42".repeat(32);
        let approval = Request {
            version: 1,
            operation: "formation_prepare".into(),
            parameters: json!({"formation_sha256":scope}),
        }
        .approval_id();
        let mut value = json!({"schema":"nodenetwork-formation-v1","pending":true,
            "possession_verified":true,"membership_granted":false,"address":ADDR,"chain_id":"99999",
            "network_id":"isolated-99999","formation_id":"12".repeat(32),"formation_sha256":scope,
            "request_sha256":approval});
        assert_eq!(
            reconcile_evidence("formation_status", &value).unwrap(),
            Some(("formation_prepare", approval.as_str()))
        );
        assert_eq!(
            reconcile_evidence("formation_preflight", &value).unwrap(),
            None
        );
        value["formation_sha256"] = json!("43".repeat(32));
        assert!(reconcile_evidence("formation_status", &value).is_err());
    }
}

const STAGE_FILES: [(&str, &str, usize); 3] = [
    ("genesis.json", "genesis_sha256", 4 * 1024 * 1024),
    ("authority.json", "authority_sha256", 1024 * 1024),
    ("authority-root.pub", "authority_root_sha256", 8192),
];

pub(crate) fn stage_artifacts(value: &Value) -> Result<(), String> {
    if value
        .as_object()
        .is_none_or(|obj| obj.len() != STAGE_FILES.len())
        || STAGE_FILES.iter().any(|(name, _, max)| {
            value[name].as_str().is_none_or(|s| {
                if *name == "authority-root.pub" {
                    s.len() > max.div_ceil(3) * 4
                        || STANDARD.decode(s).map_or(true, |bytes| {
                            bytes.is_empty() || bytes.len() > *max || STANDARD.encode(&bytes) != s
                        })
                } else {
                    s.is_empty() || s.len() > *max
                }
            })
        })
    {
        return Err(
            "Signed Genesis staging requires exactly three bounded public artifacts.".into(),
        );
    }
    Ok(())
}

pub(crate) fn stage_policy(value: &Value, expected_address: &str) -> Result<(), String> {
    if !address(expected_address)
        || value["address"].as_str() != Some(expected_address)
        || value["schema"] != "nodenetwork-genesis-stage-policy-v1"
        || STAGE_FILES
            .iter()
            .any(|(_, field, _)| pin(&value[field]).is_none())
    {
        return Err("The target did not authenticate the selected prepared identity and independent Genesis pins.".into());
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn select_stage_artifacts(
    root: &std::path::Path,
    policy: &Value,
) -> Result<Value, String> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    if !root.is_absolute()
        || root
            .ancestors()
            .any(|entry| !std::fs::symlink_metadata(entry).is_ok_and(|m| m.is_dir()))
    {
        return Err("Select a local Genesis authority folder without linked paths.".into());
    }
    let mut artifacts = serde_json::Map::new();
    for (name, field, limit) in STAGE_FILES {
        let path = root.join(name);
        let error =
            || format!("{name} must be a bounded regular file matching the authenticated SHA-256.");
        let before = std::fs::symlink_metadata(&path).map_err(|_| error())?;
        if !before.is_file() || before.len() == 0 || before.len() > limit as u64 {
            return Err(error());
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&path)
            .map_err(|_| error())?;
        let after = file.metadata().map_err(|_| error())?;
        if !after.is_file()
            || before.ino() != after.ino()
            || before.dev() != after.dev()
            || after.nlink() != 1
        {
            return Err(error());
        }
        let mut raw = Vec::new();
        file.take(limit as u64 + 1)
            .read_to_end(&mut raw)
            .map_err(|_| error())?;
        if raw.len() as u64 != before.len()
            || Some(format!("{:x}", Sha256::digest(&raw)).as_str()) != pin(&policy[field])
        {
            return Err(error());
        }
        artifacts.insert(
            name.into(),
            Value::String(if name == "authority-root.pub" {
                STANDARD.encode(raw)
            } else {
                String::from_utf8(raw).map_err(|_| error())?
            }),
        );
    }
    Ok(Value::Object(artifacts))
}

#[cfg(not(unix))]
pub(crate) fn select_stage_artifacts(_: &std::path::Path, _: &Value) -> Result<Value, String> {
    Err("This platform has no qualified signed Genesis staging transport.".into())
}

pub(crate) fn stage_receipt(
    value: &Value,
    policy: &Value,
    request_sha256: &str,
) -> Result<(), String> {
    if value["schema"] != "nodenetwork-genesis-stage-v1"
        || value["staged"] != true
        || value["genesis_authority_verified"] != true
        || value["membership_verified"] != true
        || value["address"] != policy["address"]
        || value["request_sha256"].as_str() != Some(request_sha256)
        || STAGE_FILES
            .iter()
            .any(|(_, field, _)| value[field] != policy[field])
    {
        return Err("Target did not confirm exact authenticated Genesis staging. Inspect target status before continuing.".into());
    }
    Ok(())
}

pub(crate) fn stage_recovery(value: &Value) -> Result<Option<&str>, String> {
    if value["stage_request_sha256"].is_null() {
        return Ok(None);
    }
    if value["schema"] != "nodenetwork-genesis-binding-v1"
        || value["genesis_authority_verified"] != true
        || value["membership_verified"] != true
        || !value["address"].as_str().is_some_and(address)
        || pin(&value["genesis_sha256"]).is_none()
    {
        return Err("Verified stage recovery evidence is invalid.".into());
    }
    pin(&value["stage_request_sha256"])
        .map(Some)
        .ok_or_else(|| "Verified stage recovery digest is invalid.".into())
}
