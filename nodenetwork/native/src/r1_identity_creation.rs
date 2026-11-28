//! Public native NodeNetwork preview of APQE-owned pre-birth semantics.
//! Parsing and correlation never admit a key, network or validator.
use crate::node_controller::Request;
use serde_json::Value;
const FIELDS: &[&str] = &[
    "release_id",
    "manifest_sha256",
    "slot_ref",
    "role",
    "algorithm",
    "key_generation",
    "operation_nonce_hex",
    "creation_scope_frame_hex",
    "creation_scope_commitment_hex",
    "provider_report_sha256",
    "profile_catalog_commitment_hex",
];
fn exact(v: &Value, fields: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|m| m.len() == fields.len() && fields.iter().all(|k| m.contains_key(*k)))
}
fn ascii(v: &Value, max: usize) -> bool {
    v.as_str()
        .is_some_and(|s| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_graphic()))
}
fn hex(v: &Value, n: usize) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == n * 2
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            && s.bytes().any(|b| b != b'0')
    })
}
fn positive_u64(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && !s.starts_with('0')
            && s.bytes().all(|b| b.is_ascii_digit())
            && s.parse::<u64>().is_ok()
    })
}
pub(crate) fn validate(request: &Request) -> Result<bool, String> {
    if request.version != 1
        || request.operation != "r1_identity_preview"
        || !exact(&request.parameters, FIELDS)
    {
        return Err("Exact public R1 creation preview required.".into());
    }
    let p = &request.parameters;
    if !["release_id", "slot_ref", "role"]
        .iter()
        .all(|k| ascii(&p[*k], 120))
        || !matches!(
            p["algorithm"].as_str(),
            Some("ML-DSA-87" | "ML-DSA-65" | "ML-KEM-1024")
        )
        || !positive_u64(&p["key_generation"])
        || ![
            ("manifest_sha256", 32),
            ("operation_nonce_hex", 32),
            ("creation_scope_commitment_hex", 64),
            ("provider_report_sha256", 32),
            ("profile_catalog_commitment_hex", 64),
        ]
        .iter()
        .all(|(k, n)| hex(&p[*k], *n))
        || !p["creation_scope_frame_hex"].as_str().is_some_and(|s| {
            s.len() >= 2
                && s.len() <= 8192
                && s.len() % 2 == 0
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err("Bounded exact public R1 creation parameters required.".into());
    }
    Ok(false)
}
pub(crate) fn reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    const REFUSED: &str = "Native R1 node-creation preview is unavailable or differs.";
    validate(request).map_err(|_| REFUSED)?;
    if !exact(reply, &["version", "ok", "result"]) || reply["version"] != 1 || reply["ok"] != true {
        return Err(REFUSED);
    }
    let r = &reply["result"];
    let i = &r["inspection"];
    let s = &i["scope"];
    let p = &request.parameters;
    let mut creation = request.clone();
    creation.operation = "r1_identity_generate".into();
    if !exact(
        r,
        &[
            "schema",
            "inspection",
            "runtime_authority_granted",
            "creation_request_sha256",
        ],
    ) || r["schema"] != "synergy-r1-managed-creation-preview-v1"
        || r["runtime_authority_granted"] != false
        || r["creation_request_sha256"] != creation.approval_id()
        || !exact(
            i,
            &[
                "release_id",
                "slot_ref",
                "operation_nonce_hex",
                "manifest_sha256",
                "provider_report_sha256",
                "profile_catalog_commitment_hex",
                "creation_scope_commitment_hex",
                "scope",
                "authority_granted",
            ],
        )
        || i["authority_granted"] != false
        || ![
            "release_id",
            "slot_ref",
            "operation_nonce_hex",
            "manifest_sha256",
            "provider_report_sha256",
            "profile_catalog_commitment_hex",
            "creation_scope_commitment_hex",
        ]
        .iter()
        .all(|k| i[*k] == p[*k])
        || !exact(
            s,
            &[
                "scope_kind",
                "network",
                "genesis",
                "activated_profile_set_commitment_hex",
                "target_namespace",
                "custody_profile",
                "custody_object_ref",
                "purpose",
                "owner_raw48_hex",
                "current_policy_epoch",
                "complete_policy_commitment_hex",
                "role",
                "algorithm",
                "key_generation",
                "trust_domain",
                "authority_granted",
            ],
        )
        || s["scope_kind"] != "runtime_identity_creation"
        || s["purpose"] != "NODE_ENROLLMENT"
        || s["authority_granted"] != false
        || s["activated_profile_set_commitment_hex"] != p["profile_catalog_commitment_hex"]
        || !["role", "algorithm", "key_generation"]
            .iter()
            .all(|k| s[*k] == p[*k])
        || ![
            "custody_profile",
            "owner_raw48_hex",
            "current_policy_epoch",
            "complete_policy_commitment_hex",
        ]
        .iter()
        .all(|k| s[*k].is_null())
        || !ascii(&s["target_namespace"], 6)
        || !ascii(&s["custody_object_ref"], 120)
        || !ascii(&s["trust_domain"], 120)
    {
        return Err(REFUSED);
    }
    let n = &s["network"];
    let g = &s["genesis"];
    let profile = &g["profile"];
    if !exact(n, &["chain_id", "network_incarnation_commitment"])
        || !positive_u64(&n["chain_id"])
        || !hex(&n["network_incarnation_commitment"], 64)
        || !exact(g, &["profile", "algorithm", "digest_hex"])
        || g["algorithm"] != "SHA3-384"
        || !hex(&g["digest_hex"], 48)
        || !exact(profile, &["name", "revision"])
        || profile["name"] != "SYNERGY-GENESIS-R1"
        || profile["revision"] != 1
    {
        return Err(REFUSED);
    }
    Ok(reply.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn request() -> Request {
        Request {
            version: 1,
            operation: "r1_identity_preview".into(),
            parameters: json!({
   "release_id":"PUBLIC-TEST","manifest_sha256":"01".repeat(32),"slot_ref":"PUBLIC-NODE-SLOT",
   "role":"identity","algorithm":"ML-DSA-87","key_generation":"18446744073709551615",
   "operation_nonce_hex":"02".repeat(32),"creation_scope_frame_hex":"80",
   "creation_scope_commitment_hex":"03".repeat(64),"provider_report_sha256":"04".repeat(32),
   "profile_catalog_commitment_hex":"05".repeat(64)}),
        }
    }
    // Transport-only isolated fixtures; no APQE provider, receipt or creation call.
    fn response(q: &Request) -> Value {
        let p = &q.parameters;
        let mut creation = q.clone();
        creation.operation = "r1_identity_generate".into();
        json!({"version":1,"ok":true,"result":{
   "schema":"synergy-r1-managed-creation-preview-v1","runtime_authority_granted":false,
   "creation_request_sha256":creation.approval_id(),
   "inspection":{"release_id":p["release_id"],"slot_ref":p["slot_ref"],
    "operation_nonce_hex":p["operation_nonce_hex"],"manifest_sha256":p["manifest_sha256"],
    "provider_report_sha256":p["provider_report_sha256"],
    "profile_catalog_commitment_hex":p["profile_catalog_commitment_hex"],
    "creation_scope_commitment_hex":p["creation_scope_commitment_hex"],"authority_granted":false,
    "scope":{"scope_kind":"runtime_identity_creation","network":{"chain_id":"18446744073709551615",
      "network_incarnation_commitment":"06".repeat(64)},
     "genesis":{"profile":{"name":"SYNERGY-GENESIS-R1","revision":1},
      "algorithm":"SHA3-384","digest_hex":"07".repeat(48)},
     "activated_profile_set_commitment_hex":p["profile_catalog_commitment_hex"],
     "target_namespace":"synv1","custody_profile":null,"custody_object_ref":"PUBLIC-NODE-OPERATION",
     "purpose":"NODE_ENROLLMENT","owner_raw48_hex":null,"current_policy_epoch":null,
     "complete_policy_commitment_hex":null,"role":p["role"],"algorithm":p["algorithm"],
     "key_generation":p["key_generation"],"trust_domain":"PUBLIC-SYNTHETIC-ONLY","authority_granted":false}}}})
    }
    #[test]
    fn exact_preview_preserves_full_width_and_never_opens_generation() {
        let q = request();
        assert_eq!(q.validate().unwrap(), false);
        let r = response(&q);
        assert_eq!(reply(&q, &r).unwrap(), r);
        assert_eq!(
            r["result"]["inspection"]["scope"]["genesis"]["digest_hex"]
                .as_str()
                .unwrap()
                .len(),
            96
        );
        let mut generation = q.clone();
        generation.operation = "r1_identity_generate".into();
        assert!(generation.validate().is_err());
        let mut secret = q.clone();
        secret.parameters["private_key"] = json!("FORBIDDEN");
        assert!(secret.validate().is_err());
        let mut numeric = q.clone();
        numeric.parameters["key_generation"] = json!(1);
        assert!(numeric.validate().is_err());
    }
    #[test]
    fn internal_scopes_and_uncorrelated_or_secret_responses_reject() {
        let q = request();
        let good = response(&q);
        for (path, value) in [
            (
                "/result/inspection/scope/scope_kind",
                json!("bootstrap_root"),
            ),
            ("/result/inspection/scope/scope_kind", json!("formation")),
            (
                "/result/inspection/scope/purpose",
                json!("ACCOUNT_ENROLLMENT"),
            ),
            ("/result/inspection/scope/authority_granted", json!(true)),
            ("/result/inspection/slot_ref", json!("OTHER-PUBLIC-SLOT")),
            ("/result/creation_request_sha256", json!(q.approval_id())),
            (
                "/result/inspection/scope/genesis/digest_hex",
                json!("07".repeat(32)),
            ),
        ] {
            let mut bad = good.clone();
            *bad.pointer_mut(path).unwrap() = value;
            assert!(reply(&q, &bad).is_err(), "{path}");
        }
        let mut bad = good.clone();
        bad["result"]["inspection"]["scope"]["private_key"] = json!("FORBIDDEN");
        assert!(reply(&q, &bad).is_err());
    }
}
