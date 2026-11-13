//! Typed operational bridge. Host policy, custody and consensus authority stay on target.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ROOT: &str = "/opt/synergy";
const CONTROLLER: &str = "/opt/synergy/tmp/controller/controller.py";
const LIMIT: u64 = 1_000_000;
const REQUEST_LIMIT: usize = 16_384;
pub(super) static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Debug, Deserialize)]
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
        if self.root != ROOT { return Err("Validator root must be /opt/synergy.".into()); }
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
            "target"|"inventory"|"health"|"install_preflight"|"upgrade_preflight"|"recovery_preflight"|"uninstall_preflight"|"vpn_status"|"diagnostics"|"identity_preflight"|"identity_status"|"formation_preflight"|"formation_status"|"formation_export"|"genesis_binding_preflight"|"genesis_stage_preflight" => false,
            "install"|"commission"|"register"|"start"|"stop"|"restart"|"upgrade"|"uninstall"|"vpn_enroll"|"identity_generate"|"formation_prepare"|"genesis_bind"|"genesis_stage" => true,
            _ => return Err("Unsupported NodeNetwork controller operation.".into()),
        };
        let expected: &[&str] = match self.operation.as_str() {
            "install"|"install_preflight" => &["release_id","manifest_sha256","network_id","chain_id","node_name"],
            "upgrade"|"upgrade_preflight" => &["release_id","manifest_sha256"],
            "uninstall" => &["confirmation"],
            "identity_generate"|"genesis_bind" => &["genesis_sha256"],
            "formation_prepare" => &["formation_sha256"],
            "genesis_stage" => &["artifacts"],
            _ => &[],
        };
        if p.len() != expected.len() || expected.iter().any(|k| !p.contains_key(*k)) {
            return Err("Unexpected controller parameters; paths, secrets and shell commands are forbidden.".into());
        }
        if self.operation=="genesis_stage" { crate::formation::stage_artifacts(&p["artifacts"])?; }
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
        for (field, error) in [
            ("genesis_sha256", "Review the exact authenticated Genesis before binding custody."),
            ("formation_sha256", "Review the exact approved network formation before preparing custody."),
        ] {
            if expected.contains(&field) && !p[field].as_str().is_some_and(|pin|
                pin.len()==64 && pin.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))) {
                return Err(error.into());
            }
        }
        Ok(mutation)
    }
    pub fn canonical(&self) -> Value {
        let mut value=json!({"version":self.version,"operation":self.operation,"parameters":self.parameters});
        value.sort_all_objects();
        value
    }
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

fn control_socket(target:&Target,directory:&Path,account:&str)->std::path::PathBuf {
    directory.join(format!("{:x}",Sha256::digest(format!("{account}@{}:{}",target.host.as_deref().unwrap_or(""),target.port.unwrap_or(22)).as_bytes()))[..24].to_string())
}
pub(super) fn remote_command(target:&Target,directory:&Path,account:&str,remote:&str,known_hosts:Option<&Path>)->Result<tokio::process::Command,String>{
    target.validate()?;
    #[cfg(unix)] ensure_private_control_dir(directory)?;
    let socket=control_socket(target,directory,account);
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
pub(super) async fn close_connection(target:&Target,directory:&Path,account:&str){
    if target.kind!="remote" {return;}
    let _=tokio::time::timeout(Duration::from_secs(5),tokio::process::Command::new("/usr/bin/ssh")
        .args(["-F","/dev/null","-S"]).arg(control_socket(target,directory,account))
        .args(["-O","exit","--"]).arg(target.host.as_deref().unwrap_or("")).stdout(Stdio::null()).stderr(Stdio::null()).status()).await;
}

pub async fn execute(target: Target, request: Request, control_dir: &Path) -> Result<Value, String> {
    execute_pinned(target,request,control_dir,None).await
}

async fn execute_pinned(target: Target, request: Request, control_dir: &Path, known_hosts: Option<&Path>) -> Result<Value, String> {
    target.validate()?; request.validate()?;
    let mut wire=request.canonical().to_string().into_bytes();
    let input_limit=if request.operation=="genesis_stage" {12*1024*1024} else {REQUEST_LIMIT};
    if wire.len()>=input_limit { return Err("Controller request exceeds the operation's safe wire limit.".into()); }
    wire.push(b'\n');
    let _serial=SERIAL.lock().await;
    if !cfg!(unix) { return Err("This Portal platform has no qualified native controller transport.".into()); }
    let mut command = if target.kind=="local" {
        if !cfg!(all(target_os="linux",target_arch="x86_64")) { return Err("Local validators require Linux x86_64. Select an enrolled remote Linux target.".into()); }
        let mut c=tokio::process::Command::new("/usr/bin/sudo");
        c.args(["-n","/usr/bin/python3","-I","-B",CONTROLLER]); c
    } else {
        remote_command(&target,control_dir,"synergy-nodenetwork",
            "/usr/bin/sudo -n /usr/bin/python3 -I -B /opt/synergy/tmp/controller/controller.py",known_hosts)?
    };
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=command.spawn().map_err(|_|"Controller could not start. Enroll the target and verify its SSH host identity first.")?;
    let mut input=child.stdin.take().ok_or("Controller input unavailable.")?;
    let mut output=child.stdout.take().ok_or("Controller output unavailable.")?.take(LIMIT+1);
    let result=tokio::time::timeout(Duration::from_secs(if request.operation=="vpn_enroll" {240} else {180}),async {
        input.write_all(&wire).await.map_err(|_|"Cannot send controller request.")?;
        drop(input);
        let mut bytes=Vec::new();
        output.read_to_end(&mut bytes).await.map_err(|_|"Cannot read controller response.")?;
        if bytes.len()>LIMIT as usize { return Err("Controller response exceeds safe limit."); }
        let status=child.wait().await.map_err(|_|"Controller did not finish.")?;
        if !status.success() { return Err("Controller connection failed. Check enrolled target, pinned SSH identity, agent authentication and restricted sudo policy."); }
        let value:Value=serde_json::from_slice(&bytes).map_err(|_|"Controller returned an invalid response.")?;
        if value["version"]!=1 || !value["ok"].is_boolean() { return Err("Unsupported controller response."); }
        Ok(value)
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
    #[test] fn bootstrap_and_controller_never_share_the_same_ssh_master() {
        let target=Target{kind:"remote".into(),host:Some("host.example".into()),port:None,root:ROOT.into()};
        let path=Path::new("/tmp/short");
        assert_ne!(control_socket(&target,path,"operator"),control_socket(&target,path,"synergy-nodenetwork"));
    }
    #[test] fn vpn_enrollment_never_accepts_credentials_from_the_renderer() {
        let mut request=Request{version:1,operation:"vpn_enroll".into(),parameters:json!({})};
        assert_eq!(request.validate(),Ok(true));
        request.parameters=json!({"setup_key":"never accepted"});
        assert!(request.validate().is_err());
        request.operation="vpn_status".into();
        assert!(request.validate().is_err());
        request.parameters=json!({});
        assert_eq!(request.validate(),Ok(false));
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
