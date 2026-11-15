//! Typed operational bridge. Host policy, custody and consensus authority stay on target.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ROOT: &str = "/opt/Synergy";
const CONTROLLER: &str = "/opt/Synergy/tmp/controller/controller.py";
const LIMIT: u64 = 1_000_000;
pub(super) static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target { pub kind: String, pub host: Option<String>, pub port: Option<u16>, pub root: String }

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request { pub version: u8, pub operation: String, pub parameters: Value }

fn valid_name(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
fn host_name(s: &str) -> bool {
    if s.starts_with('[') && s.ends_with(']') { return s[1..s.len()-1].parse::<std::net::Ipv6Addr>().is_ok(); }
    !s.is_empty() && s.len() <= 253 && s.split('.').all(|p| !p.is_empty() && p.len() <= 63
        && p.as_bytes()[0].is_ascii_alphanumeric() && p.as_bytes()[p.len()-1].is_ascii_alphanumeric()
        && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}
impl Target {
    pub fn validate(&self) -> Result<(), String> {
        if self.root != ROOT { return Err("Validator root must be /opt/Synergy.".into()); }
        match self.kind.as_str() {
            "local" if self.host.is_none() && self.port.is_none() => Ok(()),
            "remote" if self.host.as_deref().is_some_and(host_name) && self.port.is_none_or(|p| p>0) => Ok(()),
            _ => Err("Choose this machine or an enrolled remote hostname without credentials or commands.".into()),
        }
    }
    pub fn label(&self) -> String {
        if self.kind == "local" { "Local · this machine".into() }
        else { format!("Remote · {} · SSH port {}", self.host.as_deref().unwrap_or("Unavailable"), self.port.unwrap_or(22)) }
    }
    pub fn journal_identity(&self) -> Value {
        json!({"kind":self.kind,"host":self.host.as_ref().map(|h|h.to_ascii_lowercase()),"port":if self.kind=="remote" {Some(self.port.unwrap_or(22))} else {None},"root":self.root})
    }
}
impl Request {
    pub fn validate(&self) -> Result<bool, String> {
        if self.version != 1 { return Err("Unsupported controller protocol.".into()); }
        let p = self.parameters.as_object().ok_or("Controller parameters must be an object.")?;
        let mutation = match self.operation.as_str() {
            "target"|"inventory"|"health"|"diagnostics"|"install_preflight"|"upgrade_preflight"|"recovery_preflight"|"uninstall_preflight"|"vpn_status"|"identity_status"|"formation_status"|"identity_preflight"|"formation_preflight"|"genesis_binding_preflight" => false,
            "install"|"commission"|"register"|"start"|"stop"|"restart"|"upgrade"|"uninstall" => true,
            _ => return Err("Unsupported NodeNetwork controller operation.".into()),
        };
        let expected: &[&str] = match self.operation.as_str() {
            "install"|"install_preflight" => &["release_id","manifest_sha256","network_id","chain_id","node_name"],
            "upgrade"|"upgrade_preflight" => &["release_id","manifest_sha256"],
            "uninstall" => &["confirmation"],
            _ => &[],
        };
        if p.len() != expected.len() || expected.iter().any(|k| !p.contains_key(*k)) {
            return Err("Unexpected controller parameters; paths, secrets and shell commands are forbidden.".into());
        }
        if expected.contains(&"release_id") {
            let release = p["release_id"].as_str().ok_or("Missing release ID.")?;
            let pin = p["manifest_sha256"].as_str().ok_or("Missing manifest digest.")?;
            if release.is_empty() || release.len()>128 || !release.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                || pin.len()!=64 || !pin.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                return Err("Invalid release identifier or SHA-256 digest.".into());
            }
        }
        if expected.contains(&"network_id") {
            let network = p["network_id"].as_str().ok_or("Missing network ID.")?;
            let name = p["node_name"].as_str().ok_or("Missing node name.")?;
            if !(network.len()>=2 && network.len()<=128 && network.as_bytes()[0].is_ascii_alphanumeric()
                && network.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))) || !valid_name(name,64) || p["chain_id"].as_u64().is_none_or(|n| n==0) {
                return Err("Explicit network incarnation, nonzero chain ID and node name required.".into());
            }
        }
        if self.operation=="uninstall" && p["confirmation"]!=ROOT { return Err("Confirm the exact Synergy root before uninstalling.".into()); }
        Ok(mutation)
    }
    pub fn canonical(&self) -> Value { json!({"version":self.version,"operation":self.operation,"parameters":self.parameters}) }
    pub fn approval_id(&self) -> String { format!("{:x}",Sha256::digest(self.canonical().to_string().as_bytes())) }
}

#[cfg(unix)]
fn ensure_private_control_dir(directory: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    if !directory.exists() {
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(directory).map_err(|_|"Cannot create Portal SSH control directory.")?;
    }
    for ancestor in directory.ancestors() {
        if !std::fs::symlink_metadata(ancestor).is_ok_and(|m| m.is_dir()) { return Err("SSH control directory ancestry contains a link.".into()); }
    }
    let metadata=std::fs::metadata(directory).map_err(|_|"Cannot inspect SSH control directory.")?;
    let home=std::env::var_os("HOME").ok_or("Operator home is unavailable.")?;
    let owner=std::fs::metadata(home).map_err(|_|"Operator home is inaccessible.")?.uid();
    if metadata.uid()!=owner { return Err("SSH control directory belongs to another operator.".into()); }
    std::fs::set_permissions(directory,std::fs::Permissions::from_mode(0o700)).map_err(|_|"Cannot protect SSH control directory.".to_string())
}

pub(super) fn control_directory(home:&Path)->Result<std::path::PathBuf,String>{
    if !home.is_absolute(){return Err("Operator home must be an absolute directory.".into());}
    let directory=home.join(".synergy-portal/ssh");
    if directory.join("0".repeat(24)).as_os_str().len()>95{return Err("Operator home path exceeds the qualified SSH socket budget.".into());}
    Ok(directory)
}

fn control_socket(target:&Target,directory:&Path)->std::path::PathBuf {
    directory.join(format!("{:x}",Sha256::digest(format!("{}:{}",target.host.as_deref().unwrap_or(""),target.port.unwrap_or(22)).as_bytes()))[..24].to_string())
}
pub(super) fn remote_command(target:&Target,directory:&Path,account:&str,remote:&str,known_hosts:Option<&Path>)->Result<tokio::process::Command,String>{
    target.validate()?;
    #[cfg(unix)] ensure_private_control_dir(directory)?;
    let socket=control_socket(target,directory);
    if socket.as_os_str().len()>95 {return Err("Portal SSH control path is too long on this platform.".into());}
    let qualification_pin=if known_hosts.is_none()&&cfg!(debug_assertions)&&target.host.as_deref()==Some("127.0.0.1")&&target.port==Some(22280){
        if let Some(pin)=option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"){
            let path=directory.join("isolated-qualification-known-hosts");
            let expected=format!("{}\n",pin.trim());
            if path.exists()||path.is_symlink(){
                let metadata=std::fs::symlink_metadata(&path).map_err(|_|"Cannot inspect isolated host pin.")?;
                if !metadata.is_file()||metadata.len()>2048||std::fs::read(&path).map_err(|_|"Cannot inspect isolated host pin.")?!=expected.as_bytes(){return Err("Isolated host pin differs from the independently compiled test authority.".into());}
            }else{
                use std::io::Write;
                let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);
                #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
                options.open(&path).map_err(|_|"Cannot create isolated host pin.")?.write_all(expected.as_bytes()).map_err(|_|"Cannot record isolated host pin.")?;
            }
            Some(path)
        }else{None}
    }else{None};
    let known_hosts=known_hosts.or(qualification_pin.as_deref());
    let mut c=tokio::process::Command::new("/usr/bin/ssh");
    c.args(["-F","/dev/null","-T","-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oUpdateHostKeys=no",
        "-oPasswordAuthentication=no","-oKbdInteractiveAuthentication=no","-oPreferredAuthentications=publickey","-oForwardAgent=no","-oClearAllForwardings=yes","-oConnectTimeout=10",
        "-oServerAliveInterval=15","-oServerAliveCountMax=2","-oControlMaster=auto","-oControlPersist=600"])
        .arg("-o").arg(format!("ControlPath={}",socket.display())).arg("-p").arg(target.port.unwrap_or(22).to_string());
    if let Some(pins)=known_hosts {c.arg("-o").arg(format!("UserKnownHostsFile={}",pins.display())).arg("-oGlobalKnownHostsFile=/dev/null");}
    c.arg("--").arg(format!("{}@{}",account,target.host.as_deref().ok_or("Missing remote host.")?.trim_matches(['[',']']))).arg(remote);
    Ok(c)
}
pub(super) async fn close_connection(target:&Target,directory:&Path){
    if target.kind!="remote" {return;}
    let _=tokio::time::timeout(Duration::from_secs(5),tokio::process::Command::new("/usr/bin/ssh")
        .args(["-F","/dev/null","-S"]).arg(control_socket(target,directory))
        .args(["-O","exit","--"]).arg(target.host.as_deref().unwrap_or("")).stdout(Stdio::null()).stderr(Stdio::null()).status()).await;
}

pub async fn execute(target: Target, request: Request, control_dir: &Path) -> Result<Value, String> {
    execute_pinned(target,request,control_dir,None).await
}

fn install_preflight_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    if reply["ok"] != true {
        if reply["error"]["code"] == "qualification_required" {
            return Err("The controller did not confirm package or network policy for this preflight.");
        }
        return Err("The selected controller could not provide an installation preflight report.");
    }
    let result = &reply["result"];
    if !result.as_object().is_some_and(|fields| fields.len() == 6)
        || result["release"] != request.parameters["release_id"] || result["root"] != ROOT
        || result["packageVerified"] != true || result["networkSelectionApproved"] != true
        || result["genesisAuthorityVerified"] != false || result["activationAuthorized"] != false {
        return Err("The selected controller returned unsupported or mismatched installation preflight evidence.");
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn vpn_status_reply(reply: &Value) -> Result<Value, &'static str> {
    use std::net::IpAddr;
    const UNSUPPORTED: &str = "The selected controller returned unsupported VPN status.";
    const FIELDS: [&str; 6] = ["service_registered", "enrollment_staged", "enrollment_recorded", "reconciliation_required", "server_bound", "connected"];
    if reply["ok"] != true {
        return Err("The selected controller could not provide VPN status.");
    }
    let result = &reply["result"];
    let fields = result.as_object().ok_or(UNSUPPORTED)?;
    if fields.len() != FIELDS.len() + 2 || result["schema"] != "nodenetwork-vpn-status-v1"
        || FIELDS.iter().any(|key| result[*key].as_bool().is_none()) {
        return Err(UNSUPPORTED);
    }
    let recorded = result["enrollment_recorded"] == true;
    let bound = result["server_bound"] == true;
    let connected = result["connected"] == true;
    let reconciliation = result["reconciliation_required"] == true;
    if (recorded && reconciliation) || (!recorded && (bound || connected))
        || (connected && result["service_registered"] != true) {
        return Err(UNSUPPORTED);
    }
    let overlay = fields.get("overlay_address").ok_or(UNSUPPORTED)?;
    if recorded {
        let (address, prefix) = overlay.as_str().filter(|text| text.len() <= 49)
            .and_then(|text| text.split_once('/')).ok_or(UNSUPPORTED)?;
        let ip = address.parse::<IpAddr>().map_err(|_| UNSUPPORTED)?;
        let limit = if ip.is_ipv4() { 32 } else { 128 };
        if !prefix.bytes().all(|byte| byte.is_ascii_digit()) || prefix.parse::<u8>().map_or(true, |bits| bits > limit) {
            return Err(UNSUPPORTED);
        }
    } else if !overlay.is_null() {
        return Err(UNSUPPORTED);
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn lowercase_digest(value: &Value) -> bool {
    value.as_str().is_some_and(|pin| pin.len() == 64 && pin.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')))
}

fn validator_network_context(result: &Value) -> bool {
    result["network_id"].as_str().is_some_and(|network| {
        (2..=128).contains(&network.len()) && network.as_bytes()[0].is_ascii_alphanumeric()
            && network.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
    }) && result["chain_id"].as_str().is_some_and(|chain| {
        chain.parse::<u64>().is_ok_and(|number| number > 0 && number.to_string() == chain)
    })
}

fn validator_address(value: &Value) -> bool {
    value.as_str().and_then(|address| address.strip_prefix("synv1")).is_some_and(|tail| {
        (10..=90).contains(&tail.len())
            && tail.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

fn preparation_reply(operation: &str, reply: &Value) -> Result<Value, &'static str> {
    const UNSUPPORTED: &str = "The selected controller returned unsupported validator preparation evidence.";
    if reply["ok"] != true {
        if reply["error"]["code"] == "authorization_required" {
            return Err("The controller has no confirmed approval for these preparation inputs. Review the required pins with the node operator.");
        }
        return Err("The controller could not confirm preparation. Review the staged inputs and any existing custody with the node operator.");
    }
    let result = &reply["result"];
    let fields = result.as_object().ok_or(UNSUPPORTED)?;
    let valid_operation = match operation {
        "identity_preflight" => fields.len() == 4 && result["genesis_authority_verified"] == true
            && lowercase_digest(&result["genesis_sha256"]),
        "formation_preflight" => fields.len() == 5 && result["schema"] == "nodenetwork-formation-v1"
            && lowercase_digest(&result["formation_sha256"]) && lowercase_digest(&result["formation_id"])
            && result["formation_id"].as_str().is_some_and(|id| id.bytes().any(|byte| byte != b'0')),
        _ => false,
    };
    if !reply.as_object().is_some_and(|fields| fields.len() == 3) || reply["version"] != 1
        || !validator_network_context(result) || !valid_operation {
        return Err(UNSUPPORTED);
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn genesis_binding_reply(reply: &Value) -> Result<Value, &'static str> {
    const UNSUPPORTED: &str = "The selected controller returned unsupported staged Genesis binding evidence.";
    if reply["ok"] != true {
        return Err(match reply["error"]["code"].as_str() {
            Some("reconciliation_required") => "The controller could not reconcile the Genesis binding. Preserve the existing custody and review it with the node operator.",
            Some("authorization_required") => "The controller has no confirmed approval for these Genesis inputs. Review the required pins with the node operator.",
            _ => "The controller could not confirm the staged Genesis binding. Ask the node operator to review the staged inputs and custody.",
        });
    }
    let result = &reply["result"];
    let bound = result["bound"].as_bool().ok_or(UNSUPPORTED)?;
    let stage_receipt = result.get("stage_request_sha256");
    let field_count = 8 + usize::from(stage_receipt.is_some()) + if bound { 3 } else { 0 };
    if !reply.as_object().is_some_and(|fields| fields.len() == 3) || reply["version"] != 1
        || !result.as_object().is_some_and(|fields| fields.len() == field_count)
        || result["schema"] != "nodenetwork-genesis-binding-v1" || !validator_network_context(result)
        || !lowercase_digest(&result["genesis_sha256"]) || !validator_address(&result["address"])
        || result["genesis_authority_verified"] != true || result["membership_verified"] != true
        || stage_receipt.is_some_and(|value| !lowercase_digest(value)) {
        return Err(UNSUPPORTED);
    }
    if bound {
        let enrollment = result["enrollment_json"].as_str()
            .filter(|value| (1..=128 * 1024).contains(&value.len())).ok_or(UNSUPPORTED)?;
        let enrollment_sha256 = format!("{:x}", Sha256::digest(enrollment.as_bytes()));
        if result["enrollment_sha256"] != enrollment_sha256 || !lowercase_digest(&result["request_sha256"]) {
            return Err(UNSUPPORTED);
        }
    }
    Ok(json!({"version":1,"ok":true,"result":{
        "schema":result["schema"],"network_id":result["network_id"],"chain_id":result["chain_id"],
        "genesis_sha256":result["genesis_sha256"],"genesis_authority_verified":true,
        "address":result["address"],"membership_verified":true,"bound":bound,
        "stage_receipt_verified":stage_receipt.is_some()
    }}))
}

fn custody_status_reply(operation: &str, reply: &Value) -> Result<Value, &'static str> {
    const UNSUPPORTED: &str = "The selected controller returned unsupported pending custody evidence.";
    if reply["ok"] != true {
        if reply["error"]["code"] == "reconciliation_required" {
            return Err("The controller could not verify pending custody. Preserve it and contact the node operator for reconciliation.");
        }
        return Err("The selected controller could not provide a pending custody status.");
    }
    let result = &reply["result"];
    let fields = result.as_object().ok_or(UNSUPPORTED)?;
    if result["pending"] == false && fields.len() == 1 {
        return Ok(json!({"version":1,"ok":true,"result":result}));
    }
    if result["pending"] != true || !validator_network_context(result) || !validator_address(&result["address"])
        || result["possession_verified"] != true || result["membership_granted"] != false {
        return Err(UNSUPPORTED);
    }
    let valid_kind = match operation {
        "identity_status" => fields.len() == 8 && result["genesis_authority_verified"] == true && lowercase_digest(&result["genesis_sha256"]),
        "formation_status" => fields.len() == 10 && result["schema"] == "nodenetwork-formation-v1"
            && ["formation_sha256", "formation_id", "request_sha256"].iter().all(|key| lowercase_digest(&result[*key]))
            && result["formation_id"].as_str().is_some_and(|id| id.bytes().any(|byte| byte != b'0')),
        _ => false,
    };
    if !valid_kind { return Err(UNSUPPORTED); }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn health_reply(reply: &Value) -> Result<Value, &'static str> {
    use std::collections::HashSet;
    const UNSUPPORTED: &str = "The selected controller returned unsupported service health evidence.";
    if reply["ok"] != true {
        return Err("The selected controller could not provide service health.");
    }
    let admin = &reply["result"];
    let request_id = admin["request_id"].as_str()
        .and_then(|id| id.strip_prefix("synergy-node-"))
        .and_then(|pair| pair.split_once('-'));
    if !reply.as_object().is_some_and(|fields| fields.len() == 3)
        || reply["version"] != 1
        || !admin.as_object().is_some_and(|fields| fields.len() == 4)
        || admin["schema_version"] != 1 || admin["ok"] != true
        || !request_id.is_some_and(|(pid, nanos)| {
            (1..=10).contains(&pid.len()) && pid.bytes().all(|byte| byte.is_ascii_digit())
                && (1..=39).contains(&nanos.len()) && nanos.bytes().all(|byte| byte.is_ascii_digit())
        })
        || !admin["result"].as_object().is_some_and(|fields| fields.len() == 1) {
        return Err(UNSUPPORTED);
    }
    let services = admin["result"]["services"].as_array()
        .filter(|services| services.len() <= 128).ok_or(UNSUPPORTED)?;
    let mut seen = HashSet::new();
    let mut observations = Vec::with_capacity(services.len());
    for service in services {
        if !service.as_object().is_some_and(|fields| fields.len() == 4) {
            return Err(UNSUPPORTED);
        }
        let id = service["id"].as_str().filter(|id| {
            (1..=64).contains(&id.len())
                && id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        }).ok_or(UNSUPPORTED)?;
        if !seen.insert(id) { return Err(UNSUPPORTED); }
        let state = service["state"].as_str().filter(|state| matches!(*state,
            "registered" | "starting" | "running" | "restarting" | "stopping" | "stopped" | "failed"
        )).ok_or(UNSUPPORTED)?;
        let health = if service["health"] == "healthy" {
            "healthy"
        } else {
            let health = service["health"].as_object().filter(|fields| fields.len() == 1).ok_or(UNSUPPORTED)?;
            let (kind, value) = health.iter().next().ok_or(UNSUPPORTED)?;
            if !matches!(kind.as_str(), "degraded" | "unhealthy")
                || !value.as_object().is_some_and(|fields| fields.len() == 1)
                || !value["reason"].is_string() {
                return Err(UNSUPPORTED);
            }
            kind.as_str()
        };
        let readiness = &service["readiness"];
        let field_count = readiness.as_object().map(|fields| fields.len());
        let readiness = match readiness["status"].as_str() {
            Some("ready") if field_count == Some(1) => "ready",
            Some(kind @ ("pending" | "blocked")) if field_count == Some(2) && readiness["reason"].is_string() => kind,
            _ => return Err(UNSUPPORTED),
        };
        observations.push(json!({"id":id,"state":state,"health":health,"readiness":readiness}));
    }
    Ok(json!({"version":1,"ok":true,"result":{"schema_version":1,"services":observations}}))
}

async fn execute_pinned(target: Target, request: Request, control_dir: &Path, known_hosts: Option<&Path>) -> Result<Value, String> {
    target.validate()?; request.validate()?;
    let _serial=SERIAL.lock().await;
    if !cfg!(unix) { return Err("This Portal platform has no qualified native controller transport.".into()); }
    let mut command = if target.kind=="local" {
        if !cfg!(all(target_os="linux",target_arch="x86_64")) { return Err("Local validators require Linux x86_64. Select an enrolled remote Linux target.".into()); }
        let mut c=tokio::process::Command::new("/usr/bin/sudo");
        c.args(["-n","/usr/bin/python3","-I","-B",CONTROLLER]); c
    } else {
        remote_command(&target,control_dir,"synergy-nodenetwork",
            "/usr/bin/sudo -n /usr/bin/python3 -I -B /opt/Synergy/tmp/controller/controller.py",known_hosts)?
    };
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=command.spawn().map_err(|_|"Controller could not start. Enroll the target and verify its SSH host identity first.")?;
    let mut input=child.stdin.take().ok_or("Controller input unavailable.")?;
    let mut output=child.stdout.take().ok_or("Controller output unavailable.")?.take(LIMIT+1);
    let result=tokio::time::timeout(Duration::from_secs(180),async {
        input.write_all(request.canonical().to_string().as_bytes()).await.map_err(|_|"Cannot send controller request.")?;
        input.write_all(b"\n").await.map_err(|_|"Cannot complete controller request.")?;
        drop(input);
        let mut bytes=Vec::new();
        output.read_to_end(&mut bytes).await.map_err(|_|"Cannot read controller response.")?;
        if bytes.len()>LIMIT as usize { return Err("Controller response exceeds safe limit."); }
        let status=child.wait().await.map_err(|_|"Controller did not finish.")?;
        if !status.success() { return Err("Controller connection failed. Check enrolled target, pinned SSH identity, agent authentication and restricted sudo policy."); }
        let value:Value=serde_json::from_slice(&bytes).map_err(|_|"Controller returned an invalid response.")?;
        if value["version"]!=1 || !value["ok"].is_boolean() { return Err("Unsupported controller response."); }
        match request.operation.as_str() {
            "health" => health_reply(&value),
            "diagnostics" => crate::node_diagnostics::reply(&value),
            "install_preflight" => install_preflight_reply(&request, &value),
            "vpn_status" => vpn_status_reply(&value),
            "identity_preflight" | "formation_preflight" => preparation_reply(&request.operation, &value),
            "genesis_binding_preflight" => genesis_binding_reply(&value),
            "identity_status" | "formation_status" => custody_status_reply(&request.operation, &value),
            _ => Ok(value),
        }
    }).await;
    match result { Ok(value)=>value.map_err(String::from), Err(_)=>Err("Controller timed out. The result is uncertain; inspect target state before retrying a mutation.".into()) }
}

#[cfg(test)] mod tests {
    use super::*;

    #[test] fn ssh_socket_budget_uses_short_operator_namespace(){
        let path=control_directory(Path::new("/Users/jhutzler")).unwrap();
        assert_eq!(path,Path::new("/Users/jhutzler/.synergy-portal/ssh"));
        assert!(path.join("0".repeat(24)).as_os_str().len()<=95);
        assert!(control_directory(Path::new("relative")).is_err());
        assert!(control_directory(&Path::new("/Users").join("x".repeat(80))).is_err());
    }
    #[test] fn renderer_cannot_select_commands_paths_or_unbounded_parameters() {
        for host in ["-oProxyCommand=bad","host;reboot","user@host","host/path","host:22","bad..host"] {
            assert!(Target{kind:"remote".into(),host:Some(host.into()),port:None,root:ROOT.into()}.validate().is_err());
        }
        let mut request=Request{version:1,operation:"start".into(),parameters:json!({"root":"/etc"})};
        assert!(request.validate().is_err());
        request.parameters=json!({}); assert_eq!(request.validate(),Ok(true));
        assert_eq!(request.approval_id(),"9887b763bee52b22d58471c0e0adc4a7753458601c2e23db52437e040cc3c084");
        request.operation="target".into(); assert_eq!(request.validate(),Ok(false));
        request.operation="shell".into(); assert!(request.validate().is_err());
    }
    fn health_fixture() -> Value {
        json!({"version":1,"ok":true,"result":{
            "schema_version":1,"request_id":"synergy-node-25-1731256289000000000","ok":true,"result":{"services":[
                {"id":"network","state":"running","health":{"degraded":{"reason":"fixture local details"}},
                 "readiness":{"status":"pending","reason":"fixture private path"}},
                {"id":"storage","state":"running","health":"healthy","readiness":{"status":"ready"}},
                {"id":"sync","state":"failed","health":{"unhealthy":{"reason":"fixture process details"}},
                 "readiness":{"status":"blocked","reason":"fixture failure details"}}
            ]}
        }})
    }
    #[test] fn health_is_an_empty_parameter_read() {
        let mut request = Request {version:1, operation:"health".into(), parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"admin_socket":"/other/path"});
        assert!(request.validate().is_err());
    }
    #[test] fn health_projects_owner_admin_service_enums_without_private_details() {
        let mut report = health_fixture();
        assert_eq!(health_reply(&report).unwrap(), json!({"version":1,"ok":true,"result":{"schema_version":1,"services":[
            {"id":"network","state":"running","health":"degraded","readiness":"pending"},
            {"id":"storage","state":"running","health":"healthy","readiness":"ready"},
            {"id":"sync","state":"failed","health":"unhealthy","readiness":"blocked"}
        ]}}));
        report["result"]["result"]["services"] = json!([]);
        assert_eq!(health_reply(&report).unwrap()["result"]["services"], json!([]));
        let refused = json!({"version":1,"ok":false,"error":{"message":"fixture private failure"}});
        assert_eq!(health_reply(&refused), Err("The selected controller could not provide service health."));
    }
    #[test] fn health_rejects_ambiguous_or_unversioned_replies() {
        for (path, data) in [
            ("/result/schema_version", json!(2)),
            ("/result/request_id", json!("private-request")),
            ("/result/ok", json!(false)),
            ("/result/result/services/0/id", json!("storage")),
            ("/result/result/services/0/id", json!("network\n")),
            ("/result/result/services/0/health", json!({"degraded":{"reason":0}})),
            ("/result/result/services/0/health", json!({"degraded":{"reason":"fixture","address":"private"}})),
            ("/result/result/services/0/readiness", json!({"status":"ready","reason":"fixture"})),
            ("/result/result/services/0/state", json!("unknown")),
            ("/result/result/services", json!(vec![Value::Null; 129])),
        ] {
            let mut report = health_fixture();
            *report.pointer_mut(path).unwrap() = data;
            assert_eq!(health_reply(&report), Err("The selected controller returned unsupported service health evidence."), "{path}");
        }
    }
    #[test] fn install_preflight_preserves_exact_read_and_rejects_unbound_reply() {
        let request = Request{version:1,operation:"install_preflight".into(),parameters:json!({
            "release_id":"fixture-release","manifest_sha256":"a".repeat(64),"network_id":"fixture-network",
            "chain_id":1266,"node_name":"fixture-validator"
        })};
        assert_eq!(request.validate(), Ok(false));
        let report = json!({"packageVerified":true,"release":"fixture-release","root":ROOT,
            "networkSelectionApproved":true,"genesisAuthorityVerified":false,"activationAuthorized":false});
        let wrap = |result| json!({"version":1,"ok":true,"result":result,"unexpected":"fixture"});
        let returned = install_preflight_reply(&request, &wrap(report.clone())).unwrap();
        assert_eq!(returned["result"],report);
        assert!(returned.get("unexpected").is_none());
        for (key, value) in [("release",json!("another-release")), ("root",json!("/opt/synergy")),
            ("packageVerified",json!(false)), ("networkSelectionApproved",json!(false)), ("genesisAuthorityVerified",json!(true)),
            ("activationAuthorized",json!(true)), ("unexpected",json!("fixture"))] {
            let mut altered = report.clone();
            altered[key] = value;
            assert!(install_preflight_reply(&request, &wrap(altered)).is_err(), "{key}");
        }
        assert!(install_preflight_reply(&request, &wrap(json!({}))).is_err());
        let refused = json!({"ok":false,"error":{"code":"qualification_required","message":"fixture detail excluded"}});
        assert_eq!(install_preflight_reply(&request,&refused),Err("The controller did not confirm package or network policy for this preflight."));
    }
    #[test] fn vpn_status_is_an_empty_parameter_read_and_enrollment_is_unavailable() {
        let mut request = Request{version:1,operation:"vpn_status".into(),parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"address":"fixture"});
        assert!(request.validate().is_err());
        request.operation = "vpn_enroll".into();
        request.parameters = json!({});
        assert!(request.validate().is_err());
    }
    #[test] fn vpn_status_validates_owner_shape_and_keeps_extra_reply_metadata_private() {
        let mut reply = json!({"version":1,"ok":true,"internal":"unreviewed fixture","result":{
            "schema":"nodenetwork-vpn-status-v1","service_registered":true,"enrollment_staged":false,
            "enrollment_recorded":true,"reconciliation_required":false,"server_bound":false,"connected":true,
            "overlay_address":"100.80.10.4/16"
        }});
        let projected = vpn_status_reply(&reply).unwrap();
        assert_eq!(projected["result"],reply["result"]);
        assert!(projected.get("internal").is_none());
        reply["result"]["overlay_address"] = json!("100.80.10.4/64");
        assert!(vpn_status_reply(&reply).is_err());
        reply["result"]["overlay_address"] = json!("fd00::4/64");
        assert!(vpn_status_reply(&reply).is_ok());
        reply["result"]["enrollment_recorded"] = json!(false);
        assert!(vpn_status_reply(&reply).is_err());
        reply["result"]["connected"] = json!(false);
        reply["result"]["overlay_address"] = Value::Null;
        reply["result"]["reconciliation_required"] = json!(true);
        assert!(vpn_status_reply(&reply).is_ok());
        reply["result"]["private_payload"] = json!("fixture");
        assert!(vpn_status_reply(&reply).is_err());
        assert_eq!(vpn_status_reply(&json!({"ok":false,"error":{"message":"private fixture"}})), Err("The selected controller could not provide VPN status."));
    }
    #[test] fn custody_status_admits_only_the_empty_parameter_reads() {
        for operation in ["identity_status", "formation_status"] {
            let mut request = Request{version:1,operation:operation.into(),parameters:json!({})};
            assert_eq!(request.validate(), Ok(false));
            request.parameters = json!({"path":"fixture"});
            assert!(request.validate().is_err());
        }
        for operation in ["identity_generate", "formation_prepare", "formation_export", "genesis_bind"] {
            let request = Request{version:1,operation:operation.into(),parameters:json!({})};
            assert!(request.validate().is_err());
        }
    }
    #[test] fn custody_status_keeps_pending_identity_and_formation_contracts_distinct() {
        let mut reply = json!({"version":1,"ok":true,"internal":"unreviewed fixture","result":{
            "pending":true,"network_id":"fixture-network","chain_id":"18446744073709551615",
            "genesis_sha256":"a".repeat(64),"genesis_authority_verified":true,"address":"synv1".to_string()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false
        }});
        let identity = custody_status_reply("identity_status", &reply).unwrap();
        assert!(identity.get("internal").is_none());
        assert!(custody_status_reply("formation_status", &reply).is_err());
        reply["result"]["membership_granted"] = json!(true);
        assert!(custody_status_reply("identity_status", &reply).is_err());
        reply["result"]["membership_granted"] = json!(false);
        reply["result"]["private_payload"] = json!("fixture");
        assert!(custody_status_reply("identity_status", &reply).is_err());
        reply["result"] = json!({"pending":true,"network_id":"fixture-network","chain_id":"1266",
            "schema":"nodenetwork-formation-v1","formation_sha256":"a".repeat(64),"formation_id":"b".repeat(64),
            "request_sha256":"c".repeat(64),"address":"synv1".to_string()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false});
        assert!(custody_status_reply("formation_status", &reply).is_ok());
        assert!(custody_status_reply("identity_status", &reply).is_err());
        reply["result"]["chain_id"] = json!("18446744073709551616");
        assert!(custody_status_reply("formation_status", &reply).is_err());
        reply["result"] = json!({"pending":false});
        assert!(custody_status_reply("identity_status", &reply).is_ok());
        assert!(custody_status_reply("formation_status", &reply).is_ok());
        assert!(custody_status_reply("identity_status", &json!({"ok":false,"error":{"code":"reconciliation_required","message":"private fixture"}}))
            .unwrap_err().contains("Preserve it"));
    }
    #[test] fn preparation_reads_are_independent_empty_parameter_operations() {
        for operation in ["identity_preflight", "formation_preflight"] {
            let mut request = Request {version:1, operation:operation.into(), parameters:json!({})};
            assert_eq!(request.validate(), Ok(false));
            request.parameters = json!({"genesis_sha256":"a".repeat(64)});
            assert!(request.validate().is_err());
        }
        for operation in ["identity_generate", "formation_prepare", "genesis_stage", "genesis_bind"] {
            let request = Request {version:1, operation:operation.into(), parameters:json!({})};
            assert!(request.validate().is_err());
        }
    }
    #[test] fn preparation_reply_separates_exact_genesis_and_formation_evidence() {
        let identity = json!({"version":1,"ok":true,"result":{
            "network_id":"fixture-network","chain_id":"18446744073709551615",
            "genesis_sha256":"a".repeat(64),"genesis_authority_verified":true}});
        let formation = json!({"version":1,"ok":true,"result":{
            "schema":"nodenetwork-formation-v1","network_id":"fixture-network","chain_id":"1266",
            "formation_sha256":"b".repeat(64),"formation_id":"c".repeat(64)}});
        assert_eq!(preparation_reply("identity_preflight", &identity), Ok(identity.clone()));
        assert_eq!(preparation_reply("formation_preflight", &formation), Ok(formation.clone()));
        assert!(preparation_reply("identity_preflight", &formation).is_err());
        assert!(preparation_reply("formation_preflight", &identity).is_err());
        for (source,operation,path,data) in [
            (&identity,"identity_preflight","/result/chain_id",json!("18446744073709551616")),
            (&identity,"identity_preflight","/result/chain_id",json!("1266\n")),
            (&identity,"identity_preflight","/result/genesis_authority_verified",json!(false)),
            (&identity,"identity_preflight","/result/network_id",json!("private/path")),
            (&formation,"formation_preflight","/result/formation_id",json!("0".repeat(64))),
            (&formation,"formation_preflight","/result/formation_sha256",json!("fixture path")),
        ] {
            let mut changed = source.clone();
            *changed.pointer_mut(path).unwrap() = data;
            assert!(preparation_reply(operation, &changed).is_err(), "{path}");
        }
        let mut changed = identity;
        changed["result"]["private_metadata"] = json!("fixture");
        assert!(preparation_reply("identity_preflight", &changed).is_err());
    }
    #[test] fn preparation_refuses_with_fixed_guidance_without_host_details() {
        for (code,guidance) in [
            ("authorization_required", "Review the required pins"),
            ("operation_refused", "Review the staged inputs"),
        ] {
            let reply = json!({"version":1,"ok":false,"error":{"code":code,"message":"private fixture"}});
            let error = preparation_reply("identity_preflight", &reply).unwrap_err();
            assert!(error.contains(guidance));
            assert!(!error.contains("private fixture"));
        }
    }
    fn genesis_binding_fixture(bound: bool) -> Value {
        let mut value = json!({"version":1,"ok":true,"result":{
            "schema":"nodenetwork-genesis-binding-v1","network_id":"fixture-network","chain_id":"18446744073709551615",
            "genesis_sha256":"a".repeat(64),"genesis_authority_verified":true,
            "address":"synv1".to_string()+&"a".repeat(36),"membership_verified":true,"bound":bound
        }});
        if bound {
            let artifact = r#"{"name":"local synthetic fixture"}"#;
            value["result"]["enrollment_json"] = json!(artifact);
            value["result"]["enrollment_sha256"] = json!(format!("{:x}", Sha256::digest(artifact.as_bytes())));
            value["result"]["request_sha256"] = json!("b".repeat(64));
        }
        value
    }
    #[test] fn genesis_binding_preflight_is_a_fixed_read() {
        let mut request = Request {version:1, operation:"genesis_binding_preflight".into(), parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"genesis_sha256":"a".repeat(64)});
        assert!(request.validate().is_err());
        request.operation = "genesis_bind".into();
        assert!(request.validate().is_err());
    }
    #[test] fn genesis_binding_projects_both_scopes_and_omits_enrollment_and_request_fingerprints() {
        let unbound = genesis_binding_reply(&genesis_binding_fixture(false)).unwrap();
        assert_eq!(unbound["result"]["bound"], json!(false));
        assert_eq!(unbound["result"]["stage_receipt_verified"], json!(false));
        let mut fixture = genesis_binding_fixture(true);
        fixture["result"]["stage_request_sha256"] = json!("c".repeat(64));
        let bound = genesis_binding_reply(&fixture).unwrap();
        assert_eq!(bound["result"]["bound"], json!(true));
        assert_eq!(bound["result"]["stage_receipt_verified"], json!(true));
        assert_eq!(bound["result"]["chain_id"], json!("18446744073709551615"));
        for omitted in ["enrollment_json","enrollment_sha256","request_sha256","stage_request_sha256"] {
            assert!(bound["result"].get(omitted).is_none(), "{omitted}");
        }
    }
    #[test] fn genesis_binding_rejects_ambiguous_scope_artifact_and_receipt() {
        for (fixture,path,data) in [
            (genesis_binding_fixture(false),"membership_verified",json!(false)),
            (genesis_binding_fixture(false),"genesis_authority_verified",json!(false)),
            (genesis_binding_fixture(false),"stage_request_sha256",Value::Null),
            (genesis_binding_fixture(false),"request_sha256",json!("b".repeat(64))),
            (genesis_binding_fixture(false),"address",json!("synv1ffffffffffff\n")),
            (genesis_binding_fixture(true),"enrollment_json",json!("tampered")),
            (genesis_binding_fixture(true),"enrollment_json",json!("é".repeat(65_537))),
            (genesis_binding_fixture(true),"request_sha256",Value::Null),
            (genesis_binding_fixture(true),"bound",json!(false)),
        ] {
            let mut changed = fixture;
            changed["result"][path] = data;
            assert!(genesis_binding_reply(&changed).is_err(), "{path}");
        }
        let refused = json!({"version":1,"ok":false,"error":{"code":"reconciliation_required","message":"fixture secret"}});
        let guidance = genesis_binding_reply(&refused).unwrap_err();
        assert!(guidance.contains("Preserve the existing custody"));
        assert!(!guidance.contains("fixture secret"));
    }
    #[test]
    #[ignore = "Requires an explicitly enrolled disposable Linux VM and its authenticated SSH host pin"]
    fn disposable_headless_bridge_checks_pin_before_reading_target() {
        let target:Target=serde_json::from_str(&std::env::var("NODENETWORK_TEST_TARGET").expect("explicit disposable target JSON required")).unwrap();
        assert_eq!(target.kind,"remote"); target.validate().unwrap();
        let pin=std::path::PathBuf::from(std::env::var_os("NODENETWORK_TEST_KNOWN_HOSTS").expect("authenticated disposable host pin required"));
        let base=if cfg!(target_os="macos"){std::path::PathBuf::from("/private/tmp")}else{std::env::temp_dir().canonicalize().unwrap()};
        let root=base.join(format!("nn-bridge-{}",std::process::id()));
        assert!(!root.exists(),"test scratch already exists");
        std::fs::create_dir(&root).unwrap();
        let bad_pin=root.join("wrong-known-hosts");
        let host=target.host.clone().unwrap();
        let port=target.port.unwrap_or(22);
        let host_field=if target.port.unwrap_or(22)==22 {host.to_string()} else {format!("[{}]:{}",host.trim_matches(['[',']']),target.port.unwrap())};
        std::fs::write(&bad_pin,format!("{} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n",host_field)).unwrap();
        let connection=root.join("ssh");
        let socket=connection.join(format!("{:x}",Sha256::digest(format!("{}:{}",host,port).as_bytes()))[..24].to_string());
        struct Cleanup {root:std::path::PathBuf,socket:std::path::PathBuf,host:String}
        impl Drop for Cleanup {fn drop(&mut self){
            let _=std::process::Command::new("/usr/bin/ssh").arg("-S").arg(&self.socket).args(["-O","exit","--",&self.host]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            let _=std::fs::remove_dir_all(&self.root);
        }}
        let _cleanup=Cleanup{root:root.clone(),socket,host:host.clone()};
        tauri::async_runtime::block_on(async {
            let request=||Request{version:1,operation:"target".into(),parameters:json!({})};
            let wrong=Target{kind:target.kind.clone(),host:target.host.clone(),port:target.port,root:target.root.clone()};
            assert!(execute_pinned(wrong,request(),&connection,Some(&bad_pin)).await.is_err(),"wrong host pin must fail before receiving target state");
            let result=execute_pinned(target,request(),&connection,Some(&pin)).await.unwrap();
            assert_eq!(result["ok"],true);
            assert_eq!(result["result"]["root"],ROOT);
            assert_eq!(result["result"]["communityEnrollment"],false);
        });
    }
    #[test] fn approved_requests_are_exact_and_network_bound() {
        let mut request=Request{version:1,operation:"install_preflight".into(),parameters:json!({"release_id":"r5","manifest_sha256":"a".repeat(64),"network_id":"canary-1","chain_id":99999,"node_name":"validator-test"})};
        assert_eq!(request.validate(),Ok(false));
        let pin=request.approval_id(); request.parameters["chain_id"]=json!(100000);
        assert_ne!(pin,request.approval_id());
        assert_eq!(serde_json::from_value::<Request>(json!({"version":1,"operation":"start","parameters":{},"shell":"reboot"})).is_err(),true);
    }
}
