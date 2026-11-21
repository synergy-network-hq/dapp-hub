//! Native configuration of the gateway's dedicated NetBird access policy.
use crate::{
    node_controller::{self, Target},
    vpn_credential,
    vpn_enrollment::{hash, read, PROVIDER},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::Path,
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use zeroize::Zeroizing;

const PROFILE: &str = "nodenetwork-gateway-access-scope-v1";
const COORDINATOR_PROFILE: &str = "nodenetwork-gateway-vpn-coordinator-v1";
const COORDINATOR_FIELDS: &[&str] = &["api_origin", "management_origin", "account_id", "ca_sha256"];
const ORIGIN: &[(&str, usize)] = &[
    ("genesis.json", 4 * 1024 * 1024),
    ("authority.json", 1024 * 1024),
    ("authority-root.pub", 8192),
    ("network-manifest.json", 65536),
    ("transport-registry.json", 2 * 1024 * 1024),
    ("transport-root.pub", 8192),
];

struct Inputs {
    scope_raw: String,
    scope_pin: String,
    coordinator_pin: String,
    scope: Value,
    profile: Value,
    ca: Zeroizing<Vec<u8>>,
    locator: Zeroizing<Vec<u8>>,
    locator_pin: String,
    coordinator: Value,
}

fn json_bytes(raw: &[u8]) -> Result<Value, String> {
    serde_json::from_slice(raw).map_err(|_| "Invalid gateway access input JSON".into())
}

fn unix_now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| "Gateway policy review needs a valid clock".into())
}

fn scope_target(target: &Target, host_line: &str) -> String {
    let value = json!({"target": target.journal_identity(), "ssh_host_pin_sha256": hash(host_line.as_bytes())});
    hash(value.to_string().as_bytes())
}

fn read_origin(folder: &Path, profile: &Value, scope: &Value) -> Result<(), String> {
    if profile["origin"]
        .as_object()
        .is_none_or(|pins| pins.len() != ORIGIN.len())
        || profile["role"] != "rpc_gateway"
        || profile["schema"] != "synergy-network-provisioning-v1"
        || profile["gateway"]["validator_relay_port"] != 8551
        || !profile["gateway"]["vpn_provider_sha256"].is_null()
        || !profile["gateway"]["vpn_credential_locator_sha256"].is_null()
    {
        return Err(
            "Select a gateway draft with the complete pinned origin and no prior VPN binding"
                .into(),
        );
    }
    let formation = read(&folder.join("formation-context.json"), 4096, false)?;
    let formation_doc = json_bytes(&formation)?;
    let chain = profile["chain_id"]
        .as_u64()
        .filter(|id| *id > 0)
        .ok_or("Invalid gateway chain ID")?;
    if scope["network_binding"]
        != json!({"network_id": profile["network_id"], "chain_id": chain,
        "formation_sha256": hash(&formation)})
        || formation_doc["network_id"] != profile["network_id"]
        || formation_doc["chain_id_hex"] != format!("{chain:064x}")
    {
        return Err("The policy scope differs from the exact saved network formation".into());
    }

    let mut tcp = None;
    for (name, maximum) in ORIGIN {
        let raw = read(
            &folder.join("commissioning/network").join(name),
            *maximum,
            false,
        )?;
        if profile["origin"][*name] != hash(&raw) {
            return Err(format!("Gateway draft origin pin differs for {name}"));
        }
        if *name == "network-manifest.json"
            && json_bytes(&raw)?["genesis_hash"] != profile["genesis_hash"]
        {
            return Err("Gateway draft and network manifest Genesis differ".into());
        }
        if *name == "transport-registry.json" {
            let registry = json_bytes(&raw)?;
            let Some(validators) = registry["payload"]["validators"]
                .as_array()
                .filter(|v| !v.is_empty() && v.len() <= 128)
            else {
                return Err("Invalid gateway transport registry".into());
            };
            let mut matching = validators.iter().filter(|v| {
                v["revoked"] == false
                    && v["node_address"].is_string()
                    && v["node_address"] == profile["gateway"]["validator_address"]
            });
            let selected = matching
                .next()
                .ok_or("Gateway upstream is absent from the pinned transport registry")?;
            if matching.next().is_some() {
                return Err("Gateway upstream is ambiguous".into());
            }
            let overlay: std::net::SocketAddr = selected["dial_address"]
                .as_str()
                .ok_or("Gateway upstream has no literal dial address")?
                .parse()
                .map_err(|_| "Gateway upstream has an invalid literal dial address")?;
            if overlay.port() == 0 {
                return Err("Gateway upstream dial port is zero".into());
            }
            tcp = Some(json!({"ip": overlay.ip().to_string(), "port": 8551}));
        }
    }
    if tcp.as_ref() != Some(&scope["required_gateway_tcp"]) {
        return Err("The policy upstream differs from the selected pinned registry peer".into());
    }
    Ok(())
}

fn verify_coordinator(raw: &[u8], expected_pin: &str, scope: &Value) -> Result<(), String> {
    if hash(raw) != expected_pin {
        return Err(
            "Coordinator differs from the independently pinned administration scope".into(),
        );
    }
    let doc = json_bytes(raw)?;
    if doc
        .as_object()
        .is_none_or(|map| map.len() != COORDINATOR_FIELDS.len() + 2)
        || doc["version"] != 1
        || doc["profile"] != COORDINATOR_PROFILE
        || !COORDINATOR_FIELDS
            .iter()
            .all(|field| doc[*field].is_string() && doc[*field] == scope[*field])
    {
        return Err(
            "Gateway policy differs from the pinned coordinator account, HTTPS origins, or CA"
                .into(),
        );
    }
    Ok(())
}

fn inputs(
    folder: &Path,
    target: &Target,
    host_line: &str,
    coordinator_pin: &str,
    locator_pin: &str,
) -> Result<Inputs, String> {
    let raw = read(&folder.join("gateway-access.json"), 16384, false)?;
    let scope = json_bytes(&raw)?;
    let now = unix_now()?;
    if scope.as_object().is_none_or(|map| map.len() != 11)
        || scope["profile"] != PROFILE
        || scope["version"] != 1
        || scope.to_string().as_bytes() != raw.as_slice()
        || scope["target_sha256"] != scope_target(target, host_line)
        || scope["expires_at"]
            .as_u64()
            .is_none_or(|expires| expires <= now)
    {
        return Err(
            "Select the exact unexpired gateway policy scope for this bootstrapped host".into(),
        );
    }
    let scope_pin = hash(&raw);
    verify_coordinator(
        &read(&folder.join("coordinator.json"), 16384, false)?,
        coordinator_pin,
        &scope,
    )?;
    let profile_raw = read(&folder.join("network-provisioning.json"), 16384, false)?;
    if scope["network_profile_sha256"] != hash(&profile_raw) {
        return Err("Gateway profile bytes differ from the policy scope".into());
    }
    let profile = json_bytes(&profile_raw)?;
    read_origin(folder, &profile, &scope)?;
    let ca = read(&folder.join("ca.pem"), 128 * 1024, false)?;
    if scope["ca_sha256"] != hash(&ca)
        || scope["api_origin"] != scope["management_origin"]
        || !scope["api_origin"]
            .as_str()
            .is_some_and(|origin| origin.starts_with("https://"))
    {
        return Err("Gateway policy needs its exact coordinator HTTPS origin and CA".into());
    }
    let locator = read(&folder.join("credential-locator.json"), 16384, true)?;
    let coordinator = vpn_credential::public_review(&locator, coordinator_pin, Some(locator_pin))?;
    let scope_raw =
        String::from_utf8(raw.to_vec()).map_err(|_| "Gateway policy scope must be UTF8")?;
    Ok(Inputs {
        scope_raw,
        scope_pin,
        coordinator_pin: coordinator_pin.into(),
        scope,
        profile,
        ca,
        locator,
        locator_pin: locator_pin.into(),
        coordinator,
    })
}

const RUNNER: &str = r#"
import base64,sys
try:
    wire=decode(sys.stdin.buffer.read(256*1024+1))
    ca=base64.b64decode(wire['ca'],validate=True)
    scope=gateway_access_scope(wire['scope'].encode(),wire['scope_pin'],ca,int(time.time()))
    flow=GatewayAccess(scope,HttpsProvider(scope,ca,wire['token']).request)
    if wire['review_sha256'] is None:
        plan=flow.review()
        output={'plan':plan,'sha256':hashlib.sha256(encode(plan)).hexdigest()}
    else:
        output=flow.apply(wire['state'],wire['review_sha256'])
    sys.stdout.buffer.write(encode(output))
except Exception:
    sys.exit(1)
"#;

async fn exchange(
    input: &Inputs,
    control: &Path,
    state: &Path,
    review: Option<&str>,
) -> Result<Value, String> {
    let credential = vpn_credential::load(
        input.locator.clone(),
        &input.coordinator_pin,
        true,
        Some(&input.locator_pin),
        control,
    )
    .await?;
    let token = std::str::from_utf8(&credential)
        .map_err(|_| "Invalid coordinator credential")?
        .trim_end_matches(['\r', '\n']);
    // Serialize the borrowed secret straight into a protected buffer.
    #[derive(serde::Serialize)]
    struct Wire<'a> {
        scope: &'a str,
        scope_pin: &'a str,
        ca: String,
        token: &'a str,
        state: &'a Path,
        review_sha256: Option<&'a str>,
    }
    let wire = Zeroizing::new(
        serde_json::to_vec(&Wire {
            scope: &input.scope_raw,
            scope_pin: &input.scope_pin,
            ca: STANDARD.encode(&input.ca[..]),
            token,
            state,
            review_sha256: review,
        })
        .map_err(|_| "Cannot encode the private policy exchange")?,
    );
    let mut child = tokio::process::Command::new("/usr/bin/python3")
        .args(["-I", "-B", "-c", &format!("{PROVIDER}\n{RUNNER}")])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Native coordinator exchange is unavailable")?;
    drop(credential);
    let failure = if review.is_some() {
        "Gateway policy outcome is unavailable. Review the original named resources before retrying."
    } else {
        "The NetBird account, gateway groups, or policies could not be verified. No policy write was requested."
    };
    tokio::time::timeout(Duration::from_secs(180), async {
        let mut stdin = child.stdin.take().ok_or(failure)?;
        stdin.write_all(&wire).await.map_err(|_| failure)?;
        drop(stdin);
        drop(wire);
        let mut stdout = child.stdout.take().ok_or(failure)?.take(16385);
        let mut raw = Zeroizing::new(Vec::new());
        stdout.read_to_end(&mut raw).await.map_err(|_| failure)?;
        let status = child.wait().await.map_err(|_| failure)?;
        if !status.success() || raw.len() > 16384 {
            return Err(failure.to_string());
        }
        json_bytes(&raw)
    })
    .await
    .map_err(|_| failure.to_string())?
}

fn export(input: &Inputs, result: &Value, folder: &Path) -> Result<Value, String> {
    if result["schema"] != "nodenetwork-gateway-access-result-v1"
        || result["review"]["scope_sha256"] != input.scope_pin
    {
        return Err("Gateway policy receipt does not match the native scope".into());
    }
    let provider = &result["provider_policy"];
    if provider["profile"] != crate::gateway_vpn::PROFILE
        || provider["network_binding"] != input.scope["network_binding"]
        || provider["required_gateway_tcp"] != input.scope["required_gateway_tcp"]
        || provider["expires_at"] != input.scope["expires_at"]
        || !COORDINATOR_FIELDS
            .iter()
            .all(|field| provider[*field] == input.scope[*field])
        || provider["auto_groups"] != json!([result["review"]["gateway_group"]["id"]])
    {
        return Err("Gateway provider export differs from the verified restricted rule".into());
    }
    let provider_raw = provider.to_string();
    let provider_pin = hash(provider_raw.as_bytes());
    let mut locator = json_bytes(&input.locator)?;
    locator["provider_sha256"] = json!(provider_pin);
    let locator_raw = Zeroizing::new(locator.to_string());
    let locator_pin = hash(locator_raw.as_bytes());
    let mut profile = input.profile.clone();
    profile["gateway"]["vpn_provider_sha256"] = json!(provider_pin);
    profile["gateway"]["vpn_credential_locator_sha256"] = json!(locator_pin);
    let profile_raw = profile.to_string();
    let folder = folder.join(format!("gateway-vpn-{}", &input.scope_pin[..16]));
    std::fs::create_dir(&folder)
        .or_else(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(|_| "Cannot create the approved gateway VPN export directory")?;
    if !std::fs::symlink_metadata(&folder).is_ok_and(|m| m.is_dir()) {
        return Err("Gateway VPN export directory is not a real directory".into());
    }
    for (name, raw) in [
        ("provider.json", provider_raw.as_bytes()),
        ("credential-locator.json", locator_raw.as_bytes()),
        ("ca.pem", &input.ca[..]),
        ("network-provisioning.json", profile_raw.as_bytes()),
    ] {
        let path = folder.join(name);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut f) => f
                .write_all(raw)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Gateway VPN export was interrupted")?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if read(&path, 128 * 1024, true)?.as_slice() != raw {
                    return Err(
                        "An existing gateway VPN export differs. Choose another output folder."
                            .into(),
                    );
                }
            }
            Err(_) => return Err("Cannot write the gateway VPN export".into()),
        }
    }
    Ok(
        json!({"version": 1, "ok": true, "result": {"schema": "nodenetwork-gateway-vpn-export-v1",
        "profile_sha256": hash(profile_raw.as_bytes()), "provider_sha256": provider_pin,
        "credential_locator_sha256": locator_pin, "gateway_group_id": result["review"]["gateway_group"]["id"],
        "upstream_group_id": result["review"]["upstream_group"]["id"], "policy_id": result["review"]["relay_policy"]["id"]}}),
    )
}

async fn confirm(
    window: &tauri::WebviewWindow,
    title: &'static str,
    label: &'static str,
    text: String,
) -> Result<bool, String> {
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .message(text)
            .parent(&window)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(
                label.into(),
                "Cancel".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| "Native gateway policy review was interrupted".into())
}

pub(super) async fn configure(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    target: Target,
) -> Result<Option<Value>, String> {
    if !cfg!(all(debug_assertions, unix)) || target.kind != "remote" || target.guest.is_some() {
        return Err(
            "Gateway policy configuration requires a pinned remote host in engineering Portal"
                .into(),
        );
    }
    let coordinator_pin = option_env!("SYNERGY_NODENETWORK_GATEWAY_VPN_COORDINATOR_SHA256")
        .ok_or("This build has no independently approved NetBird gateway policy coordinator")?;
    let locator_pin = option_env!("SYNERGY_NODENETWORK_GATEWAY_VPN_COORDINATOR_LOCATOR_SHA256")
        .ok_or("This build has no independently approved NetBird coordinator credential locator")?;
    let control = node_controller::control_directory(
        &app.path()
            .home_dir()
            .map_err(|_| "Operator home unavailable")?,
    )?;
    let path = node_controller::bootstrap_host_pin(&target, &control)?;
    let (host_line, fingerprint) = node_controller::profile_host_identity(&target, &path)?;
    let selection = window.clone();
    let folders = tauri::async_runtime::spawn_blocking(move || {
        let Some(input) = selection
            .dialog()
            .file()
            .set_parent(&selection)
            .set_title("Select the approved gateway policy scope and origin folder")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let Some(output) = selection
            .dialog()
            .file()
            .set_parent(&selection)
            .set_title("Select the export parent for the verified gateway VPN profile")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        Ok::<_, String>(Some((
            input
                .into_path()
                .map_err(|_| "Select a local gateway policy scope folder")?,
            output
                .into_path()
                .map_err(|_| "Select a local gateway policy output parent")?,
        )))
    })
    .await
    .map_err(|_| "Gateway policy selection was interrupted")??;
    let Some((folder, output)) = folders else {
        return Ok(None);
    };
    let selected = inputs(&folder, &target, &host_line, coordinator_pin, locator_pin)?;
    let message = format!("Target {}\nSSH fingerprint {fingerprint}\nNetwork: {}\nGenesis: {}\nAuthority root SHA-256: {}\nUpstream TCP: {}\n\nRead account, peers, groups and policies from {} using the existing credential on {}.\nAccount: {}\nScope SHA-256: {}\nCredential locator SHA-256: {}\n\nThis review reads coordinator inventory only.",
        target.label(), selected.scope["network_binding"], selected.profile["genesis_hash"],
        selected.profile["origin"]["authority-root.pub"], selected.scope["required_gateway_tcp"],
        selected.scope["api_origin"], selected.coordinator["host"], selected.scope["account_id"],
        selected.scope_pin, selected.locator_pin);
    if !confirm(
        &window,
        "Review gateway-only VPN access",
        "Read coordinator inventory",
        message,
    )
    .await?
    {
        return Ok(None);
    }

    let state = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Native app state unavailable")?
        .join("nodenetwork-gateway-vpn-policy");
    std::fs::create_dir_all(&state)
        .map_err(|_| "Cannot prepare gateway policy reconciliation state")?;
    let reviewed = {
        let _serial = crate::vpn_enrollment::SERIAL.lock().await;
        exchange(&selected, &control, &state, None).await?
    };
    let review_pin = reviewed["sha256"]
        .as_str()
        .filter(|pin| hash(reviewed["plan"].to_string().as_bytes()) == *pin)
        .ok_or("Gateway policy review digest differs")?;
    if reviewed["plan"]["scope_sha256"] != selected.scope_pin {
        return Err("Coordinator review did not match the exact gateway policy scope".into());
    }
    let message = format!("Coordinator {}\nTarget {}\n\n{}\n\nReview SHA-256: {review_pin}\n\nCreate only missing dedicated groups and one directional TCP policy to this upstream. The gateway group must be empty. No key is issued. Existing resources are observed for reconciliation.",
                          selected.scope["api_origin"], target.label(), reviewed["plan"]);
    if !confirm(
        &window,
        "Apply gateway-only VPN policy",
        "Apply reviewed VPN policy once",
        message,
    )
    .await?
    {
        return Ok(None);
    }
    if selected.scope["expires_at"].as_u64().unwrap_or(0) <= unix_now()? {
        return Err("Gateway policy approval expired during the native review".into());
    }
    let _serial = crate::vpn_enrollment::SERIAL.lock().await;
    let verified = exchange(&selected, &control, &state, Some(review_pin)).await?;
    export(&selected, &verified, &output).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinator_binding_rejects_locator_redirection() {
        let root = json!({"version":1,"profile":COORDINATOR_PROFILE,
            "api_origin":"https://vpn.example","management_origin":"https://vpn.example",
            "account_id":"stable-account","ca_sha256":"a".repeat(64)});
        let raw = root.to_string();
        let pin = hash(raw.as_bytes());
        assert!(verify_coordinator(raw.as_bytes(), &pin, &root).is_ok());
        assert!(verify_coordinator(raw.as_bytes(), &"b".repeat(64), &root).is_err());
        for (field, replacement) in [
            ("account_id", "other-account"),
            ("api_origin", "https://other.example"),
            ("ca_sha256", "invalid"),
        ] {
            let mut candidate = root.clone();
            candidate[field] = json!(replacement);
            assert!(
                verify_coordinator(raw.as_bytes(), &pin, &candidate).is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn pinned_target_includes_host_key_and_port() {
        let original = Target {
            kind: "remote".into(),
            host: Some("gw.example".into()),
            port: Some(22),
            root: node_controller::ROOT.into(),
            guest: None,
        };
        let mut different = original.clone();
        different.port = Some(2222);
        assert_ne!(
            scope_target(&original, "key"),
            scope_target(&different, "key")
        );
        assert_ne!(
            scope_target(&original, "key"),
            scope_target(&original, "other key")
        );
    }
}
