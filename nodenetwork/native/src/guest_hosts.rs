//! App-managed guests. Host policy alone selects authenticated image/tools/resources.
//! A guest endpoint is HOST-relative; it is never a directly trusted Portal target.
use crate::{
    commands,
    node_controller::{self, Request, Target},
    request_journal,
};
use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn pin(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn require(ok: bool) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(
            "Authenticated guest response is incomplete or changed; no guest readiness is inferred"
                .into(),
        )
    }
}
pub(crate) fn preflight(value: &Value, guest_id: &str) -> Result<Value, String> {
    require(
        value["schema"] == "nodenetwork-guest-preflight-v1"
            && value["image_verified"] == true
            && value["toolchain_pins_verified"] == true
            && value["kvm_verified"] == true
            && value["validator_installed"] == false,
    )?;
    let selection = &value["selection"];
    require(
        selection.as_object().is_some_and(|m| m.len() == 5)
            && selection["guest_id"] == guest_id
            && id(guest_id)
            && pin(&selection["image_sha256"]),
    )?;
    for (key, low, high) in [
        ("cpu_count", 1, 32),
        ("memory_mib", 1024, 65536),
        ("disk_gib", 8, 512),
    ] {
        require(
            selection[key]
                .as_u64()
                .is_some_and(|n| (low..=high).contains(&n)),
        )?;
    }
    require(
        value["ssh_forward_port"]
            .as_u64()
            .is_some_and(|n| (1024..=65535).contains(&n)),
    )?;
    Ok(selection.clone())
}
pub(crate) fn status(value: &Value, guest_id: &str) -> Result<Value, String> {
    require(
        value["schema"] == "nodenetwork-guest-status-v1"
            && value["guest_id"] == guest_id
            && id(guest_id)
            && value["exists"].is_boolean()
            && (value["validator_installed"] == false
                || (value["exists"] == false && value["removed"] == true)),
    )?;
    if value["exists"] == true {
        if ["runtime_version","resume_sequence","resume_request_sha256","resume_verified"].iter().any(|k|value.get(*k).is_some()){require(matches!(value["runtime_version"].as_u64(),Some(1|2))&&value["resume_sequence"].as_u64().is_some_and(|n|n<=128)&&value["resume_verified"].is_boolean()
            &&(value["resume_sequence"]==0&&value["resume_request_sha256"].is_null()&&value["resume_verified"]==false||value["resume_sequence"].as_u64().is_some_and(|n|n>0)&&pin(&value["resume_request_sha256"])))?;}
        if ["stop_verified","stop_request_sha256","stopped_resume_request_sha256"].iter().any(|k|value.get(*k).is_some()){
            require(value["stop_verified"].is_boolean()&&(value["stop_request_sha256"].is_null()||pin(&value["stop_request_sha256"]))&&(value["stopped_resume_request_sha256"].is_null()||pin(&value["stopped_resume_request_sha256"])))?;
        }
        require(
            matches!(
                value["phase"].as_str(),
                Some("creating" | "start-dispatched" | "created")
            ) && pin(&value["request_sha256"])
                && value["pid"].as_u64().is_some(),
        )?;
        if value["ssh_identity_verified"] == true {
            require(
                value["ssh_endpoint"]["host"] == "127.0.0.1"
                    && value["ssh_endpoint"]["port"]
                        .as_u64()
                        .is_some_and(|n| (1024..=65535).contains(&n)),
            )?;
            let public = value["ssh_host_public_key"]
                .as_str()
                .ok_or("Missing public guest SSH identity")?;
            use base64::{engine::general_purpose::STANDARD, Engine};
            use sha2::{Digest, Sha256};
            let encoded = public
                .strip_prefix("ssh-ed25519 ")
                .ok_or("Unexpected guest SSH host-key algorithm")?;
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "Invalid guest SSH host key")?;
            require(bytes.len() == 51 && bytes[..19] == *b"\0\0\0\x0bssh-ed25519\0\0\0 ")?;
            require(
                value["ssh_host_fingerprint"]
                    == format!(
                        "SHA256:{}",
                        STANDARD
                            .encode(Sha256::digest(&bytes))
                            .trim_end_matches('=')
                    ),
            )?;
        } else {
            require(value["phase"] == "creating" && value["ssh_endpoint"].is_null())?;
        }
        require(
            value["guest_os_reachability_verified"] == false && value["vpn_enrolled"] == false,
        )?;
    } else {
        require(value["ssh_identity_verified"] == false || value["removed"] == true)?;
    }
    let mut safe = json!({"schema":"nodenetwork-guest-status-v1","guest_id":guest_id,"exists":value["exists"],"validator_installed":false,"ssh_identity_verified":value["ssh_identity_verified"]==true});
    for field in [
        "phase",
        "request_sha256",
        "service_state",
        "pid",
        "ssh_endpoint",
        "ssh_host_public_key",
        "ssh_host_fingerprint",
        "guest_os_reachability_verified",
        "vpn_enrolled",
        "removed",
        "runtime_version", "resume_sequence", "resume_request_sha256", "resume_verified",
        "stop_verified", "stop_request_sha256", "stopped_resume_request_sha256",
    ] {
        if let Some(v) = value.get(field) {
            safe[field] = v.clone();
        }
    }
    Ok(safe)
}

pub(crate) fn boot_diagnostics(value:&Value,guest_id:&str)->Result<Value,String>{
    let fields=["schema","guest_id","request_sha256","runtime_version","sampled_bytes","log_size_bytes","categories","mutation_performed"];
    let categories=["firmware_started","boot_device_attempted","boot_device_failed","firmware_asset_missing","kernel_started","cloud_init_observed","ssh_started","ssh_failed","kernel_panic","login_prompt"];
    require(value.as_object().is_some_and(|m|m.len()==fields.len()&&fields.iter().all(|k|m.contains_key(*k)))
        &&value["schema"]=="nodenetwork-guest-boot-diagnostics-v1"&&value["guest_id"]==guest_id&&pin(&value["request_sha256"])
        &&matches!(value["runtime_version"].as_u64(),Some(1|2))&&value["sampled_bytes"].as_u64().is_some_and(|n|n<=65536)
        &&value["log_size_bytes"].as_u64().is_some_and(|n|n>=value["sampled_bytes"].as_u64().unwrap_or(u64::MAX))&&value["mutation_performed"]==false
        &&value["categories"].as_object().is_some_and(|m|m.len()==categories.len()&&categories.iter().all(|k|m.get(*k).is_some_and(Value::is_boolean))))?;
    Ok(value.clone())
}

fn resume_request(current:&Value,guest_id:&str,sequence:u64)->Request{
    Request{version:1,operation:"guest_resume".into(),parameters:json!({"guest_id":guest_id,"resume_sequence":sequence,"create_request_sha256":current["request_sha256"]})}
}
fn reconcile_stopped(base:&std::path::Path,target:&Target,current:&Value,guest_id:&str)->Result<(),String>{
    if current["stop_verified"]!=true{return Ok(())}
    let stop=Request{version:1,operation:"guest_stop".into(),parameters:json!({"guest_id":guest_id})};
    require(current["pid"]==0&&matches!(current["service_state"].as_str(),Some("inactive"|"failed"))&&current["stop_request_sha256"]==stop.approval_id())?;
    if !current["stopped_resume_request_sha256"].is_null(){
        let sequence=current["resume_sequence"].as_u64().ok_or("Missing stopped resume sequence")?;
        let prior=resume_request(current,guest_id,sequence);prior.validate()?;
        require(current["resume_request_sha256"]==prior.approval_id()&&current["stopped_resume_request_sha256"]==prior.approval_id())?;
        request_journal::reconcile_guest_stopped(base,&target.journal_identity(),&prior.approval_id(),&stop.approval_id())?;
    }
    Ok(())
}

fn connection_report(guest_id:&str,current:Option<&Value>,code:&str)->Value{
    json!({"schema":"nodenetwork-guest-connection-v1","guest_id":guest_id,
        "request_sha256":current.and_then(|v|v.get("request_sha256")),
        "ssh_host_fingerprint":current.and_then(|v|v.get("ssh_host_fingerprint")),
        "ready":code=="ready","code":code,"mutation_performed":false})
}

#[tauri::command]
pub async fn portal_nodenetwork_guest(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    target: Target,
    operation: String,
    guest_id: String,
) -> Result<Option<Value>, String> {
    commands::main_only(&window)?;
    target.validate()?;
    if matches!(operation.as_str(),"resume"|"boot_diagnostics")&&target.guest.is_some(){return Err("Select the physical guest host".into())}
    if !id(&guest_id)
        || !matches!(
            operation.as_str(),
            "preflight" | "status" | "connection" | "boot_diagnostics" | "create" | "stop" | "resume" | "remove"
        )
    {
        return Err(
            "Choose an independently approved guest identifier and supported lifecycle operation"
                .into(),
        );
    }
    let control = node_controller::control_directory(
        &app.path()
            .home_dir()
            .map_err(|_| "Operator home unavailable")?,
    )?;
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Portal app state unavailable")?;
    let read = |name: &str| Request {
        version: 1,
        operation: name.into(),
        parameters: json!({"guest_id":guest_id}),
    };
    if operation=="connection"&&(target.kind!="remote"||target.guest.is_some()){
        return Err("Select the physical hosting machine for guest connection diagnostics".into());
    }
    let observed = match commands::controller(&app, target.clone(), read("guest_status"), &control).await{
        Ok(reply)=>reply,
        Err(_) if operation=="connection"=>return Ok(Some(connection_report(&guest_id,None,"physical_controller_unavailable"))),
        Err(error)=>return Err(error),
    };
    if observed["ok"] != true {
        if operation=="connection"{return Ok(Some(connection_report(&guest_id,None,"physical_controller_unavailable")))}
        return Err(
            "Target refused guest attribution; verify its approved master and host policy".into(),
        );
    }
    let current = status(&observed["result"], &guest_id)?;
    if operation=="connection"{
        let code=crate::managed_guest::connection_probe(&target,&current,&control).await?;
        return Ok(Some(connection_report(&guest_id,Some(&current),code)));
    }
    if current["phase"] == "created" {
        request_journal::reconcile_verified(
            &base,
            &target.journal_identity(),
            "guest_create",
            current["request_sha256"]
                .as_str()
                .ok_or("Missing guest creation receipt")?,
        )?;
    }
    if current["resume_verified"]==true {
        require(current["runtime_version"]==2 && current["service_state"]=="active" && current["pid"].as_u64().is_some_and(|v|v>1) && pin(&current["resume_request_sha256"]))?;
        request_journal::reconcile_verified(&base,&target.journal_identity(),"guest_resume",current["resume_request_sha256"].as_str().unwrap())?;
    }
    if operation=="boot_diagnostics" {
        let reply=commands::controller(&app,target,read("guest_boot_diagnostics"),&control).await?;
        require(reply["ok"]==true)?;return boot_diagnostics(&reply["result"],&guest_id).map(Some);
    }
    reconcile_stopped(&base,&target,&current,&guest_id)?;
    if operation == "status" {
        return Ok(Some(current));
    }
    let prepared = if matches!(operation.as_str(), "preflight" | "create") {
        if current["exists"] != false {
            return Err("An existing or interrupted guest must be reconciled; creation will not be replayed".into());
        }
        let reply =
            commands::controller(&app, target.clone(), read("guest_preflight"), &control).await?;
        if reply["ok"] != true {
            return Err("Guest preflight refused: the host must already contain its independently pinned image, tools, firmware and approval".into());
        }
        preflight(&reply["result"], &guest_id)?;
        if operation == "preflight" {
            return Ok(Some(
                json!({"schema":"nodenetwork-guest-preflight-v1","selection":preflight(&reply["result"],&guest_id)?,"ssh_forward_port":reply["result"]["ssh_forward_port"],"image_verified":true,"toolchain_pins_verified":true,"kvm_verified":true,"validator_installed":false}),
            ));
        }
        Some(reply["result"].clone())
    } else {
        None
    };
    if operation == "stop" && current["exists"] != true {
        return Err("No attributed guest exists to stop".into());
    }
    if operation == "resume" && (current["exists"]!=true || current["phase"]!="created" || current["pid"]!=0 || !matches!(current["service_state"].as_str(),Some("inactive"|"failed"))) {return Err("Explicitly stop and inspect the exact existing guest before diagnostic resume".into())}
    if operation == "remove"
        && (current["exists"] != true
            || !matches!(
                current["service_state"].as_str(),
                Some("inactive" | "failed")
            )
            || current["pid"] != 0)
    {
        return Err("Read status and stop the attributed guest before removal".into());
    }
    let request = if operation == "create" {
        Request {
            version: 1,
            operation: "guest_create".into(),
            parameters: preflight(prepared.as_ref().unwrap(), &guest_id)?,
        }
    } else if operation=="resume" {
        let sequence=current["resume_sequence"].as_u64().unwrap_or(0);require(sequence<128)?;
        resume_request(&current,&guest_id,sequence+1)
    } else {
        read(&format!("guest_{operation}"))
    };
    request.validate()?;
    let message=format!("Host: {}\nGuest: {}\nOperation: {}\nExact request SHA-256: {}\nApproved selection: {}\n\nDiagnostic resume preserves the existing disk, seed, SSH identity and original creation request; it changes only the attributed runtime to record OS serial boot categories. It never replays an uncertain start. Creation uses only the target's pinned image, tools and resource policy. It starts an isolated OS guest, not a validator. Its SSH endpoint is relative to that host; no Portal connection, VPN, APQE identity or consensus admission is inferred. Removal deletes this guest disk and management identity. Uncertain outcomes must be reconciled through Read guest status; never replay automatically.",target.label(),guest_id,operation,request.approval_id(),prepared.as_ref().unwrap_or(&current));
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .message(message)
            .parent(&window)
            .title("Authorize managed guest lifecycle")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Authorize once".into(),
                "Cancel".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| "Native guest confirmation did not finish")?;
    if !accepted {
        return Ok(None);
    }
    let latest=commands::controller(&app,target.clone(),read("guest_status"),&control).await?;
    require(latest["ok"]==true && status(&latest["result"],&guest_id)?==current)?;
    commands::exact_continuation(&app, &target, &request, &control, None).await?;
    let dispatch=if operation=="stop"&&pin(&current["resume_request_sha256"]){
        let sequence=current["resume_sequence"].as_u64().ok_or("Missing original resume sequence")?;
        let original=resume_request(&current,&guest_id,sequence);original.validate()?;
        require(current["resume_request_sha256"]==original.approval_id())?;
        request_journal::Dispatch::begin_guest_stop(&base,&target.journal_identity(),&request.canonical(),&original.canonical())?
    }else{request_journal::Dispatch::begin(&base,&target.journal_identity(),&request.operation,&request.canonical())?};
    let resume_pin=request.approval_id();
    let reply = commands::controller(&app, target.clone(), request, &control).await.and_then(|reply|{
        if operation=="stop"&&reply["ok"]==true{let observed=status(&reply["result"],&guest_id)?;require(observed["stop_verified"]==true&&observed["stop_request_sha256"]==resume_pin&&observed["pid"]==0&&matches!(observed["service_state"].as_str(),Some("inactive"|"failed")))?;}
        if operation=="resume"&&reply["ok"]==true {
            let observed=status(&reply["result"],&guest_id)?;
            require(observed["resume_request_sha256"]==resume_pin && observed["resume_verified"]==true)?;
        }
        Ok(reply)
    });
    dispatch.finish(&reply)?;
    let reply = reply?;
    if reply["ok"] != true {
        return Err(
            "Guest operation refused or uncertain; read attributed status before proceeding".into(),
        );
    }
    let observed=status(&reply["result"], &guest_id)?;
    reconcile_stopped(&base,&target,&observed,&guest_id)?;
    Ok(Some(observed))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_approved_selection_only() {
        let mut v = json!({"schema":"nodenetwork-guest-preflight-v1","selection":{"guest_id":"fifth","image_sha256":"a".repeat(64),"cpu_count":8,"memory_mib":32768,"disk_gib":240},"ssh_forward_port":22285,"image_verified":true,"toolchain_pins_verified":true,"kvm_verified":true,"validator_installed":false});
        assert!(preflight(&v, "fifth").is_ok());
        assert!(preflight(&v, "other").is_err());
        v["selection"]["image_url"] = json!("https://untrusted");
        assert!(preflight(&v, "fifth").is_err());
        v["selection"].as_object_mut().unwrap().remove("image_url");
        v["kvm_verified"] = json!(false);
        assert!(preflight(&v, "fifth").is_err());
    }
    #[test]
    fn bounds_and_removed_receipt() {
        assert!(!id("../guest"));
        assert!(!id("Guest"));
        assert!(!id(""));
        let base = json!({"schema":"nodenetwork-guest-preflight-v1","selection":{"guest_id":"fifth","image_sha256":"a".repeat(64),"cpu_count":8,"memory_mib":32768,"disk_gib":240},"ssh_forward_port":22285,"image_verified":true,"toolchain_pins_verified":true,"kvm_verified":true,"validator_installed":false});
        for (field, bad) in [
            ("cpu_count", json!(33)),
            ("memory_mib", json!(true)),
            ("disk_gib", json!(7)),
            ("image_sha256", json!("A".repeat(64))),
        ] {
            let mut v = base.clone();
            v["selection"][field] = bad;
            assert!(preflight(&v, "fifth").is_err());
        }
        let removed = json!({"schema":"nodenetwork-guest-status-v1","guest_id":"fifth","exists":false,"removed":true,"unexpected_secret":"not-public"});
        let safe = status(&removed, "fifth").unwrap();
        assert!(safe.get("unexpected_secret").is_none());
        assert_eq!(safe["validator_installed"], false);
    }
    #[test]
    fn exact_host_identity_and_loopback_binding() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use sha2::{Digest, Sha256};
        let mut bytes = b"\0\0\0\x0bssh-ed25519\0\0\0 ".to_vec();
        bytes.extend([7; 32]);
        let mut v = json!({"schema":"nodenetwork-guest-status-v1","guest_id":"fifth","exists":true,"phase":"created","request_sha256":"a".repeat(64),"pid":7,"validator_installed":false,"ssh_identity_verified":true,"ssh_endpoint":{"host":"127.0.0.1","port":22285},"ssh_host_public_key":format!("ssh-ed25519 {}",STANDARD.encode(&bytes)),"ssh_host_fingerprint":format!("SHA256:{}",STANDARD.encode(Sha256::digest(&bytes)).trim_end_matches('=')),"guest_os_reachability_verified":false,"vpn_enrolled":false});
        assert!(status(&v, "fifth").is_ok());
        v["ssh_endpoint"]["host"] = json!("0.0.0.0");
        assert!(status(&v, "fifth").is_err());
        v["ssh_endpoint"]["host"] = json!("127.0.0.1");
        v["ssh_host_fingerprint"] = json!("SHA256:forged");
        assert!(status(&v, "fifth").is_err());
    }
    #[test]
    fn status_never_claims_validator_or_accepts_forged_fingerprint() {
        let mut v = json!({"schema":"nodenetwork-guest-status-v1","guest_id":"fifth","exists":false,"validator_installed":false,"ssh_identity_verified":false});
        assert!(status(&v, "fifth").is_ok());
        v["validator_installed"] = json!(true);
        assert!(status(&v, "fifth").is_err());
        v["validator_installed"] = json!(false);
        v["exists"] = json!(true);
        v["phase"] = json!("created");
        v["pid"] = json!(1);
        v["request_sha256"] = json!("a".repeat(64));
        v["ssh_identity_verified"] = json!(true);
        v["ssh_endpoint"] = json!({"host":"127.0.0.1","port":22285});
        v["ssh_host_public_key"] = json!("ssh-ed25519 AAAA");
        v["ssh_host_fingerprint"] = json!("SHA256:forged");
        assert!(status(&v, "fifth").is_err());
    }
    #[test] fn boot_categories_are_closed_bounded_and_never_raw(){
        let mut value=json!({"schema":"nodenetwork-guest-boot-diagnostics-v1","guest_id":"fifth","request_sha256":"a".repeat(64),"runtime_version":2,"sampled_bytes":42,"log_size_bytes":42,"mutation_performed":false,"categories":{"firmware_started":true,"boot_device_attempted":true,"boot_device_failed":false,"firmware_asset_missing":false,"kernel_started":true,"cloud_init_observed":true,"ssh_started":false,"ssh_failed":false,"kernel_panic":false,"login_prompt":true}});
        assert!(boot_diagnostics(&value,"fifth").is_ok());assert!(boot_diagnostics(&value,"other").is_err());
        value["raw_log"]=json!("private");assert!(boot_diagnostics(&value,"fifth").is_err());value.as_object_mut().unwrap().remove("raw_log");
        value["sampled_bytes"]=json!(65537);assert!(boot_diagnostics(&value,"fifth").is_err());
        let current=json!({"request_sha256":"a".repeat(64)});let r=resume_request(&current,"fifth",1);assert_eq!(r.validate(),Ok(true));
        assert!(resume_request(&current,"fifth",129).validate().is_err());
    }

}
