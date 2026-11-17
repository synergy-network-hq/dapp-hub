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
pub struct Target { pub kind: String, pub host: Option<String>, pub port: Option<u16>, pub root: String, #[serde(default)] pub guest: Option<crate::managed_guest::GuestBinding> }

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
        if let Some(guest)=&self.guest {if self.kind!="remote"{return Err("Managed guests require an authenticated physical host".into())}guest.validate()?;}
        match self.kind.as_str() {
            "local" if self.host.is_none() && self.port.is_none() => Ok(()),
            "remote" if self.host.as_deref().is_some_and(host_name) && self.port.is_none_or(|p| p>0) => Ok(()),
            _ => Err("Choose this machine or an enrolled remote hostname without credentials or commands.".into()),
        }
    }
    pub fn label(&self) -> String {
        if let Some(g)=&self.guest{return format!("Managed guest {} via {} · SSH port {}",g.guest_id,self.host.as_deref().unwrap_or("Unavailable"),self.port.unwrap_or(22))}
        if self.kind == "local" { "Local · this machine".into() }
        else { format!("Remote · {} · SSH port {}", self.host.as_deref().unwrap_or("Unavailable"), self.port.unwrap_or(22)) }
    }
    pub fn journal_identity(&self) -> Value {
        let mut value=json!({"kind":self.kind,"host":self.host.as_ref().map(|h|h.to_ascii_lowercase()),"port":if self.kind=="remote" {Some(self.port.unwrap_or(22))} else {None},"root":self.root});
        if let Some(guest)=&self.guest{value["guest"]=serde_json::to_value(guest).expect("public guest binding serialization");}value
    }
}
impl Request {
    pub fn validate(&self) -> Result<bool, String> {
        if self.version != 1 { return Err("Unsupported controller protocol.".into()); }
        let p = self.parameters.as_object().ok_or("Controller parameters must be an object.")?;
        let mutation = match self.operation.as_str() {
            "target"|"inventory"|"health"|"install_preflight"|"upgrade_preflight"|"recovery_preflight"|"uninstall_preflight"|"vpn_status"|"diagnostics"|"identity_preflight"|"identity_status"|"formation_preflight"|"formation_status"|"formation_export"|"genesis_binding_preflight"|"genesis_stage_preflight"|"authorization_status"|"network_formation_status"|"network_formation_export"|"network_transport_status"|"network_transport_export"|"guest_status"|"guest_preflight" => false,
            "install"|"commission"|"register"|"start"|"stop"|"restart"|"upgrade"|"uninstall"|"vpn_enroll"|"vpn_bind"|"vpn_retire"|"identity_generate"|"formation_prepare"|"genesis_bind"|"genesis_stage"|"network_formation_prepare"|"network_formation_sign"|"network_transport_prepare"|"network_transport_sign"|"guest_create"|"guest_stop"|"guest_remove" => true,
            _ => return Err("Unsupported NodeNetwork controller operation.".into()),
        };
        let expected: &[&str] = match self.operation.as_str() {
            "install"|"install_preflight" => &["release_id","manifest_sha256","network_id","chain_id","node_name"],
            "upgrade"|"upgrade_preflight" => &["release_id","manifest_sha256"],
            "uninstall" => &["confirmation"],
            "identity_generate"|"genesis_bind" => &["genesis_sha256"],
            "formation_prepare" => &["formation_sha256"],
            "genesis_stage" => &["artifacts"],
            "network_formation_prepare" => &["formation_sha256","recipe_json","registrations_json"],
            "network_formation_sign" => &["review_sha256"],
            "network_transport_prepare" => &["formation_sha256","genesis_review_sha256","target_provider_report_sha256","valid_from_unix","expires_at_unix","members"],
            "network_transport_sign" => &["review_sha256"],
            "guest_status"|"guest_preflight"|"guest_stop"|"guest_remove" => &["guest_id"],
            "guest_create" => &["guest_id","image_sha256","cpu_count","memory_mib","disk_gib"],
            _ => &[],
        };
        if p.len() != expected.len() || expected.iter().any(|k| !p.contains_key(*k)) {
            return Err("Unexpected controller parameters; paths, secrets and shell commands are forbidden.".into());
        }
        if self.operation.starts_with("guest_") {
            let id=p["guest_id"].as_str().ok_or("Guest ID required")?;
            if id.is_empty()||id.len()>32||!id.as_bytes()[0].is_ascii_lowercase()||!id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-'){return Err("Invalid guest ID".into())}
            if self.operation=="guest_create" {
                if !p["image_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("Pinned guest image required".into())}
                for (key,lo,hi)in[("cpu_count",1,32),("memory_mib",1024,65536),("disk_gib",8,512)]{if !p[key].as_u64().is_some_and(|n|(lo..=hi).contains(&n)){return Err("Guest resources outside approved bounds".into())}}
            }
        }
        if self.operation=="network_formation_prepare" && (!p["recipe_json"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=1024*1024)||!p["registrations_json"].as_array().is_some_and(|a|a.len()==5&&a.iter().all(|v|v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128*1024)))){return Err("Bounded public recipe and five registrations required".into())}
        if self.operation=="network_transport_prepare"{
            let members=p["members"].as_array().filter(|a|a.len()==5).ok_or("Five public transport members required")?;
            let from=p["valid_from_unix"].as_u64().ok_or("Invalid transport validity")?;let until=p["expires_at_unix"].as_u64().ok_or("Invalid transport expiration")?;
            if until<=from||until-from>7*86400{return Err("Transport validity must fit the engineering seven-day bound".into())}
            for member in members{
                let m=member.as_object().filter(|m|m.len()==4).ok_or("Invalid transport member fields")?;
                for (field,limit)in[("enrollment_json",128*1024),("configuration_json",64*1024),("dial_address",128),("transport_key_id",128)]{if !m.get(field).and_then(Value::as_str).is_some_and(|s|!s.is_empty()&&s.len()<=limit){return Err("Missing or oversized public transport member".into())}}
                m["dial_address"].as_str().unwrap().parse::<std::net::SocketAddr>().map_err(|_|"Transport endpoint must be a literal socket address")?;
            }
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
            ("review_sha256", "Review the exact unsigned Genesis before signing."),
            ("formation_sha256", "Review the exact approved network formation before preparing custody."),
            ("genesis_review_sha256", "Review the exact signed Genesis before transport issuance."),
            ("target_provider_report_sha256", "Use the independently authenticated installed APQE provider."),
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
pub(super) fn protect_control_directory(directory: &Path) -> Result<(), String> {
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

pub(super) fn control_socket(target:&Target,directory:&Path,account:&str)->std::path::PathBuf {
    let mut identity=format!("{account}@{}:{}",target.host.as_deref().unwrap_or(""),target.port.unwrap_or(22));
    if let Some(g)=&target.guest{identity.push_str(&serde_json::to_string(g).expect("public guest binding serialization"));}
    directory.join(&format!("{:x}",Sha256::digest(identity.as_bytes()))[..24])
}
fn qualification_host_pin(directory:&Path,pin:&str)->Result<std::path::PathBuf,String>{
    let expected=format!("{}\n",pin.trim());
    let path=directory.join(format!("isolated-qualification-{:x}.known-hosts",Sha256::digest(expected.as_bytes())));
    if path.exists()||path.is_symlink(){
        let metadata=std::fs::symlink_metadata(&path).map_err(|_|"Cannot inspect isolated host pin.")?;
        if !metadata.is_file()||metadata.len()>2048||std::fs::read(&path).map_err(|_|"Cannot inspect isolated host pin.")?!=expected.as_bytes(){return Err("Isolated host pin differs from the independently compiled test authority.".into());}
    }else{
        use std::io::Write;
        let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);
        #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
        options.open(&path).map_err(|_|"Cannot create isolated host pin.")?.write_all(expected.as_bytes()).map_err(|_|"Cannot record isolated host pin.")?;
    }
    Ok(path)
}
pub(super) fn remote_command(target:&Target,directory:&Path,account:&str,remote:&str,known_hosts:Option<&Path>)->Result<tokio::process::Command,String>{
    target.validate()?;
    if target.guest.is_some(){return crate::managed_guest::remote_command(target,directory,account,remote)}
    #[cfg(unix)] protect_control_directory(directory)?;
    let socket=control_socket(target,directory,account);
    if socket.as_os_str().len()>95 {return Err("Portal SSH control path is too long on this platform.".into());}
    let qualification_pin=if known_hosts.is_none()&&cfg!(debug_assertions)&&target.host.as_deref()==Some("127.0.0.1")&&target.port==Some(22280){
        if let Some(pin)=option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"){
            Some(qualification_host_pin(directory,pin)?)
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

pub(super) async fn close_connection_checked(target:&Target,directory:&Path,account:&str)->Result<(),String>{
    close_connection(target,directory,account).await;
    if target.kind!="remote"{return Ok(())}
    let result=tokio::time::timeout(Duration::from_secs(5),tokio::process::Command::new("/usr/bin/ssh")
        .args(["-F","/dev/null","-S"]).arg(control_socket(target,directory,account))
        .args(["-O","check","--"]).arg(target.host.as_deref().unwrap_or("")).stdout(Stdio::null()).stderr(Stdio::null()).status()).await;
    match result {Ok(Ok(status)) if !status.success()=>Ok(()),_=>Err("Existing SSH master has not closed; administrative recovery refused".into())}
}

pub async fn execute(target: Target, request: Request, control_dir: &Path) -> Result<Value, String> {
    execute_pinned(target,request,control_dir,None).await
}

pub(super) async fn execute_pinned(target: Target, request: Request, control_dir: &Path, known_hosts: Option<&Path>) -> Result<Value, String> {
    target.validate()?; request.validate()?;
    let mut wire=request.canonical().to_string().into_bytes();
    let input_limit=if request.operation=="genesis_stage" {12*1024*1024} else if matches!(request.operation.as_str(),"network_formation_prepare"|"network_transport_prepare") {2*1024*1024} else {REQUEST_LIMIT};
    let output_limit=if request.operation=="network_transport_export" {4*1024*1024+16384} else if request.operation=="network_formation_export" {2*1024*1024} else {LIMIT};
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
    let mut output=child.stdout.take().ok_or("Controller output unavailable.")?.take(output_limit+1);
    let result=tokio::time::timeout(Duration::from_secs(if request.operation=="vpn_enroll" {240} else {180}),async {
        input.write_all(&wire).await.map_err(|_|"Cannot send controller request.")?;
        drop(input);
        let mut bytes=Vec::new();
        output.read_to_end(&mut bytes).await.map_err(|_|"Cannot read controller response.")?;
        if bytes.len()>output_limit as usize { return Err("Controller response exceeds safe limit."); }
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

    #[test] fn isolated_host_pins_are_scoped_to_the_compiled_identity_and_reject_tampering(){
        let root=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-host-pin-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(root.clone());
        std::fs::create_dir(&root).unwrap();
        let retired=root.join("isolated-qualification-known-hosts");std::fs::write(&retired,b"retired guest pin\n").unwrap();
        let first=qualification_host_pin(&root,"[127.0.0.1]:22280 ssh-ed25519 first").unwrap();
        let second=qualification_host_pin(&root,"[127.0.0.1]:22280 ssh-ed25519 second").unwrap();
        assert_ne!(first,second);assert_eq!(qualification_host_pin(&root,"[127.0.0.1]:22280 ssh-ed25519 second\n").unwrap(),second);
        assert_eq!(std::fs::read(retired).unwrap(),b"retired guest pin\n");
        std::fs::write(&second,b"altered pin\n").unwrap();
        assert!(qualification_host_pin(&root,"[127.0.0.1]:22280 ssh-ed25519 second").is_err());
        #[cfg(unix)]{std::fs::remove_file(&second).unwrap();std::os::unix::fs::symlink(&first,&second).unwrap();assert!(qualification_host_pin(&root,"[127.0.0.1]:22280 ssh-ed25519 second").is_err());}
    }
    #[test] fn ssh_socket_budget_uses_short_operator_namespace(){
        let path=control_directory(Path::new("/Users/jhutzler")).unwrap();
        assert_eq!(path,Path::new("/Users/jhutzler/.synergy-portal/ssh"));
        assert!(path.join("0".repeat(24)).as_os_str().len()<=95);
        assert!(control_directory(Path::new("relative")).is_err());
        assert!(control_directory(&Path::new("/Users").join("x".repeat(80))).is_err());
    }
    #[test] fn bootstrap_and_controller_never_share_the_same_ssh_master() {
        let target=Target{kind:"remote".into(),host:Some("host.example".into()),port:None,root:ROOT.into(),guest:None};
        let path=Path::new("/tmp/short");
        assert_ne!(control_socket(&target,path,"operator"),control_socket(&target,path,"synergy-nodenetwork"));
    }
    #[test] fn guest_requests_require_exact_pinned_resources_and_no_host_paths() {
        let mut r=Request{version:1,operation:"guest_create".into(),parameters:json!({"guest_id":"validator-a","image_sha256":"a".repeat(64),"cpu_count":2,"memory_mib":2048,"disk_gib":16})};
        assert_eq!(r.validate(),Ok(true));
        for (key,bad)in[("guest_id",json!("../guest")),("image_sha256",json!("A".repeat(64))),("cpu_count",json!(0)),("memory_mib",json!(65537)),("disk_gib",json!(513))] {
            let old=r.parameters[key].clone();r.parameters[key]=bad;assert!(r.validate().is_err());r.parameters[key]=old;
        }
        r.parameters["image_path"]=json!("/tmp/untrusted");assert!(r.validate().is_err());
        for operation in ["guest_status","guest_preflight","guest_stop","guest_remove"] {
            r.operation=operation.into();r.parameters=json!({"guest_id":"validator-a"});assert_eq!(r.validate(),Ok(matches!(operation,"guest_stop"|"guest_remove")));
            r.parameters["ssh_host"]=json!("localhost");assert!(r.validate().is_err());
        }
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
            assert!(Target{kind:"remote".into(),host:Some(host.into()),port:None,root:ROOT.into(),guest:None}.validate().is_err());
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
        let socket=connection.join(&format!("{:x}",Sha256::digest(format!("{}:{}",host,port).as_bytes()))[..24]);
        struct Cleanup {root:std::path::PathBuf,socket:std::path::PathBuf,host:String}
        impl Drop for Cleanup {fn drop(&mut self){
            let _=std::process::Command::new("/usr/bin/ssh").arg("-S").arg(&self.socket).args(["-O","exit","--",&self.host]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            let _=std::fs::remove_dir_all(&self.root);
        }}
        let _cleanup=Cleanup{root:root.clone(),socket,host:host.clone()};
        tauri::async_runtime::block_on(async {
            let request=||Request{version:1,operation:"target".into(),parameters:json!({})};
            let wrong=Target{kind:target.kind.clone(),host:target.host.clone(),port:target.port,root:target.root.clone(),guest:target.guest.clone()};
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
        assert!(serde_json::from_value::<Request>(json!({"version":1,"operation":"start","parameters":{},"shell":"reboot"})).is_err());
    }
}
