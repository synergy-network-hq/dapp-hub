//! Typed operational bridge. Host policy, custody and consensus authority stay on target.
use serde::{de, Deserialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ROOT: &str = "/opt/synergy";
const CONTROLLER: &str = "/opt/synergy/tmp/controller/controller.py";
const LIMIT: u64 = 1_000_000;
const REQUEST_LIMIT: usize = 16_384;
const IDENTITY_GENERATION_UNCERTAIN: &str = "Validator identity preparation outcome is uncertain. Preserve pending custody and read its status before another change.";
const FORMATION_PREPARATION_UNCERTAIN: &str = "Formation preparation outcome is uncertain. Preserve pending custody and read its status before another change.";
pub(super) const GENESIS_STAGE_WIRE_LIMIT: usize = 12 * 1024 * 1024;
pub(super) const GENESIS_BIND_UNCERTAIN: &str = "Genesis binding outcome is uncertain. Preserve pending custody and review its binding status before another change.";
pub(super) const COMMISSION_UNCERTAIN: &str = "Validator commissioning outcome is uncertain. Inspect the selected target and its request history before another change.";
pub(super) const NODE_SERVICE_UNCERTAIN: &str = "Node service action outcome is uncertain. Inspect the selected controller before another change.";
pub(super) const REGISTER_UNCERTAIN: &str = "Service registration outcome is uncertain. Inspect the selected target before another change.";
#[cfg(test)]
pub(super) const VPN_ENROLLMENT_UNCERTAIN: &str = "VPN enrollment outcome is uncertain. Check the enrolled controller and reconcile the prior request before further changes.";
pub(super) const UPGRADE_UNCERTAIN: &str = "Software upgrade outcome is uncertain. Review the selected installation and its pending upgrade evidence before another change.";
pub(super) static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target { pub kind: String, pub host: Option<String>, pub port: Option<u16>, pub root: String, #[serde(default)] pub guest: Option<crate::managed_guest::GuestBinding> }

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request { pub version: u8, pub operation: String, pub parameters: Value }

#[cfg(test)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustodyPreparationReview {
    network_id: String,
    chain_id: String,
    formation_id: Option<String>,
}

#[cfg(test)]
impl CustodyPreparationReview {
    pub(super) fn for_request(request: &Request, review: Option<Self>) -> Result<Option<Self>, String> {
        if !matches!(request.operation.as_str(), "identity_generate" | "formation_prepare") {
            return if review.is_none() { Ok(None) } else { Err("Custody preparation review is only supported for preparation operations.".into()) };
        }
        let missing = "The exact reviewed network, chain ID and applicable formation ID are required for custody preparation.";
        let review = review.ok_or(missing)?;
        let formation_scope = match request.operation.as_str() {
            "identity_generate" => review.formation_id.is_none(),
            _ => review.formation_id.as_deref().is_some_and(|id| {
                id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    && id.bytes().any(|byte| byte != b'0')
            }),
        };
        if !formation_scope || !validator_network_id(&review.network_id) || !validator_chain_id(&review.chain_id) {
            return Err(missing.into());
        }
        Ok(Some(review))
    }

    pub(super) fn preflight_operation(&self) -> &'static str {
        if self.formation_id.is_some() { "formation_preflight" } else { "identity_preflight" }
    }

    fn digest_key(&self) -> &'static str {
        if self.formation_id.is_some() { "formation_sha256" } else { "genesis_sha256" }
    }

    pub(super) fn confirmation_details(&self, request: &Request) -> String {
        let mut details = format!("\nNetwork incarnation: {}\nChain ID: {}", self.network_id, self.chain_id);
        let digest = request.parameters[self.digest_key()].as_str().unwrap_or_default();
        if let Some(id) = &self.formation_id {
            details.push_str(&format!("\nFormation ID: {id}\nFormation context SHA-256: {digest}"));
        } else {
            details.push_str(&format!("\nSigned Genesis SHA-256: {digest}"));
        }
        details
    }

    fn matches_scope(&self, request: &Request, result: &Value) -> bool {
        let key = self.digest_key();
        result["network_id"] == self.network_id && result["chain_id"] == self.chain_id
            && result[key] == request.parameters[key]
            && self.formation_id.as_deref().is_none_or(|id| result["formation_id"] == id)
    }

    pub(super) fn require_current_preflight(&self, request: &Request, reply: &Value) -> Result<(), &'static str> {
        let evidence = preparation_reply(self.preflight_operation(), reply)?;
        if self.matches_scope(request, &evidence["result"]) { return Ok(()); }
        Err("The current controller preflight differs from the reviewed custody scope. Review the preparation inputs again.")
    }

    pub(super) fn uncertain_message(&self) -> &'static str {
        if self.formation_id.is_some() { FORMATION_PREPARATION_UNCERTAIN } else { IDENTITY_GENERATION_UNCERTAIN }
    }

    pub(super) fn verify_acknowledgement(&self, request: &Request, reply: &Value) -> Result<Value, &'static str> {
        let projection = match self.formation_id {
            Some(_) => formation_preparation_reply(request, reply)?,
            None => identity_generation_reply(request, reply)?,
        };
        if projection["ok"] == false || self.matches_scope(request, &projection["result"]) { return Ok(projection); }
        Err(self.uncertain_message())
    }
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenesisBindingReview {
    network_id: String,
    chain_id: String,
    validator_address: String,
}

#[cfg(test)]
impl GenesisBindingReview {
    pub(super) fn for_request(request: &Request, review: Option<Self>) -> Result<Option<Self>, String> {
        match (request.operation.as_str(), review) {
            ("genesis_bind", Some(review)) if validator_network_id(&review.network_id)
                && validator_chain_id(&review.chain_id) && valid_validator_address(&review.validator_address) => Ok(Some(review)),
            ("genesis_bind", _) => Err("A reviewed network, chain ID and validator address are required for Genesis binding.".into()),
            (_, None) => Ok(None),
            _ => Err("Genesis binding review is only supported for the binding operation.".into()),
        }
    }

    pub(super) fn confirmation_details(&self, request: &Request) -> String {
        format!("\nReviewed validator: {}\nNetwork incarnation: {}\nChain ID: {}\nGenesis SHA-256: {}",
            self.validator_address, self.network_id, self.chain_id, request.parameters["genesis_sha256"].as_str().unwrap_or_default())
    }

    fn matches(&self, request: &Request, reply: &Value, bound: bool) -> bool {
        let result = &reply["result"];
        exact_genesis_mutation_reply(reply) && reply["ok"] == true
            && result.as_object().is_some_and(|fields| fields.len() == 9)
            && result["stage_receipt_verified"].is_boolean() && result["schema"] == "nodenetwork-genesis-binding-v1"
            && result["genesis_authority_verified"] == true && result["membership_verified"] == true
            && result["bound"] == bound && result["genesis_sha256"] == request.parameters["genesis_sha256"]
            && result["network_id"] == self.network_id && result["chain_id"] == self.chain_id
            && result["address"] == self.validator_address
    }

    pub(super) fn require_unbound(&self, request: &Request, reply: &Value) -> Result<(), String> {
        if self.matches(request, reply, false) { return Ok(()); }
        Err("The current controller preflight differs from the reviewed unbound Genesis scope. Review it again before binding.".into())
    }

    pub(super) fn verify_acknowledgement(&self, request: &Request, reply: Value) -> Result<Value, String> {
        if exact_genesis_mutation_reply(&reply) && (reply["ok"] == false || self.matches(request, &reply, true)) { return Ok(reply); }
        Err("Genesis binding outcome is uncertain. The controller reply differed from the reviewed validator scope. Preserve pending custody and review its binding status before another change.".into())
    }
}

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
        if self.operation=="r1_identity_preview" { return crate::r1_identity_creation::validate(self); }
        if self.operation=="gateway_vpn_preflight"{return crate::gateway_vpn::validate(self)}
        if self.operation.starts_with("gateway_target_")||matches!(self.operation.as_str(),"gateway_install"|"gateway_install_preflight"|"gateway_install_status"){return crate::gateway_target::validate(self)}
        if self.operation.starts_with("gateway_"){return crate::gateway_admission::validate(self)}
        if self.operation.starts_with("treasury_send_"){return crate::treasury_send::validate(self)}
        let p = self.parameters.as_object().ok_or("Controller parameters must be an object.")?;
        let mutation = match self.operation.as_str() {
            "legacy_gateway_service_status" | "chain1266_relocation_status" | "chain1266_relocation_records_status" | "chain1266_retirement_status" => false,
            "legacy_gateway_service_stop" | "legacy_gateway_root_retire" | "chain1266_relocate" | "chain1266_relocate_records" | "chain1266_retire" => true,
            "upgrade_native_preflight"|"operator_auth_status"|"target"|"inventory"|"health"|"install_preflight"|"upgrade_preflight"|"recovery_preflight"|"uninstall_preflight"|"vpn_status"|"vpn_unused_preflight"|"vpn_stop_status"|"vpn_resume_status"|"boot_policy_status"|"vpn_diagnostics"|"diagnostics"|"identity_preflight"|"identity_status"|"formation_preflight"|"formation_status"|"formation_export"|"genesis_binding_preflight"|"genesis_stage_preflight"|"authorization_status"|"network_formation_status"|"network_formation_export"|"network_transport_status"|"network_transport_export"|"guest_status"|"guest_boot_diagnostics"|"guest_preflight"|"guest_resources"|"commissioning_observation"|"treasury_preflight"|"treasury_status"|"treasury_export" => false,
            "legacy_peer_preflight"|"legacy_peer_key_read"|"legacy_peer_retire"|"legacy_peer_retire_status"|"operator_auth_load"|"install"|"commission"|"register"|"start"|"stop"|"restart"|"upgrade"|"uninstall"|"vpn_enroll"|"vpn_bind"|"vpn_retire"|"vpn_cancel_unused"|"vpn_stop"|"vpn_resume"|"boot_policy"|"identity_generate"|"formation_prepare"|"genesis_bind"|"genesis_stage"|"network_formation_prepare"|"network_formation_sign"|"network_transport_prepare"|"network_transport_sign"|"guest_create"|"guest_stop"|"guest_resume"|"guest_remove"|"treasury_prepare" => true,
            _ => return Err("Unsupported NodeNetwork controller operation.".into()),
        };
        if matches!(self.operation.as_str(),"vpn_enroll"|"vpn_cancel_unused")&&p.get("attempt_sha256").is_some_and(|v|!v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))){return Err("Invalid exact native VPN attempt commitment".into())}
        let expected: &[&str] = match self.operation.as_str() {
            "install"|"install_preflight" => &["release_id","manifest_sha256","network_id","chain_id","node_name"],
            "upgrade"|"upgrade_preflight"|"upgrade_native_preflight" => &["release_id","manifest_sha256"],
            "uninstall" => &["confirmation"],
            "boot_policy" => &["service","enabled"],
            "commissioning_observation" if p.contains_key("online_addresses") => &["online_addresses"],
            "vpn_cancel_unused" => &["attempt_sha256"],
            "vpn_enroll" if p.contains_key("attempt_sha256") => &["attempt_sha256"],
            "identity_generate"|"genesis_bind" => &["genesis_sha256"],
            "formation_prepare" => &["formation_sha256"],
            "treasury_prepare" => &["formation_sha256","effective_at_unix"],
            "genesis_stage" => &["artifacts"],
            "network_formation_prepare" => &["formation_sha256","recipe_json","registrations_json"],
            "network_formation_sign" => &["review_sha256"],
            "network_transport_prepare" => &["formation_sha256","genesis_review_sha256","target_provider_report_sha256","valid_from_unix","expires_at_unix","members"],
            "network_transport_sign" => &["review_sha256"],
            "guest_status"|"guest_boot_diagnostics"|"guest_preflight"|"guest_stop"|"guest_remove" => &["guest_id"],
            "guest_resume" => &["guest_id","resume_sequence","create_request_sha256"],
            "guest_create" => &["guest_id","image_sha256","cpu_count","memory_mib","disk_gib"],
            _ => &[],
        };
        if p.len() != expected.len() || expected.iter().any(|k| !p.contains_key(*k)) {
            return Err("Unexpected controller parameters; paths, secrets and shell commands are forbidden.".into());
        }
        if self.operation=="commissioning_observation"&&p.contains_key("online_addresses"){
            let addresses=p["online_addresses"].as_array().filter(|v|v.len()<=5&&v.iter().all(|a|a.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128&&s.is_ascii()&&!s.bytes().any(|b|b.is_ascii_control())))).ok_or("Invalid exact online validator selection")?;
            if addresses.windows(2).any(|p|p[0].as_str()>=p[1].as_str()){return Err("Online validator selection must be sorted and unique".into())}
        }
        if self.operation=="boot_policy"&&(!matches!(p["service"].as_str(),Some("node"|"vpn"))||!p["enabled"].is_boolean()){return Err("Choose one exact node or VPN boot policy boolean".into())}
        if self.operation.starts_with("guest_")&&self.operation!="guest_resources" {
            let id=p["guest_id"].as_str().ok_or("Guest ID required")?;
            if id.is_empty()||id.len()>32||!id.as_bytes()[0].is_ascii_lowercase()||!id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-'){return Err("Invalid guest ID".into())}
            if self.operation=="guest_resume"&&(!p["create_request_sha256"].as_str().is_some_and(|v|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))||!p["resume_sequence"].as_u64().is_some_and(|v|(1..=128).contains(&v))){return Err("Bounded guest resume sequence and creation binding required".into())}
            if self.operation=="guest_create" {
                if !p["image_sha256"].as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("Pinned guest image required".into())}
                for (key,lo,hi)in[("cpu_count",1,32),("memory_mib",1024,65536),("disk_gib",8,512)]{if !p[key].as_u64().is_some_and(|n|(lo..=hi).contains(&n)){return Err("Guest resources outside approved bounds".into())}}
            }
        }
        if self.operation=="network_formation_prepare" && (!p["recipe_json"].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=1024*1024)||!p["registrations_json"].as_array().is_some_and(|a|a.len()==5&&a.iter().all(|v|v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=128*1024)))){return Err("Bounded public recipe and five registrations required".into())}
        if self.operation=="treasury_prepare"&&!p["effective_at_unix"].as_u64().is_some_and(|n|n>0&&n<1<<53){return Err("Review exact native treasury effective time".into())}
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
fn approved_host_line(target:&Target,set:Option<&str>,single:Option<&str>,debug:bool,required:bool)->Result<Option<String>,String>{
    use base64::Engine as _;
    if !debug{return if required{Err("Bootstrap host has no approved native trust profile".into())}else{Ok(None)}}
    let endpoint=if target.port.unwrap_or(22)==22{target.host.as_deref().unwrap_or("").trim_matches(['[',']']).to_ascii_lowercase()}else{format!("[{}]:{}",target.host.as_deref().unwrap_or("").trim_matches(['[',']']).to_ascii_lowercase(),target.port.unwrap_or(22))};
    let mut lines=std::collections::BTreeMap::new();
    if let Some(raw)=set{
        if raw.is_empty()||raw.len()>4096{return Err("Invalid bounded compiled host pin set".into())}
        for line in raw.split(['\n','\x1e']){
            let fields=line.split_whitespace().collect::<Vec<_>>();
            if fields.len()!=3||fields.join(" ")!=line||fields[0].contains([',','*','?','|','!'])||fields[0]!=fields[0].to_ascii_lowercase()||fields[1]!="ssh-ed25519"{return Err("Host pin set requires exact unambiguous endpoint and key lines".into())}
            let (host,port)=if let Some((host,port))=fields[0].strip_prefix('[').and_then(|v|v.rsplit_once("]:")){(host,port.parse::<u16>().ok().filter(|p|*p!=0&&*p!=22&&p.to_string()==port).ok_or("Invalid canonical pinned port")?)}else{(fields[0],22)};
            let name=if host.contains(':'){format!("[{host}]")}else{host.into()};
            Target{kind:"remote".into(),host:Some(name),port:Some(port),root:ROOT.into(),guest:None}.validate()?;
            let bytes=base64::engine::general_purpose::STANDARD.decode(fields[2]).map_err(|_|"Invalid pinned SSH wire key")?;
            if bytes.len()!=51||!bytes.starts_with(b"\0\0\0\x0bssh-ed25519\0\0\0\x20")||base64::engine::general_purpose::STANDARD.encode(&bytes)!=fields[2]||lines.insert(fields[0].to_string(),line.to_string()).is_some(){return Err("Malformed or duplicate compiled SSH endpoint authority".into())}
        }
        if lines.is_empty()||lines.len()>5{return Err("At most five independently pinned physical endpoints required".into())}
    }
    if let Some(line)=single{
        let fields=line.split_whitespace().collect::<Vec<_>>();
        if fields.len()!=3||fields[0]!="[127.0.0.1]:22280"{return Err("Invalid legacy isolated host pin".into())}
        if let Some(existing)=lines.get(fields[0]){if existing!=line{return Err("Conflicting independently compiled host pins".into())}}
        else if set.is_none(){lines.insert(fields[0].into(),line.into());}else{return Err("Legacy host pin must belong to the bounded set".into())}
    }
    if let Some(line)=lines.get(&endpoint){return Ok(Some(line.clone()))}
    if required||set.is_some(){return Err("Selected endpoint has no independently compiled bootstrap host pin".into())}Ok(None)
}
pub(super) fn bootstrap_host_pin(target:&Target,directory:&Path)->Result<std::path::PathBuf,String>{
    #[cfg(unix)]protect_control_directory(directory)?;
    if let Some(pin)=profile_host_pin(target,directory)?{return Ok(pin);}
    let line=approved_host_line(target,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PINS"),option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"),cfg!(debug_assertions),true)?.ok_or("Missing bootstrap host pin")?;
    qualification_host_pin(directory,&line)
}

pub(super) fn profile_host_identity(target:&Target,path:&Path)->Result<(String,String),String>{
    use base64::{engine::general_purpose::{STANDARD,STANDARD_NO_PAD},Engine};
    use std::io::Read;
    let metadata=path.symlink_metadata().map_err(|_|"Verified SSH host identity is unavailable")?;
    if !cfg!(debug_assertions)||target.kind!="remote"||target.guest.is_some()||!metadata.is_file()
      ||metadata.len()==0||metadata.len()>2048{return Err("Select one verified physical SSH host pin".into());}
    let mut raw=String::new();
    std::fs::File::open(path).and_then(|f|f.take(2049).read_to_string(&mut raw))
        .map_err(|_|"Cannot read verified SSH host identity")?;
    if raw.len()>2048{return Err("SSH host identity exceeds its bound".into());}
    let line=approved_host_line(target,Some(raw.trim_end_matches('\n')),None,true,true)?
        .ok_or("SSH host identity does not match the selected endpoint")?;
    let key=STANDARD.decode(line.split_whitespace().last().ok_or("SSH host key is missing")?)
        .map_err(|_|"Invalid SSH host key")?;
    Ok((line,format!("SHA256:{}",STANDARD_NO_PAD.encode(Sha256::digest(key)))))
}

fn profile_host_pin_path(target:&Target,directory:&Path)->std::path::PathBuf{
    let scope=Sha256::digest(target.journal_identity().to_string().as_bytes());
    directory.join(format!("profile-host-{scope:x}.known-hosts"))
}

fn profile_host_pin(target:&Target,directory:&Path)->Result<Option<std::path::PathBuf>,String>{
    let path=profile_host_pin_path(target,directory);
    if !path.exists()&&!path.is_symlink(){return Ok(None);}
    let metadata=path.symlink_metadata().map_err(|_|"Cannot inspect approved profile host pin")?;
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink()!=1||metadata.mode()&0o777!=0o600
           ||metadata.uid()!=directory.metadata().map_err(|_|"Cannot inspect host pin owner")?.uid(){
            return Err("Unsafe approved profile host pin".into());
        }
    }
    profile_host_identity(target,&path)?;
    Ok(Some(path))
}

pub(super) fn retain_profile_host_pin(target:&Target,directory:&Path,line:&str)->Result<std::path::PathBuf,String>{
    use std::io::Write;
    #[cfg(unix)]protect_control_directory(directory)?;
    let path=profile_host_pin_path(target,directory);
    let bytes=format!("{line}\n");
    if let Some(existing)=profile_host_pin(target,directory)?{
        if std::fs::read(&existing).map_err(|_|"Cannot read approved SSH host pin")?!=bytes.as_bytes(){
            return Err("The approved SSH host identity changed. Review host identity and reconcile before continuing.".into());
        }
        return Ok(existing);
    }
    let mut options=std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
    options.open(&path).and_then(|mut file|{file.write_all(bytes.as_bytes())?;file.sync_all()})
        .map_err(|_|"Cannot retain the approved SSH host identity")?;
    Ok(path)
}
pub(super) fn qualification_host_pin(directory:&Path,pin:&str)->Result<std::path::PathBuf,String>{
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
    let selected=if target.guest.is_none(){crate::node_bootstrap::controller_operator_identity(target,directory)?}else{None};
    remote_command_with_identity(target,directory,account,remote,known_hosts,selected.as_deref())
}
pub(super) fn remote_command_with_identity(target:&Target,directory:&Path,account:&str,remote:&str,known_hosts:Option<&Path>,identity:Option<&Path>)->Result<tokio::process::Command,String>{
    target.validate()?;
    if target.guest.is_some(){if identity.is_some(){return Err("Guest credential source is unsupported".into())}return crate::managed_guest::remote_command(target,directory,account,remote)}
    #[cfg(unix)] protect_control_directory(directory)?;
    let socket=control_socket(target,directory,account);
    if socket.as_os_str().len()>95 {return Err("Portal SSH control path is too long on this platform.".into());}
    let qualification_pin=if known_hosts.is_none(){
        if let Some(pin)=profile_host_pin(target,directory)?{Some(pin)}
        else{approved_host_line(target,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PINS"),option_env!("SYNERGY_NODENETWORK_QUALIFICATION_HOST_PIN"),cfg!(debug_assertions),false)?.map(|line|qualification_host_pin(directory,&line)).transpose()?}
    }else{None};
    let known_hosts=known_hosts.or(qualification_pin.as_deref());
    let mut c=tokio::process::Command::new("/usr/bin/ssh");
    c.args(["-F","/dev/null","-T","-oBatchMode=yes","-oStrictHostKeyChecking=yes","-oUpdateHostKeys=no",
        "-oPasswordAuthentication=no","-oKbdInteractiveAuthentication=no","-oPreferredAuthentications=publickey","-oForwardAgent=no","-oClearAllForwardings=yes","-oConnectTimeout=10",
        "-oServerAliveInterval=15","-oServerAliveCountMax=2","-oControlMaster=auto","-oControlPersist=600"])
        .arg("-o").arg(format!("ControlPath={}",socket.display())).arg("-p").arg(target.port.unwrap_or(22).to_string());
    if let Some(pins)=known_hosts {c.arg("-o").arg(format!("UserKnownHostsFile={}",pins.display())).arg("-oGlobalKnownHostsFile=/dev/null");}
    if let Some(key)=identity {c.arg("-oIdentitiesOnly=yes").arg("-i").arg(key);}
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

pub(super) fn install_preflight_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    if reply["ok"] != true {
        if reply["error"]["code"] == "qualification_required" {
            return Err("The controller did not confirm package or network policy for this preflight.");
        }
        return Err("The selected controller could not provide an installation preflight report.");
    }
    let result = &reply["result"];
    if reply["version"] != 1 || !result.as_object().is_some_and(|fields| fields.len() == 6)
        || result["release"] != request.parameters["release_id"] || result["root"] != ROOT
        || result["packageVerified"] != true || result["networkSelectionApproved"] != true
        || result["genesisAuthorityVerified"] != false || result["activationAuthorized"] != false {
        return Err("The selected controller returned unsupported or mismatched installation preflight evidence.");
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn qualified_software_target(reply: &Value, installed: bool, operations: &[(&str, &str)]) -> bool {
    let result = &reply["result"];
    let compatible = reply["version"] == 1 && reply["ok"] == true && result["root"] == ROOT
        && result["controllerVersion"] == 1 && result["installed"] == installed
        && result["platform"] == "linux" && result["architecture"] == "x86_64"
        && result["localValidatorSupported"] == true;
    compatible && result["operations"].as_array().filter(|rows| rows.len() <= 100).is_some_and(|rows| {
        operations.iter().copied().all(|(operation, kind)| {
            let mut matches = rows.iter().filter(|row| row["operation"] == operation);
            matches.next().is_some_and(|row| row["kind"] == kind && row["available"] == true) && matches.next().is_none()
        })
    })
}

#[cfg(test)]
pub(super) fn require_staged_install_target(reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, false, &[("install", "mutation"), ("install_preflight", "read")]).then_some(())
        .ok_or("The controller no longer reports an uninstalled Linux x86-64 target with qualified installation and preflight operations.")
}

#[cfg(test)]
pub(super) fn require_commission_target(reply: &Value, pending_formation: bool) -> Result<(), &'static str> {
    let required = [("commission", "mutation"), ("formation_status", "read"),
        ("vpn_status", "read"), ("genesis_binding_preflight", "read")];
    let operations = if pending_formation { &required[..] } else { &required[..2] };
    enrolled_software_target(reply, operations).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with qualified validator commissioning and its required reads.")
}

#[cfg(test)]
fn enrolled_software_target(reply: &Value, operations: &[(&str,&str)]) -> bool {
    reply.as_object().is_some_and(|fields| fields.len() == 3)
        && reply["result"].as_object().is_some_and(|fields| fields.len() == 8)
        && reply["result"]["communityEnrollment"] == false
        && qualified_software_target(reply, true, operations)
}

#[cfg(test)]
pub(super) fn require_genesis_target(reply: &Value, operation: &str) -> Result<(), &'static str> {
    // Testnet v3 613fa6ab controller.py::target advertises qualified mutations independently of policy reads.
    let operations: &[(&str, &str)] = match operation {
        "genesis_stage" => &[("genesis_stage", "mutation"), ("formation_status", "read"), ("genesis_stage_preflight", "read")],
        "genesis_bind" => &[("genesis_bind", "mutation"), ("genesis_binding_preflight", "read")],
        _ => return Err("Unsupported Genesis target qualification."),
    };
    let exact_rows = || reply["result"]["operations"].as_array().is_some_and(|rows| rows.iter()
        .filter(|row| operations.iter().any(|(name,_)| row["operation"] == *name))
        .all(|row| row.as_object().is_some_and(|fields| fields.len() == 4) && row.get("blocker") == Some(&Value::Null)));
    (enrolled_software_target(reply, operations) && exact_rows()).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with the qualified Genesis operation and its required reads.")
}

#[cfg(test)]
pub(super) fn require_custody_preparation_target(request: &Request, review: &CustodyPreparationReview, reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[(&request.operation, "mutation"), (review.preflight_operation(), "read")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with the qualified preparation and preflight operations.")
}

#[cfg(test)]
pub(super) fn require_service_start_target(operation: &str, reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[(operation, "mutation"), ("vpn_status", "read")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with the qualified service action and VPN status read.")
}

#[cfg(test)]
pub(super) fn require_service_stop_target(reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[("stop", "mutation")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with a qualified stop action.")
}

#[cfg(test)]
pub(super) fn require_vpn_enrollment_target(reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[("vpn_enroll", "mutation"), ("vpn_status", "read")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with qualified VPN enrollment and status operations.")
}

#[cfg(test)]
pub(super) fn require_service_registration_target(reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[("register", "mutation")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with qualified service registration.")
}

#[cfg(test)]
pub(super) fn require_upgrade_target(reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[("upgrade", "mutation")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with a qualified upgrade operation.")
}

#[cfg(test)]
pub(super) fn require_removal_target(reply: &Value) -> Result<(), &'static str> {
    qualified_software_target(reply, true, &[("uninstall", "mutation")]).then_some(())
        .ok_or("The controller no longer reports an installed Linux x86-64 target with a qualified removal operation.")
}

pub(super) fn commissioning_reply(reply: &Value) -> Result<Value, &'static str> {
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) {
        return Err(COMMISSION_UNCERTAIN);
    }
    if reply["ok"] == false {
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(COMMISSION_UNCERTAIN); }
        // The pinned controller's authorize() emits these before grant consumption or commissioning.
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify validator commissioning."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for validator commissioning."),
            _ => return Err(COMMISSION_UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    // lifecycle.py::_commission_locked returns only these flags after final conformance.
    if reply["ok"] != true
        || reply["result"] != json!({"commissioned":true,"consensus_started":false,"production_approved":false}) {
        return Err(COMMISSION_UNCERTAIN);
    }
    Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-commissioning-v1",
        "commissioned":true,"consensus_started":false,"production_approved":false}}))
}

pub(super) fn register_service_reply(reply: &Value) -> Result<Value, &'static str> {
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) { return Err(REGISTER_UNCERTAIN); }
    if reply["ok"] == false {
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(REGISTER_UNCERTAIN); }
        // These exact owner refusals occur before the grant and service changes.
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify service registration."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for service registration."),
            _ => return Err(REGISTER_UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    if reply["ok"] != true || !result.as_object().is_some_and(|fields| fields.len() == 3)
        || result["services_started"] != false || result["boot_enabled"] != false {
        return Err(REGISTER_UNCERTAIN);
    }
    // Owner lifecycle.py returns the exact unit order defined by rendered_units.
    let registered = result["registered"].as_array().ok_or(REGISTER_UNCERTAIN)?;
    let owner_units = ["/etc/systemd/system/synergy-node.service", "/etc/systemd/system/synergy-vpn.service",
        "/etc/systemd/system/synergy-canary-rpc-relay.service"];
    if !matches!(registered.len(), 2 | 3) || registered.iter().zip(owner_units).any(|(unit, expected)| unit != expected) {
        return Err(REGISTER_UNCERTAIN);
    }
    let services = &["node", "vpn", "canary-rpc-relay"][..registered.len()];
    Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-service-registration-v1",
        "services":services,"services_started":false,"boot_enabled":false}}))
}

pub(super) fn install_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    install_role_reply(request,reply,"validator","nodenetwork-installed-validator-v1")
}
pub(super) fn gateway_install_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    install_role_reply(request,reply,"rpc_gateway","nodenetwork-installed-gateway-v1")
}
fn install_role_reply(request: &Request, reply: &Value, role:&str, schema:&str) -> Result<Value, &'static str> {
    const UNCERTAIN: &str = "Installation outcome is uncertain. Inspect the selected target before another change.";
    if !reply.as_object().is_some_and(|fields| fields.len() == 3) || reply["version"] != 1 {
        return Err(UNCERTAIN);
    }
    if reply["ok"] == false {
        let error = &reply["error"];
        // Only exact owner refusals before a grant is consumed can close the dispatch fence.
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("qualification_required"), Some("Release has no authenticated host approval" | "Network not approved for selected release" | "Operation has not passed host qualification")) =>
                ("qualification_required", "The host did not qualify this exact installation request."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "The host requires a current one-use grant for this exact installation request."),
            _ => return Err(UNCERTAIN),
        };
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(UNCERTAIN); }
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    let p = &request.parameters;
    let members = result["package_files"].as_object().filter(|files| !files.is_empty() && files.len() <= 4096
        && files.values().all(lowercase_digest)).ok_or(UNCERTAIN)?;
    if reply["ok"] != true || !result.as_object().is_some_and(|fields| fields.len() == 10)
        || result["format"] != "synergy-universal-linux-v1" || result["root"] != ROOT || result["role"] != role
        || ["network_id", "chain_id", "node_name"].iter().any(|key| result[*key] != p[*key])
        || result["package_sha256"] != p["manifest_sha256"] || result["consensus_started"] != false
        || !result["host_integrations"].as_array().is_some_and(Vec::is_empty) {
        return Err(UNCERTAIN);
    }
    let chain = p["chain_id"].as_u64().ok_or(UNCERTAIN)?.to_string();
    Ok(json!({"version":1,"ok":true,"result":{
        "schema":schema,"root":ROOT,"role":role,"release_id":p["release_id"],
        "manifest_sha256":p["manifest_sha256"],"network_id":p["network_id"],"chain_id":chain,"node_name":p["node_name"],
        "declared_members":members.len(),"host_integrations_registered":false,"consensus_started":false
    }}))
}

fn upgrade_preflight_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    if reply["ok"] != true {
        if reply["error"]["code"] == "qualification_required" {
            return Err("The controller could not confirm host approval for the staged update package.");
        }
        return Err("The controller could not verify the staged update and installed receipt.");
    }
    let result = &reply["result"];
    if !reply.as_object().is_some_and(|fields| fields.len() == 3) || reply["version"] != 1
        || !result.as_object().is_some_and(|fields| fields.len() == 3)
        || result["release"].as_str().is_none() || result["release"] != request.parameters["release_id"]
        || result["packageVerified"] != true || result["automaticRestart"] != false {
        return Err("The selected controller returned unsupported or mismatched update preflight evidence.");
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

pub(super) fn upgrade_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) { return Err(UPGRADE_UNCERTAIN); }
    if reply["ok"] == false {
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(UPGRADE_UNCERTAIN); }
        // These exact owner refusals occur before the upgrade uses the one-use grant.
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("qualification_required"), Some("Release has no authenticated host approval" | "Operation has not passed host qualification")) =>
                ("qualification_required", "The host did not qualify the staged software or this upgrade operation."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for the software upgrade."),
            _ => return Err(UPGRADE_UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    let fields = result.as_object().ok_or(UPGRADE_UNCERTAIN)?;
    let expected = &request.parameters["manifest_sha256"];
    if reply["ok"] != true || !lowercase_digest(expected) || result["package_sha256"] != *expected
        || result["consensus_started"] != false || result["automatic_restart"] != false {
        return Err(UPGRADE_UNCERTAIN);
    }
    let (outcome, previous, vpn_restart) = if fields.len() == 4 && result["already_current"] == true {
        ("already_current", None, None)
    } else if fields.len() == 11 && result["format"] == "synergy-software-upgrade-completed-v1" && result["root"] == ROOT
        && result["new_package_sha256"] == *expected && lowercase_digest(&result["old_package_sha256"])
        && result["old_package_sha256"] != *expected && result["resumed"].is_boolean() && result["vpn_restart_required"].is_boolean()
        && result["vpn_stopped"] == false && result["custody_or_state_copied"] == false {
        let outcome = if result["resumed"] == true { "resumed" } else { "completed" };
        (outcome, Some(&result["old_package_sha256"]), Some(&result["vpn_restart_required"]))
    } else {
        return Err(UPGRADE_UNCERTAIN);
    };
    Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-software-upgrade-v1","outcome":outcome,
        "manifest_sha256":expected,"previous_manifest_sha256":previous,"vpn_restart_required":vpn_restart}}))
}

fn recovery_preflight_reply(reply: &Value) -> Result<Value, &'static str> {
    if reply["ok"] != true {
        return Err("The selected controller could not provide recovery preflight evidence.");
    }
    let result = &reply["result"];
    if !reply.as_object().is_some_and(|fields| fields.len() == 3) || reply["version"] != 1
        || !result.as_object().is_some_and(|fields| fields.len() == 3)
        || result["qualified"] != false || result["certifiedStateChanged"] != false
        || result["blocker"] != "Checkpoint import is not exposed until the selected release recovery procedure is qualified" {
        return Err("The selected controller returned unsupported recovery preflight evidence.");
    }
    Ok(json!({"version":1,"ok":true,"result":{"qualified":false,"certifiedStateChanged":false}}))
}

const VPN_STATUS_FIELDS: [&str; 6] = ["service_registered", "enrollment_staged", "enrollment_recorded", "reconciliation_required", "server_bound", "connected"];

fn vpn_status_reply(reply: &Value) -> Result<Value, &'static str> {
    use std::net::IpAddr;
    const UNSUPPORTED: &str = "The selected controller returned unsupported VPN status.";
    if reply["ok"] != true {
        return Err("The selected controller could not provide VPN status.");
    }
    let result = &reply["result"];
    let fields = result.as_object().ok_or(UNSUPPORTED)?;
    if fields.len() != VPN_STATUS_FIELDS.len() + 2 || result["schema"] != "nodenetwork-vpn-status-v1"
        || VPN_STATUS_FIELDS.iter().any(|key| result[*key].as_bool().is_none()) {
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
    // Validate the owner's overlay field locally and keep it outside the renderer reply.
    let mut public: serde_json::Map<String, Value> = VPN_STATUS_FIELDS.into_iter()
        .map(|field| (field.into(), result[field].clone())).collect();
    public.insert("schema".into(), json!("nodenetwork-vpn-status-v1"));
    Ok(json!({"version":1,"ok":true,"result":public}))
}

#[cfg(test)]
pub(super) fn vpn_enrollment_reply(reply: &Value) -> Result<Value, &'static str> {
    const UNCERTAIN: &str = VPN_ENROLLMENT_UNCERTAIN;
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) {
        return Err(UNCERTAIN);
    }
    if reply["ok"] == false {
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(UNCERTAIN); }
        // Pinned controller.py emits these before a grant is consumed or the provider is called.
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify this VPN enrollment."),
            (Some("authorization_required"), Some("No approved one-use VPN enrollment is staged" | "Exact request needs one-time host operator authorization"
                | "Host authorization expired or differs" | "One-time host grant does not bind this VPN enrollment")) =>
                ("authorization_required", "The host controller refused the one-use VPN enrollment authorization."),
            _ => return Err(UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = vpn_status_reply(reply).map_err(|_| UNCERTAIN)?;
    let status = &result["result"];
    if status["enrollment_recorded"] != true || status["service_registered"] != true
        || status["enrollment_staged"] != false {
        return Err(UNCERTAIN);
    }
    Ok(result)
}

#[cfg(test)]
fn projected_vpn_status(reply: &Value) -> Option<&Value> {
    // These gates consume the native projection after validation of the owner's overlay field.
    let status = &reply["result"];
    (reply["version"] == 1 && reply["ok"] == true && reply.as_object().is_some_and(|fields| fields.len() == 3)
        && status.as_object().is_some_and(|fields| fields.len() == VPN_STATUS_FIELDS.len() + 1)
        && status["schema"] == "nodenetwork-vpn-status-v1" && VPN_STATUS_FIELDS.iter().all(|key| status[*key].is_boolean())).then_some(status)
}

#[cfg(test)]
fn confirmed_bound_vpn(reply: &Value) -> bool {
    projected_vpn_status(reply).filter(|status| status["service_registered"] == true && status["enrollment_recorded"] == true
        && status["reconciliation_required"] == false && status["server_bound"] == true && status["connected"] == true)
        .is_some()
}

#[cfg(test)]
pub(super) fn require_service_start_vpn(reply: &Value) -> Result<(), &'static str> {
    confirmed_bound_vpn(reply).then_some(())
        .ok_or("The current controller VPN report could not confirm the startup prerequisites. Read VPN status again before starting or restarting.")
}

#[cfg(test)]
pub(super) fn require_formation_commission_vpn(reply: &Value) -> Result<(), &'static str> {
    confirmed_bound_vpn(reply).then_some(())
        .ok_or("The controller could not confirm bound VPN connectivity for formation commissioning. Review VPN status again.")
}

#[cfg(test)]
pub(super) fn require_staged_vpn_enrollment(reply: &Value) -> Result<(), &'static str> {
    projected_vpn_status(reply).filter(|status| status["service_registered"] == true && status["enrollment_staged"] == true
        && status["enrollment_recorded"] == false && status["reconciliation_required"] == false
        && status["server_bound"] == false && status["connected"] == false)
        .map(|_| ()).ok_or("The current controller VPN report could not confirm staged enrollment eligibility. Read VPN status again before enrolling.")
}

pub(super) fn node_service_reply(operation: &str, reply: &Value) -> Result<Value, &'static str> {
    const UNCERTAIN: &str = NODE_SERVICE_UNCERTAIN;
    if !matches!(operation, "start" | "restart" | "stop") || reply["version"] != 1
        || !reply.as_object().is_some_and(|fields| fields.len() == 3) {
        return Err(UNCERTAIN);
    }
    if reply["ok"] == false {
        // Only the pinned controller's exact pre-dispatch refusals release the local journal fence.
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(UNCERTAIN); }
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("vpn_readiness_required"), Some("Current native VPN must match the recorded, independently server-bound validator peer"))
                if operation != "stop" => ("vpn_readiness_required", "The controller could not confirm the current bound VPN. Read VPN status again."),
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify this node service action."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for this node service action."),
            _ => return Err(UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    if reply["ok"] != true || !result.as_object().is_some_and(|fields| fields.len() == 2)
        || result["requested"] != operation || result["healthNotInferred"] != true {
        return Err(UNCERTAIN);
    }
    Ok(json!({"version":1,"ok":true,"result":{"requested":operation,"healthNotInferred":true}}))
}

fn lowercase_digest(value: &Value) -> bool {
    value.as_str().is_some_and(|pin| pin.len() == 64 && pin.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')))
}

fn validator_network_context(result: &Value) -> bool {
    result["network_id"].as_str().is_some_and(validator_network_id)
        && result["chain_id"].as_str().is_some_and(validator_chain_id)
}

pub(super) fn validator_network_id(network: &str) -> bool {
    (2..=128).contains(&network.len()) && network.as_bytes()[0].is_ascii_alphanumeric()
        && network.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
}

pub(super) fn validator_chain_id(chain: &str) -> bool {
    (1..=20).contains(&chain.len()) && chain.parse::<u64>().is_ok_and(|number| number > 0 && number.to_string() == chain)
}

fn validator_address(value: &Value) -> bool {
    value.as_str().is_some_and(valid_validator_address)
}

// Optional c92/a984 owner evidence. This admits only the public DTO; the
// uppercase target, controller inventory, host policy and grants stay separate.
#[derive(Clone, Copy)]
enum IdentityEvidence { Preflight, Generation, Status }

fn identity_evidence(result: &Value, kind: IdentityEvidence) -> bool {
    let Some(fields) = result.as_object() else { return false; };
    if !validator_network_context(result) || result["genesis_authority_verified"] != true
        || !lowercase_digest(&result["genesis_sha256"]) { return false; }
    let base = match kind {
        IdentityEvidence::Preflight => 4,
        IdentityEvidence::Generation | IdentityEvidence::Status => {
            if !validator_address(&result["address"]) || result["possession_verified"] != true
                || result["membership_granted"] != false { return false; }
            if matches!(kind, IdentityEvidence::Status) {
                if result["pending"] != true { return false; }
                8
            } else { 7 }
        },
    };
    if !fields.contains_key("schema") { return fields.len() == base; }
    if result["schema"] != "nodenetwork-existing-identity-network-v1" || result["membership_granted"] != false {
        return false;
    }
    let staged = fields.contains_key("stage_request_sha256");
    if staged && !lowercase_digest(&result["stage_request_sha256"]) { return false; }
    let attributed = fields.contains_key("request_sha256");
    if matches!(kind, IdentityEvidence::Preflight) && attributed
        || matches!(kind, IdentityEvidence::Generation) && !attributed { return false; }
    if attributed {
        let request = Request {version:1, operation:"identity_generate".into(),
            parameters:json!({"genesis_sha256":result["genesis_sha256"]})};
        if !lowercase_digest(&result["request_sha256"]) || result["request_sha256"] != request.approval_id() { return false; }
    }
    let scoped = if matches!(kind, IdentityEvidence::Preflight) { 2 } else { 1 };
    fields.len() == base + scoped + usize::from(staged) + usize::from(attributed)
}

pub(super) fn valid_validator_address(address: &str) -> bool {
    address.strip_prefix("synv1").is_some_and(|tail| {
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
        "identity_preflight" => identity_evidence(result, IdentityEvidence::Preflight),
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
        let request = Request {version:1, operation:"genesis_bind".into(), parameters:json!({"genesis_sha256":result["genesis_sha256"]})};
        if result["enrollment_sha256"] != enrollment_sha256 || result["request_sha256"] != request.approval_id() {
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

pub(super) fn supports_receipt_review(reply: &Value, read: &str) -> bool {
    qualified_software_target(reply, true, &[(read, "read")])
}

pub(super) fn genesis_receipt_status(reply: &Value, expected_request_digest: &str, receipt_field: &str) -> &'static str {
    if genesis_binding_reply(reply).is_err() { return "unsupported"; }
    // The validated binding response retains request_sha256 only for bound custody.
    // The independent stage_request_sha256 describes the three staged public inputs.
    match reply["result"].get(receipt_field).and_then(Value::as_str) {
        Some(value) if value == expected_request_digest => "match",
        Some(_) => "different",
        None => "absent",
    }
}

pub(super) fn formation_receipt_status(reply: &Value, expected_request_digest: &str) -> &'static str {
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) { return "unsupported"; }
    let Ok(report) = custody_status_reply("formation_status", reply) else { return "unsupported"; };
    let result = &report["result"];
    if result["pending"] == false { return "absent"; }
    if result["request_sha256"] == expected_request_digest { "match" } else { "different" }
}

pub(super) fn identity_receipt_status(reply: &Value, expected_request_digest: &str) -> (&'static str, &'static str) {
    if reply["version"]!=1 || !reply.as_object().is_some_and(|fields|fields.len()==3) {return ("unsupported","none");}
    let Ok(result)=custody_status_fields("identity_status",reply) else {return ("unsupported","none");};
    if result["pending"]==false {return ("absent","none");}
    // The optional owner receipt attributes custody to a durable identity
    // request. Without it, matching Genesis alone cannot identify its producer.
    let request=Request {version:1,operation:"identity_generate".into(),
        parameters:json!({"genesis_sha256":result["genesis_sha256"]})};
    let provenance=if result.get("request_sha256").is_some() {"identity_request"} else {"genesis_input"};
    (if request.approval_id()==expected_request_digest {"match"} else {"different"},provenance)
}

pub(super) fn exact_genesis_mutation_reply(reply: &Value) -> bool {
    reply["version"] == 1 && reply.as_object().is_some_and(|fields| fields.len() == 3)
        && match reply["ok"].as_bool() {
            Some(true) => reply["result"].is_object(),
            Some(false) => reply["error"].as_object().is_some_and(|fields| fields.len() == 2)
                && reply["error"]["code"].is_string() && reply["error"]["message"].is_string(),
            None => false,
        }
}

// Receipt identity fields are checked before a JSON object can discard duplicate
// keys. Genesis enrollment remains an exact string checked separately.
struct UniqueReceiptObject(serde_json::Map<String,Value>);

impl<'de> Deserialize<'de> for UniqueReceiptObject {
    fn deserialize<D: de::Deserializer<'de>>(decoder: D) -> Result<Self, D::Error> {
        struct UniqueFields;
        impl<'de> de::Visitor<'de> for UniqueFields {
            type Value = UniqueReceiptObject;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an owner receipt object with unique field names")
            }

            fn visit_map<M: de::MapAccess<'de>>(self, mut input: M) -> Result<Self::Value, M::Error> {
                let mut fields = serde_json::Map::new();
                while let Some(key) = input.next_key::<String>()? {
                    if fields.contains_key(&key) { return Err(de::Error::custom("duplicate owner receipt field")); }
                    let value = match key.as_str() {
                        "result" | "error" | "installation" => Value::Object(input.next_value::<UniqueReceiptObject>()?.0),
                        _ => input.next_value()?,
                    };
                    fields.insert(key, value);
                }
                Ok(UniqueReceiptObject(fields))
            }
        }
        decoder.deserialize_map(UniqueFields)
    }
}

pub(super) fn decode_receipt_reply(bytes: &[u8]) -> serde_json::Result<Value> {
    serde_json::from_slice::<UniqueReceiptObject>(bytes).map(|fields| Value::Object(fields.0))
}

fn genesis_bind_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    if !exact_genesis_mutation_reply(reply) { return Err(GENESIS_BIND_UNCERTAIN); }
    if reply["ok"] == false {
        let error = &reply["error"];
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("operation_refused"), Some("Reviewed Genesis changed")) =>
                ("operation_refused", "The signed Genesis differs from the reviewed input. Review staged Genesis binding again."),
            (Some("operation_refused"), Some("Genesis custody was already bound; use read-only reconciliation")) =>
                ("operation_refused", "The controller already reported bound custody. Review its binding status."),
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify this Genesis binding."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for Genesis binding."),
            _ => return Err(GENESIS_BIND_UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    if result["bound"] != true || result["genesis_sha256"] != request.parameters["genesis_sha256"] {
        return Err(GENESIS_BIND_UNCERTAIN);
    }
    genesis_binding_reply(reply).map_err(|_| GENESIS_BIND_UNCERTAIN)
}

fn genesis_stage_policy_reply(reply: &Value) -> Result<Value, &'static str> {
    const UNSUPPORTED: &str = "The selected controller returned unsupported Genesis staging policy evidence.";
    if reply["ok"] != true {
        return Err(match reply["error"]["code"].as_str() {
            Some("authorization_required") => "The controller could not confirm approved Genesis input pins. Review the policy with the node operator.",
            Some("reconciliation_required") => "The controller could not reconcile the existing state. Preserve the custody and staged inputs for operator review.",
            _ => "The controller could not confirm the Genesis staging policy. Review the prepared custody and staging state with the node operator.",
        });
    }
    let result = &reply["result"];
    if !reply.as_object().is_some_and(|fields| fields.len() == 3) || reply["version"] != 1
        || !result.as_object().is_some_and(|fields| fields.len() == 5)
        || result["schema"] != "nodenetwork-genesis-stage-policy-v1" || !validator_address(&result["address"])
        || ["genesis_sha256", "authority_sha256", "authority_root_sha256"]
            .iter().any(|key| !lowercase_digest(&result[*key])) {
        return Err(UNSUPPORTED);
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn formation_request_digest(pin: &Value) -> String {
    // Same restricted ASCII request used by owner canonical(), host grant and local journal.
    Request {version:1, operation:"formation_prepare".into(), parameters:json!({"formation_sha256":pin})}.approval_id()
}

fn custody_status_fields<'a>(operation: &str, reply: &'a Value) -> Result<&'a Value, &'static str> {
    const UNSUPPORTED: &str = "The selected controller returned unsupported pending custody evidence.";
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) {
        return Err(UNSUPPORTED);
    }
    if reply["ok"] != true {
        if reply["error"]["code"] == "reconciliation_required" {
            return Err("The controller could not verify pending custody. Preserve it and contact the node operator for reconciliation.");
        }
        return Err("The selected controller could not provide a pending custody status.");
    }
    let result = &reply["result"];
    let fields = result.as_object().ok_or(UNSUPPORTED)?;
    if result["pending"] == false && fields.len() == 1 {
        return Ok(result);
    }
    if result["pending"] != true || !validator_network_context(result) || !validator_address(&result["address"])
        || result["possession_verified"] != true || result["membership_granted"] != false {
        return Err(UNSUPPORTED);
    }
    let valid_kind = match operation {
        "identity_status" => identity_evidence(result, IdentityEvidence::Status),
        "formation_status" => fields.len() == 10 && result["schema"] == "nodenetwork-formation-v1"
            && ["formation_sha256", "formation_id", "request_sha256"].iter().all(|key| lowercase_digest(&result[*key]))
            && result["request_sha256"] == formation_request_digest(&result["formation_sha256"])
            && result["formation_id"].as_str().is_some_and(|id| id.bytes().any(|byte| byte != b'0')),
        _ => false,
    };
    if !valid_kind { return Err(UNSUPPORTED); }
    Ok(result)
}

fn custody_status_reply(operation: &str, reply: &Value) -> Result<Value, &'static str> {
    Ok(json!({"version":1,"ok":true,"result":custody_status_fields(operation,reply)?}))
}

#[cfg(test)]
pub(super) fn commission_pending_formation(reply: &Value) -> Result<Option<&Value>, &'static str> {
    let status = custody_status_fields("formation_status", reply)?;
    Ok((status["pending"] == true).then_some(status))
}

#[cfg(test)]
pub(super) fn require_formation_commission_binding(formation: &Value, reply: &Value) -> Result<(), &'static str> {
    // This consumes the native projection. The transport verifies the owner's
    // public enrollment and request digests and omits them from this response.
    let binding = &reply["result"];
    let matches = reply["version"] == 1 && reply["ok"] == true && reply.as_object().is_some_and(|fields| fields.len() == 3)
        && binding.as_object().is_some_and(|fields| fields.len() == 9) && binding["schema"] == "nodenetwork-genesis-binding-v1"
        && binding["bound"] == true && binding["genesis_authority_verified"] == true && binding["membership_verified"] == true
        && lowercase_digest(&binding["genesis_sha256"]) && binding["stage_receipt_verified"].is_boolean()
        && ["network_id", "chain_id", "address"].iter().all(|key| binding[*key] == formation[*key]);
    matches.then_some(()).ok_or("The controller could not confirm bound Genesis custody for the pending formation. Review custody before commissioning.")
}

fn identity_generation_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    const UNCERTAIN: &str = IDENTITY_GENERATION_UNCERTAIN;
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) { return Err(UNCERTAIN); }
    if reply["ok"] == false {
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(UNCERTAIN); }
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("operation_refused"), Some("The reviewed Genesis artifact changed; inspect it again")) =>
                ("operation_refused", "The signed Genesis differs from the reviewed input. Check existing-network inputs again."),
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify this identity preparation."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for this identity preparation."),
            _ => return Err(UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    if reply["ok"] != true || !identity_evidence(result, IdentityEvidence::Generation)
        || result["genesis_sha256"] != request.parameters["genesis_sha256"] {
        return Err(UNCERTAIN);
    }
    Ok(json!({"version":1,"ok":true,"result":result}))
}

fn formation_preparation_reply(request: &Request, reply: &Value) -> Result<Value, &'static str> {
    const UNCERTAIN: &str = FORMATION_PREPARATION_UNCERTAIN;
    if reply["version"] != 1 || !reply.as_object().is_some_and(|fields| fields.len() == 3) { return Err(UNCERTAIN); }
    if reply["ok"] == false {
        let error = &reply["error"];
        if !error.as_object().is_some_and(|fields| fields.len() == 2) { return Err(UNCERTAIN); }
        let (code, message) = match (error["code"].as_str(), error["message"].as_str()) {
            (Some("operation_refused"), Some("Reviewed formation context changed")) =>
                ("operation_refused", "The formation context differs from the reviewed input. Check formation inputs again."),
            (Some("qualification_required"), Some("Operation has not passed host qualification")) =>
                ("qualification_required", "The host policy does not qualify this formation preparation."),
            (Some("authorization_required"), Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                ("authorization_required", "A matching one-use host grant is required for formation preparation."),
            _ => return Err(UNCERTAIN),
        };
        return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
    }
    let result = &reply["result"];
    if result["pending"] != true || result["formation_sha256"] != request.parameters["formation_sha256"] {
        return Err(UNCERTAIN);
    }
    custody_status_reply("formation_status", reply).map_err(|_| UNCERTAIN)
}

fn health_reply(reply: &Value) -> Result<Value, &'static str> {
    if reply["result"]["schema"]=="nodenetwork-gateway-health-v1"{return crate::gateway_health::reply(reply)}
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

// Validate compatible owner acknowledgements before a mutation can close its
// journal fence. Keep the current full public DTO; projections are read models.
pub(super) fn vpn_stop_reconciliation(reply:&Value)->Result<Option<String>,String>{
 let result=&reply["result"];
 let request=Request{version:1,operation:"vpn_stop".into(),parameters:json!({})};
 if reply["version"]!=1||reply["ok"]!=true||reply.as_object().is_none_or(|v|v.len()!=3)||result.as_object().is_none_or(|v|v.len()!=5)||result["schema"]!="nodenetwork-vpn-stop-status-v1"||result["attempt_preserved"]!=true||result["provider_action"]!=false{return Err("Unsupported VPN stop observation; no journal outcome was changed".into())}
 if result["stopped"]==false&&result["request_sha256"].is_null(){return Ok(None)}
 if result["stopped"]==true&&result["request_sha256"]==request.approval_id(){return Ok(Some(request.approval_id()))}
 Err("VPN stop observation does not bind the exact consumed request".into())
}

pub(super) fn vpn_resume_reconciliation(reply:&Value)->Result<Option<String>,String>{
 let r=&reply["result"];let request=Request{version:1,operation:"vpn_resume".into(),parameters:json!({})};
 if reply["version"]!=1||reply["ok"]!=true||reply.as_object().is_none_or(|v|v.len()!=3)||r.as_object().is_none_or(|v|v.len()!=5||!["schema","resumed","request_sha256","validator_started","enrollment_preserved"].iter().all(|k|v.contains_key(*k)))||r["schema"]!="nodenetwork-vpn-resume-status-v1"||r["validator_started"]!=false||r["enrollment_preserved"]!=true{return Err("Unsupported VPN resume observation; no journal outcome changed".into())}
 if r["resumed"]==false&&r["request_sha256"].is_null(){return Ok(None)}
 if r["resumed"]==true&&r["request_sha256"]==request.approval_id(){return Ok(Some(request.approval_id()))}
 Err("VPN resume observation does not bind the exact consumed request".into())
}

pub(super) fn boot_policy_reconciliation(reply:&Value)->Result<Option<String>,String>{
 let invalid=||"Unsupported boot policy observation; no journal outcome changed".to_string();let r=&reply["result"];
 if reply["version"]!=1||reply["ok"]!=true||reply.as_object().is_none_or(|v|v.len()!=3)||r.as_object().is_none_or(|v|v.len()!=6||!["schema","node_enabled","vpn_enabled","applied","request_sha256","runtime_changed"].iter().all(|k|v.contains_key(*k)))||r["schema"]!="nodenetwork-boot-policy-status-v1"||!r["node_enabled"].is_boolean()||!r["vpn_enabled"].is_boolean()||r["runtime_changed"]!=false{return Err(invalid())}
 if r["applied"]==false&&r["request_sha256"].is_null(){return Ok(None)}
 if r["applied"]==true{for service in ["node","vpn"]{
  let request=Request{version:1,operation:"boot_policy".into(),parameters:json!({"service":service,"enabled":r[format!("{service}_enabled")]})};
  if r["request_sha256"]==request.approval_id(){return Ok(Some(request.approval_id()))}
 }}Err(invalid())
}

pub(super) fn mutation_acknowledgement(request:&Request,reply:Value)->Result<Value,String>{
 if !request.validate()? {return Ok(reply)}
 if !exact_genesis_mutation_reply(&reply){return Err("Controller mutation acknowledgement is ambiguous; inspect the original target before another change.".into())}
 if request.operation=="genesis_bind"&&reply["ok"]==false{return genesis_bind_reply(request,&reply).map_err(String::from)}
 let checked=match request.operation.as_str(){
  "install"=>install_reply(request,&reply),
  "upgrade"=>upgrade_reply(request,&reply),
  "register"=>register_service_reply(&reply),
  "vpn_stop"=>{
   if reply["ok"]==false {Err("VPN stop was refused; inspect target diagnostics before another action.")}
   else if reply["result"]==json!({"schema":"nodenetwork-vpn-stop-v1","stopped":true,"attempt_preserved":true,"provider_action":false}) {Ok(reply.clone())}
   else {Err("VPN stop outcome is uncertain; read target diagnostics before another action.")}
  },
  "vpn_resume"=>{
   if reply["ok"]==false&&reply["error"]["code"]=="vpn_resume_not_started"&&reply["error"]["message"]=="Active unresponsive VPN must be inspected; resume never restarts it"{Ok(reply.clone())}
   else if reply["ok"]==false{Err("VPN resume was refused; inspect original enrollment and diagnostics.")}
   else if reply["result"]==json!({"schema":"nodenetwork-vpn-resume-v1","resumed":true,"validator_started":false,"enrollment_preserved":true}){Ok(reply.clone())}
   else{Err("VPN resume outcome uncertain; read resume status before another action.")}
  },
  "boot_policy"=>{
   if reply["ok"]==true&&reply["result"]==json!({"schema":"nodenetwork-boot-policy-v1","service":request.parameters["service"],"enabled":request.parameters["enabled"],"runtime_changed":false}){Ok(reply.clone())}
   else{Err("Boot policy outcome uncertain; read boot policy status before another change.")}
  },
  "gateway_admission_prepare"|"gateway_admission_sign"=>crate::gateway_admission::acknowledgement(request,&reply).map_err(|_|"Gateway admission outcome uncertain; reconcile the exact original request before another change."),
  "gateway_install"|"gateway_target_generate"|"gateway_target_commission"=>crate::gateway_target::acknowledgement(request,&reply).map_err(|_|"Gateway target outcome uncertain; reconcile the exact original request before another change."),
  "commission"=>commissioning_reply(&reply),
  "start"|"stop"|"restart"=>node_service_reply(&request.operation,&reply),
  "identity_generate"=>identity_generation_reply(request,&reply),
  "formation_prepare"=>formation_preparation_reply(request,&reply),
  _=>Ok(reply.clone()),
 }.map_err(String::from)?;
 if checked["ok"]==false{return Ok(checked)}
 if request.operation=="gateway_install"{return Ok(checked)}
 if request.operation=="genesis_bind" && reply["ok"]==true {
  let evidence=crate::formation::reconcile_evidence("genesis_binding_preflight",&reply["result"])?;
  if evidence.is_none_or(|(op,pin)|op!="genesis_bind"||pin!=request.approval_id()){
   return Err(GENESIS_BIND_UNCERTAIN.into());
  }
 }
 if request.operation=="network_formation_sign" && reply["ok"]==true {
  let review=crate::network_formation::review(&reply["result"])?;
  if review["signed"]!=true||review["review_sha256"]!=request.parameters["review_sha256"]||review["sign_request_sha256"]!=request.approval_id(){
   return Err("Network signing outcome is uncertain; inspect the original formation before another change.".into());
  }
 }
 Ok(reply)
}

pub(super) async fn execute_pinned(target:Target,request:Request,control_dir:&Path,known_hosts:Option<&Path>)->Result<Value,String>{
    target.validate()?;request.validate()?;
    let wire=request.canonical().to_string();
    let input_limit=if request.operation=="genesis_stage"{12*1024*1024}else if matches!(request.operation.as_str(),"network_formation_prepare"|"network_transport_prepare"|"treasury_send_prepare"|"gateway_admission_prepare"|"gateway_admission_preflight"|"gateway_target_commission"|"gateway_target_commission_preflight"){2*1024*1024}else{REQUEST_LIMIT};
    let output_limit=if request.operation=="network_transport_export"{4*1024*1024+16384}else if matches!(request.operation.as_str(),"network_formation_export"|"treasury_send_preflight"){2*1024*1024}else{LIMIT};
    if wire.len()>=input_limit{return Err("Controller request exceeds the operation's safe wire limit.".into())}
    let _serial=SERIAL.lock().await;
    let reply=exchange(&target,wire.as_bytes(),if request.operation=="vpn_enroll"{240}else{180},control_dir,known_hosts,true,output_limit).await?;
    match request.operation.as_str(){
     "health"=>health_reply(&reply).map_err(String::from),
     "inventory"=>crate::node_removal_scope::inventory_reply(&reply).map_err(String::from),
     "r1_identity_preview"=>crate::r1_identity_creation::reply(&request,&reply).map_err(String::from),
     "install_preflight"=>install_preflight_reply(&request,&reply).map_err(String::from),
     "upgrade_preflight"=>upgrade_preflight_reply(&request,&reply).map_err(String::from),
     "uninstall_preflight"=>crate::node_removal_scope::reply(&reply).map_err(String::from),
     _=>Ok(reply),
    }
}

pub(super) async fn execute_locked(target: &Target, request: &Request, control_dir: &Path, known_hosts: Option<&Path>,
    _serial: &tokio::sync::MutexGuard<'_, ()>) -> Result<Value, String> {
    if request.validate()? && !cfg!(test){return Err("Use the dedicated authenticated native mutation workflow.".into())}
    let wire=request.canonical().to_string();
    let deadline=if request.operation == "vpn_enroll" { 240 } else { 180 };
    let strict=matches!(request.operation.as_str(),"genesis_bind"|"identity_preflight"|"identity_generate"|"identity_status");
    let value=exchange(target,wire.as_bytes(),deadline,control_dir,known_hosts,strict,LIMIT).await?;
    let result=match request.operation.as_str() {
        "health" => health_reply(&value),
        "diagnostics" => crate::node_diagnostics::reply(&value),
        "inventory" => crate::node_removal_scope::inventory_reply(&value),
        "r1_identity_preview" => crate::r1_identity_creation::reply(request,&value),
        "install_preflight" => install_preflight_reply(request, &value),
        "install" => install_reply(request, &value),
        "register" => register_service_reply(&value),
        "upgrade_preflight" => upgrade_preflight_reply(request, &value),
        "upgrade" => upgrade_reply(request, &value),
        "recovery_preflight" => recovery_preflight_reply(&value),
        "uninstall_preflight" => crate::node_removal_scope::reply(&value),
        "uninstall" => crate::node_removal_scope::removal_reply(&value),
        "vpn_status" => vpn_status_reply(&value),
        "identity_preflight" | "formation_preflight" => preparation_reply(&request.operation, &value),
        "genesis_binding_preflight" => genesis_binding_reply(&value),
        "genesis_bind" => genesis_bind_reply(request, &value),
        "genesis_stage_preflight" => genesis_stage_policy_reply(&value),
        "identity_status" | "formation_status" => custody_status_reply(&request.operation, &value),
        _ => Ok(value),
    };
    result.map_err(String::from)
}

pub(super) async fn execute_receipt_raw_locked(target:&Target,request:&Request,control_dir:&Path,
    _serial:&tokio::sync::MutexGuard<'_, ()>) -> Result<Value,String> {
    // Only the native journal comparison consumes these unprojected, fixed reads.
    if !matches!(request.operation.as_str(),"genesis_binding_preflight"|"formation_status"|"identity_status"|"diagnostics") || request.validate()? {
        return Err("Unsupported receipt review read.".into());
    }
    let strict=matches!(request.operation.as_str(),"diagnostics"|"identity_status");
    exchange(target,request.canonical().to_string().as_bytes(),180,control_dir,None,strict,LIMIT).await
}

async fn exchange(target:&Target,wire:&[u8],deadline:u64,control_dir:&Path,known_hosts:Option<&Path>,strict_receipt:bool,output_limit:u64) -> Result<Value,String> {
    target.validate()?;
    if !cfg!(unix) { return Err("This Portal platform has no qualified native controller transport.".into()); }
    let mut command = if target.kind=="local" {
        if !cfg!(all(target_os="linux",target_arch="x86_64")) { return Err("Local validators require Linux x86_64. Select an enrolled remote Linux target.".into()); }
        let mut c=tokio::process::Command::new("/usr/bin/sudo");
        c.args(["-n","/usr/bin/python3","-I","-B",CONTROLLER]); c
    } else {
        remote_command(target,control_dir,"synergy-nodenetwork",
            "/usr/bin/sudo -n /usr/bin/python3 -I -B /opt/synergy/tmp/controller/controller.py",known_hosts)?
    };
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    let mut child=command.spawn().map_err(|_|"Controller could not start. Enroll the target and verify its SSH host identity first.")?;
    let mut input=child.stdin.take().ok_or("Controller input unavailable.")?;
    let mut output=child.stdout.take().ok_or("Controller output unavailable.")?.take(output_limit+1);
    let result=tokio::time::timeout(Duration::from_secs(deadline),async {
        input.write_all(wire).await.map_err(|_|"Cannot send controller request.")?;
        input.write_all(b"\n").await.map_err(|_|"Cannot complete controller request.")?;
        drop(input);
        let mut bytes=Vec::new();
        output.read_to_end(&mut bytes).await.map_err(|_|"Cannot read controller response.")?;
        if bytes.len()>output_limit as usize { return Err("Controller response exceeds safe limit."); }
        let status=child.wait().await.map_err(|_|"Controller did not finish.")?;
        if !status.success() { return Err("Controller connection failed. Check enrolled target, pinned SSH identity, agent authentication and restricted sudo policy."); }
        let decoded=if strict_receipt {decode_receipt_reply(&bytes)} else {serde_json::from_slice(&bytes)};
        let value:Value=decoded.map_err(|_|"Controller returned an invalid response.")?;
        if value["version"]!=1 || !value["ok"].is_boolean() { return Err("Unsupported controller response."); }
        Ok(value)
    }).await;
    match result { Ok(value)=>value.map_err(String::from), Err(_)=>Err("Controller timed out. The result is uncertain; inspect target state before retrying a mutation.".into()) }
}

#[cfg(test)] mod tests {
    use super::*;

    #[test]fn live_acknowledgement_validation_precedes_successful_journal_settlement(){
      let request=Request{version:1,operation:"commission".into(),parameters:json!({})};
      let reply=json!({"version":1,"ok":true,"result":{"commissioned":true,"consensus_started":false,"production_approved":false}});
      assert_eq!(mutation_acknowledgement(&request,reply.clone()).unwrap(),reply);
      let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-ack-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
      struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(base.clone());
      let target=json!({"kind":"remote","host":"fixture.invalid","port":22,"root":ROOT});
      let dispatch=crate::request_journal::Dispatch::begin(&base,&target,"commission",&request.canonical()).unwrap();
      let mut invalid=reply;invalid["result"]["consensus_started"]=json!(true);
      let outcome=mutation_acknowledgement(&request,invalid);
      assert!(outcome.is_err());dispatch.finish(&outcome).unwrap();
      let records=crate::request_journal::inspect(&base).unwrap();
      assert_eq!(records["records"][0]["state"],"uncertain");assert_eq!(records["records"][0]["response_ok"],Value::Null);
      assert!(crate::request_journal::Dispatch::begin(&base,&target,"commission",&request.canonical()).is_err());
    }

    fn host_line(endpoint:&str,key:u8)->String{use base64::Engine as _;format!("{endpoint} ssh-ed25519 {}",base64::engine::general_purpose::STANDARD.encode([b"\0\0\0\x0bssh-ed25519\0\0\0\x20".as_slice(),&[key;32]].concat()))}
    fn host_target(host:&str,port:u16)->Target{Target{kind:"remote".into(),host:Some(host.into()),port:Some(port),root:ROOT.into(),guest:None}}
    #[test]fn fleet_host_authority_matches_exact_endpoint_and_never_ambient_bootstraps(){
        let a=host_line("host-a.example",1);let b=host_line("[host-b.example]:5619",2);let set=format!("{a}\n{b}");
        assert_eq!(approved_host_line(&host_target("HOST-A.EXAMPLE",22),Some(&set),None,true,true).unwrap(),Some(a));
        assert_eq!(approved_host_line(&host_target("host-b.example",5619),Some(&set),None,true,true).unwrap(),Some(b));
        for t in [host_target("host-b.example",22),host_target("host-a.example.evil",22)]{assert!(approved_host_line(&t,Some(&set),None,true,false).is_err());}
        assert!(approved_host_line(&host_target("host-a.example",22),None,None,true,true).is_err());
        assert!(approved_host_line(&host_target("host-a.example",22),Some(&set),None,false,true).is_err());
        let legacy=host_line("[127.0.0.1]:22280",9);assert_eq!(approved_host_line(&host_target("127.0.0.1",22280),None,Some(&legacy),true,true).unwrap(),Some(legacy));
    }
    #[test]fn fleet_host_authority_rejects_ambiguity_noncanonical_keys_and_more_than_five(){
        let t=host_target("host.example",22);let line=host_line("host.example",1);
        for raw in [format!("{line}\n{line}"),format!("{line}\n{}",host_line("host.example",2)),host_line("*.example",1),host_line("host.example,alias",1),"host.example ssh-ed25519 invalid".into(),format!("{line} trailing"),(0..6).map(|i|host_line(&format!("host-{i}.example"),i)).collect::<Vec<_>>().join("\n")]{assert!(approved_host_line(&t,Some(&raw),None,true,true).is_err());}
        assert!(approved_host_line(&t,Some(&line),Some(&host_line("[127.0.0.1]:22280",1)),true,true).is_err());
        let legacy=host_line("[127.0.0.1]:22280",1);assert!(approved_host_line(&host_target("127.0.0.1",22280),Some(&legacy),Some(&host_line("[127.0.0.1]:22280",2)),true,true).is_err());
    }
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
    #[test] fn journal_identity_matches_renderer_fingerprint() {
        for (kind, host, port, expected) in [
            ("local", None, None, "bfa32e15f03e31c0de48acabc75c1fb3e2ff4a56ef4ca28fceec50b46660ce8c"),
            ("remote", Some("VALIDATOR-FIXTURE.EXAMPLE.INVALID"), None, "a4e773da5aa21eeb3343b9c36a96eb291f869a097d54cc073186b44439ea252d"),
            ("remote", Some("[2001:db8::1234]"), Some(2222), "433726808e53d3ae7fbb9b35a38fa8214484666ec661987f6e5ad3b74e81e91e"),
        ] {
            let target = Target{kind:kind.into(),host:host.map(String::from),port,root:ROOT.into(),guest:None};
            assert!(target.validate().is_ok());
            assert_eq!(format!("{:x}",Sha256::digest(target.journal_identity().to_string().as_bytes())), expected);
        }
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
    #[test] fn vpn_diagnostics_is_parameterless_and_read_only() {
        let mut request=Request{version:1,operation:"vpn_diagnostics".into(),parameters:json!({})};
        assert!(!request.validate().unwrap());request.parameters=json!({"path":"/private","command":"up"});assert!(request.validate().is_err());
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
    #[test] fn recovery_preflight_has_fixed_read_scope_and_withholds_unsupported_evidence() {
        let mut request = Request{version:1,operation:"recovery_preflight".into(),parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"path":"/private/fixture"});
        assert!(request.validate().is_err());
        let reply = json!({"version":1,"ok":true,"result":{
            "qualified":false,"certifiedStateChanged":false,
            "blocker":"Checkpoint import is not exposed until the selected release recovery procedure is qualified"
        }});
        let projected = recovery_preflight_reply(&reply).unwrap();
        assert_eq!(projected["result"], json!({"qualified":false,"certifiedStateChanged":false}));
        for (field,value) in [
            ("qualified",json!(true)),
            ("certifiedStateChanged",json!(true)),
            ("blocker",json!("private fixture")),
            ("shell",json!("unexpected")),
        ] {
            let mut changed = reply.clone();
            changed["result"][field] = value;
            assert!(recovery_preflight_reply(&changed).is_err());
        }
        let refusal = json!({"version":1,"ok":false,"error":{"message":"private fixture"}});
        assert!(!recovery_preflight_reply(&refusal).unwrap_err().contains("private fixture"));
    }
    #[test] fn upgrade_preflight_requires_exact_package_references_and_reply() {
        let request = Request {version:1, operation:"upgrade_preflight".into(), parameters:json!({
            "release_id":"fixture-release","manifest_sha256":"a".repeat(64)
        })};
        assert_eq!(request.validate(), Ok(false));
        let reply = json!({"version":1,"ok":true,"result":{
            "packageVerified":true,"release":"fixture-release","automaticRestart":false
        }});
        assert_eq!(upgrade_preflight_reply(&request, &reply), Ok(reply.clone()));
        for (field, data) in [
            ("release", json!("different-release")),
            ("packageVerified", json!(false)),
            ("automaticRestart", json!(true)),
            ("extra", json!("private fixture")),
        ] {
            let mut invalid = reply.clone();
            invalid["result"][field] = data;
            assert!(upgrade_preflight_reply(&request, &invalid).is_err(), "{field}");
        }
        let refused = json!({"version":1,"ok":false,"error":{"code":"qualification_required","message":"fixture private path"}});
        assert_eq!(upgrade_preflight_reply(&request, &refused),
            Err("The controller could not confirm host approval for the staged update package."));
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
        for (key, value) in [("release",json!("another-release")), ("root",json!("/opt/Synergy")),
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
    #[test] fn vpn_status_is_an_empty_parameter_read() {
        let mut request = Request{version:1,operation:"vpn_status".into(),parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"address":"fixture"});
        assert!(request.validate().is_err());
    }
    #[test] fn node_service_actions_are_empty_mutations_with_exact_acknowledgements() {
        for operation in ["start","stop","restart"] {
            let mut request=Request{version:1,operation:operation.into(),parameters:json!({})};
            assert_eq!(request.validate(),Ok(true));
            request.parameters=json!({"service":"fixture"});
            assert!(request.validate().is_err());
            let result=json!({"requested":operation,"healthNotInferred":true});
            let reply=json!({"version":1,"ok":true,"result":result});
            assert_eq!(node_service_reply(operation,&reply),Ok(reply));
            assert!(node_service_reply(operation,&json!({"version":1,"ok":true,"result":result,"metadata":"fixture"})).is_err());
            for invalid in [json!({"requested":"another","healthNotInferred":true}),
                            json!({"requested":operation,"healthNotInferred":false}),
                            json!({"requested":operation,"healthNotInferred":true,"ready":true})] {
                assert!(node_service_reply(operation,&json!({"version":1,"ok":true,"result":invalid})).is_err());
            }
        }
    }
    #[test] fn invalid_target_cannot_reach_node_service_transport() {
        let target=Target{kind:"test-invalid".into(),host:None,port:None,root:ROOT.into(),guest:None};
        let request=Request{version:1,operation:"stop".into(),parameters:json!({})};
        let result=tauri::async_runtime::block_on(execute(target,request,Path::new("unused-test-scope")));
        assert!(result.unwrap_err().contains("enrolled remote hostname"));
    }
    #[test] fn node_service_replies_distinguish_exact_owner_refusals_from_uncertain_outcomes() {
        let refused=|code,message| json!({"version":1,"ok":false,"error":{"code":code,"message":message}});
        let vpn=refused("vpn_readiness_required","Current native VPN must match the recorded, independently server-bound validator peer");
        assert_eq!(node_service_reply("start",&vpn).unwrap()["error"]["code"],"vpn_readiness_required");
        assert_eq!(node_service_reply("restart",&vpn).unwrap()["error"]["code"],"vpn_readiness_required");
        assert!(node_service_reply("stop",&vpn).is_err());
        for (code,message) in [
            ("qualification_required","Operation has not passed host qualification"),
            ("authorization_required","Exact request needs one-time host operator authorization"),
            ("authorization_required","Host authorization expired or differs"),
        ] {
            let result=node_service_reply("start",&refused(code,message)).unwrap();
            assert_eq!(result["ok"],false);
            assert_eq!(result["error"]["code"],code);
            assert_ne!(result["error"]["message"],message);
        }
        for code in ["qualification_required","authorization_required","vpn_readiness_required","operation_refused"] {
            let error=node_service_reply("start",&refused(code,"fixture private detail")).unwrap_err();
            assert!(error.contains("outcome is uncertain"));
            assert!(!error.contains("fixture"));
        }
    }
    #[cfg(unix)]
    #[test] fn node_service_ambiguous_acknowledgement_fences_start_without_inferring_health() {
        use crate::request_journal::{inspect,Dispatch};
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nodenetwork-start-journal-{}-{stamp}",std::process::id()));
        let target=json!({"kind":"remote","host":"fixture.invalid","port":22,"root":ROOT});
        let request=Request{version:1,operation:"start".into(),parameters:json!({})}.canonical();
        let run=|reply| {
            Dispatch::begin(&base,&target,"start",&request).unwrap()
                .finish(&node_service_reply("start",&reply).map_err(String::from)).unwrap();
        };
        run(json!({"version":1,"ok":true,"result":{"requested":"start","healthNotInferred":true}}));
        run(json!({"version":1,"ok":true,"result":{"requested":"restart","healthNotInferred":true}}));
        let history=inspect(&base).unwrap();
        let records=history["records"].as_array().unwrap();
        assert!(records.iter().any(|row| row["operation"] == "start" && row["state"] == "response_received" && row["response_ok"] == true));
        assert!(records.iter().any(|row| row["operation"] == "start" && row["state"] == "uncertain" && row["response_ok"].is_null()));
        assert!(Dispatch::begin(&base,&target,"start",&request).is_err());
        assert!(!history.to_string().contains("health"));
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test] fn vpn_enrollment_is_a_fixed_empty_mutation() {
        let mut request = Request{version:1,operation:"vpn_enroll".into(),parameters:json!({})};
        assert_eq!(request.validate(), Ok(true));
        assert_eq!(request.canonical().to_string(), r#"{"operation":"vpn_enroll","parameters":{},"version":1}"#);
        for forbidden in [json!({"setup_key":"fixture"}),json!({"enrollment_sha256":"fixture"}),json!({"management_url":"fixture"}),json!(null),json!([])] {
            request.parameters = forbidden;
            assert!(request.validate().is_err());
        }
    }
    #[test] fn vpn_enrollment_projects_reported_recording_and_retains_uncertain_results() {
        let mut reply = json!({"version":1,"ok":true,"result":{
            "schema":"nodenetwork-vpn-status-v1","service_registered":true,"enrollment_staged":false,
            "enrollment_recorded":true,"reconciliation_required":false,"server_bound":false,"connected":true,
            "overlay_address":"100.80.10.4/16"
        }});
        let projected = vpn_enrollment_reply(&reply).unwrap();
        assert_eq!(projected["result"]["enrollment_recorded"], true);
        assert_eq!(projected["result"]["server_bound"], false);
        assert!(projected["result"].get("overlay_address").is_none());
        let refused = |code,message| json!({"version":1,"ok":false,"error":{"code":code,"message":message}});
        for (code,message) in [
            ("qualification_required", "Operation has not passed host qualification"),
            ("authorization_required", "No approved one-use VPN enrollment is staged"),
            ("authorization_required", "Exact request needs one-time host operator authorization"),
            ("authorization_required", "Host authorization expired or differs"),
            ("authorization_required", "One-time host grant does not bind this VPN enrollment"),
        ] {
            let sanitized = vpn_enrollment_reply(&refused(code,message)).unwrap();
            assert_eq!(sanitized["ok"], false);
            assert_eq!(sanitized["error"]["code"], code);
            assert!(!sanitized.to_string().contains(message));
        }
        for code in ["authorization_required", "qualification_required", "vpn_reconciliation_required", "operation_refused", "unknown"] {
            let uncertain = vpn_enrollment_reply(&refused(code,"fixture private details")).unwrap_err();
            assert!(uncertain.contains("outcome is uncertain"));
            assert!(!uncertain.contains("fixture private details"));
        }
        reply["result"]["enrollment_staged"] = json!(true);
        assert!(vpn_enrollment_reply(&reply).is_err());
        reply["result"]["enrollment_staged"] = json!(false);
        reply["result"]["enrollment_recorded"] = json!(false);
        reply["result"]["connected"] = json!(false);
        reply["result"]["overlay_address"] = Value::Null;
        assert!(vpn_enrollment_reply(&reply).is_err());
    }
    #[cfg(unix)]
    #[test] fn vpn_enrollment_journal_preserves_the_target_fence_for_ambiguous_outcome() {
        use crate::request_journal::{inspect, Dispatch};
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().canonicalize().unwrap().join(format!("nodenetwork-vpn-journal-{}-{stamp}",std::process::id()));
        let target = json!({"kind":"remote","host":"fixture.invalid","port":22,"root":ROOT});
        let request = Request{version:1,operation:"vpn_enroll".into(),parameters:json!({})}.canonical();
        let run = |code,message| {
            let dispatch = Dispatch::begin(&base,&target,"vpn_enroll",&request).unwrap();
            let reply = json!({"version":1,"ok":false,"error":{"code":code,"message":message}});
            dispatch.finish(&vpn_enrollment_reply(&reply).map_err(String::from)).unwrap();
        };
        run("authorization_required","No approved one-use VPN enrollment is staged");
        run("vpn_reconciliation_required","fixture private details");
        let history = inspect(&base).unwrap();
        let records = history["records"].as_array().unwrap();
        assert!(records.iter().any(|row| row["operation"] == "vpn_enroll" && row["state"] == "response_received" && row["response_ok"] == false));
        assert!(records.iter().any(|row| row["operation"] == "vpn_enroll" && row["state"] == "uncertain" && row["response_ok"].is_null()));
        assert!(Dispatch::begin(&base,&target,"vpn_enroll",&request).is_err());
        assert!(!history.to_string().contains("fixture"));
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test] fn vpn_status_validates_owner_shape_and_keeps_extra_reply_metadata_private() {
        let mut reply = json!({"version":1,"ok":true,"internal":"unreviewed fixture","result":{
            "schema":"nodenetwork-vpn-status-v1","service_registered":true,"enrollment_staged":false,
            "enrollment_recorded":true,"reconciliation_required":false,"server_bound":false,"connected":true,
            "overlay_address":"100.80.10.4/16"
        }});
        let projected = vpn_status_reply(&reply).unwrap();
        assert_eq!(projected["result"],json!({
            "schema":"nodenetwork-vpn-status-v1","service_registered":true,"enrollment_staged":false,
            "enrollment_recorded":true,"reconciliation_required":false,"server_bound":false,"connected":true
        }));
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
        for operation in ["formation_prepare", "genesis_bind"] {
            let request = Request{version:1,operation:operation.into(),parameters:json!({})};
            assert!(request.validate().is_err());
        }
    }
    #[test] fn reviewed_identity_receipt_refuses_duplicate_pending_or_genesis_fields() {
        for raw in [
            r#"{"version":1,"ok":true,"result":{"pending":true,"p\u0065nding":false}}"#,
            r#"{"version":1,"ok":true,"result":{"genesis_sha256":"first","genesis_sha256":"second"}}"#,
        ] {
            assert!(decode_receipt_reply(raw.as_bytes()).is_err());
        }
    }
    #[test] fn custody_status_keeps_pending_identity_and_formation_contracts_distinct() {
        let mut reply = json!({"version":1,"ok":true,"internal":"unreviewed fixture","result":{
            "pending":true,"network_id":"fixture-network","chain_id":"18446744073709551615",
            "genesis_sha256":"a".repeat(64),"genesis_authority_verified":true,"address":"synv1".to_string()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false
        }});
        assert!(custody_status_reply("identity_status", &reply).is_err());
        reply.as_object_mut().unwrap().remove("internal");
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
            "request_sha256":"3d1a736fbc86a3e25a10764739cb3b53e31e4d070c3dfe546b648e73c8b7979d","address":"synv1".to_string()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false});
        reply["internal"] = json!("unreviewed fixture");
        assert!(custody_status_reply("formation_status", &reply).is_err());
        reply.as_object_mut().unwrap().remove("internal");
        assert!(custody_status_reply("formation_status", &reply).is_ok());
        assert!(custody_status_reply("identity_status", &reply).is_err());
        reply["result"]["request_sha256"] = json!("c".repeat(64));
        assert!(custody_status_reply("formation_status", &reply).is_err());
        reply["result"]["request_sha256"] = json!("3d1a736fbc86a3e25a10764739cb3b53e31e4d070c3dfe546b648e73c8b7979d");
        reply["result"]["chain_id"] = json!("18446744073709551616");
        assert!(custody_status_reply("formation_status", &reply).is_err());
        reply["result"] = json!({"pending":false});
        assert!(custody_status_reply("identity_status", &reply).is_ok());
        assert!(custody_status_reply("formation_status", &reply).is_ok());
        assert!(custody_status_reply("identity_status", &json!({"version":1,"ok":false,"error":{"code":"reconciliation_required","message":"private fixture"}}))
            .unwrap_err().contains("Preserve it"));
    }
    #[test] fn preparation_reads_are_independent_empty_parameter_operations() {
        for operation in ["identity_preflight", "formation_preflight"] {
            let mut request = Request {version:1, operation:operation.into(), parameters:json!({})};
            assert_eq!(request.validate(), Ok(false));
            request.parameters = json!({"genesis_sha256":"a".repeat(64)});
            assert!(request.validate().is_err());
        }
        for operation in ["formation_prepare", "genesis_stage", "genesis_bind"] {
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

    #[test] fn formation_preparation_requires_the_owner_canonical_digest_and_public_custody() {
        let pin="a".repeat(64);
        let sha="3d1a736fbc86a3e25a10764739cb3b53e31e4d070c3dfe546b648e73c8b7979d";
        let mut request=Request{version:1,operation:"formation_prepare".into(),parameters:json!({"formation_sha256":pin})};
        assert_eq!(request.validate(),Ok(true));
        assert_eq!(request.canonical().to_string(),format!(r#"{{"operation":"formation_prepare","parameters":{{"formation_sha256":"{pin}"}},"version":1}}"#));
        assert_eq!(request.approval_id(),sha);
        for invalid in [json!({}),json!({"formation_sha256":"a".repeat(63)+"\n"}),
                        json!({"formation_sha256":pin,"registration_json":"fixture"}),json!({"genesis_sha256":pin})] {
            request.parameters=invalid;
            assert!(request.validate().is_err());
        }
        request.parameters=json!({"formation_sha256":pin});
        let result=json!({"schema":"nodenetwork-formation-v1","pending":true,"network_id":"fixture-formation","chain_id":"1266",
            "formation_sha256":pin,"formation_id":"b".repeat(64),"request_sha256":sha,"address":"synv1".to_owned()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false});
        let wrap=|result|json!({"version":1,"ok":true,"result":result});
        assert_eq!(formation_preparation_reply(&request,&wrap(result.clone())),Ok(json!({"version":1,"ok":true,"result":result})));
        for (key,value) in [("formation_sha256",json!("e".repeat(64))),("request_sha256",json!("b".repeat(64))),
            ("pending",json!(false)),("membership_granted",json!(true)),("possession_verified",json!(false)),("registration_json",json!("fixture"))] {
            let mut altered=result.clone();
            altered[key]=value;
            assert!(formation_preparation_reply(&request,&wrap(altered)).unwrap_err().contains("outcome is uncertain"));
        }
        let mut other=result;
        other["formation_sha256"]=json!("b".repeat(64));
        other["request_sha256"]=json!(formation_request_digest(&other["formation_sha256"]));
        assert!(custody_status_reply("formation_status",&wrap(other.clone())).is_ok());
        assert!(formation_preparation_reply(&request,&wrap(other)).is_err());
    }

    #[cfg(unix)]
    #[test] fn formation_reconciliation_read_does_not_clear_the_dispatch_fence() {
        use crate::request_journal::{inspect,Dispatch};
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nodenetwork-formation-journal-{}-{stamp}",std::process::id()));
        let target=json!({"kind":"remote","host":"fixture.invalid","port":22,"root":ROOT});
        let request=Request{version:1,operation:"formation_prepare".into(),parameters:json!({"formation_sha256":"a".repeat(64)})};
        let response=|message|json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":message}});
        for message in ["Reviewed formation context changed","fixture unknown custody failure"] {
            Dispatch::begin(&base,&target,&request.operation,&request.canonical()).unwrap()
                .finish(&formation_preparation_reply(&request,&response(message)).map_err(String::from)).unwrap();
        }
        let history=inspect(&base).unwrap();
        let records=history["records"].as_array().unwrap();
        assert!(records.iter().any(|row| row["operation"] == "formation_prepare" && row["request_digest"] == request.approval_id()
            && row["state"] == "uncertain" && row["response_ok"].is_null()));
        assert!(records.iter().any(|row| row["operation"] == "formation_prepare" && row["state"] == "response_received" && row["response_ok"] == false));
        let status=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-formation-v1","pending":true,
            "network_id":"fixture-formation","chain_id":"1266","formation_sha256":"a".repeat(64),"formation_id":"b".repeat(64),
            "request_sha256":request.approval_id(),"address":"synv1".to_owned()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false}});
        assert!(custody_status_reply("formation_status",&status).is_ok());
        assert_eq!(inspect(&base).unwrap(),history);
        assert!(Dispatch::begin(&base,&target,&request.operation,&request.canonical()).is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    fn scoped_identity_fixture() -> (Request,Value) {
        let request=Request{version:1,operation:"identity_generate".into(),parameters:json!({"genesis_sha256":"b".repeat(64)})};
        let result=json!({"network_id":"test-network","chain_id":"999999","genesis_sha256":"b".repeat(64),
            "genesis_authority_verified":true,"schema":"nodenetwork-existing-identity-network-v1",
            "membership_granted":false,"address":"synv11lrh6jcxaejkj4zv994j7qwn2rk6u3ar4emn",
            "possession_verified":true,"request_sha256":request.approval_id()});
        (request,result)
    }

    #[test] fn identity_generation_scoped_owner_receipt_binds_exact_canonical_request() {
        let (request,result)=scoped_identity_fixture();
        assert_eq!(request.approval_id(),"31f7fc6d1f59c72c450c45c0c8c1f3e307ea7b038d9459d14a3aaca37626892e");
        let mut preflight=result.clone();
        for key in ["address","possession_verified","request_sha256"] {preflight.as_object_mut().unwrap().remove(key);}
        for staged in [false,true] {
            let mut result=result.clone();
            let mut preflight=preflight.clone();
            if staged {
                result["stage_request_sha256"]=json!("c".repeat(64));
                preflight["stage_request_sha256"]=json!("c".repeat(64));
            }
            let wrap=|result|json!({"version":1,"ok":true,"result":result});
            assert_eq!(preparation_reply("identity_preflight",&wrap(preflight.clone())),Ok(wrap(preflight)));
            assert_eq!(identity_generation_reply(&request,&wrap(result.clone())),Ok(wrap(result)));
        }
        for (key,value) in [("request_sha256",Value::Null),("request_sha256",json!("a".repeat(64))),
            ("request_sha256",json!(request.approval_id()+"\n")),("stage_request_sha256",Value::Null),
            ("schema",json!("future-v2")),("membership_granted",json!(true)),("private_metadata",json!("excluded"))] {
            let mut altered=result.clone();
            altered[key]=value;
            assert!(identity_generation_reply(&request,&json!({"version":1,"ok":true,"result":altered})).is_err(),"{key}");
        }
        let mut missing=result;
        missing.as_object_mut().unwrap().remove("request_sha256");
        assert!(identity_generation_reply(&request,&json!({"version":1,"ok":true,"result":missing})).is_err());
    }

    #[test] fn identity_generation_scoped_status_distinguishes_durable_receipt_from_input_only() {
        let (request,mut pending)=scoped_identity_fixture();
        pending["pending"]=json!(true);
        let wrap=|result|json!({"version":1,"ok":true,"result":result});
        assert_eq!(identity_receipt_status(&wrap(pending.clone()),&request.approval_id()),("match","identity_request"));
        assert_eq!(identity_receipt_status(&wrap(pending.clone()),&"c".repeat(64)),("different","identity_request"));
        for attributed in [true,false] {
            let mut current=pending.clone();
            if !attributed {current.as_object_mut().unwrap().remove("request_sha256");}
            current["stage_request_sha256"]=json!("c".repeat(64));
            assert!(custody_status_reply("identity_status",&wrap(current.clone())).is_ok());
            assert_eq!(identity_receipt_status(&wrap(current),&request.approval_id()),
                ("match",if attributed {"identity_request"} else {"genesis_input"}));
        }
        for (key,value) in [("request_sha256",Value::Null),("request_sha256",json!("c".repeat(64))),
            ("stage_request_sha256",json!("c".repeat(63)+"\n")),("schema",Value::Null)] {
            let mut altered=pending.clone();altered[key]=value;
            assert_eq!(identity_receipt_status(&wrap(altered),&request.approval_id()),("unsupported","none"));
        }
        let mut without_schema=pending.clone();without_schema.as_object_mut().unwrap().remove("schema");
        assert_eq!(identity_receipt_status(&wrap(without_schema),&request.approval_id()),("unsupported","none"));
        let refused=json!({"version":1,"ok":false,"error":{"code":"reconciliation_required","message":"private fixture"}});
        assert_eq!(identity_receipt_status(&refused,&request.approval_id()),("unsupported","none"));
        let duplicate=format!(r#"{{"version":1,"ok":true,"result":{{"request_sha256":"{}","request_sha256":"{}"}}}}"#,request.approval_id(),request.approval_id());
        assert!(decode_receipt_reply(duplicate.as_bytes()).is_err());
    }

    #[test] fn identity_generation_requires_only_exact_genesis_sha256_and_projects_public_custody() {
        let pin="a".repeat(64);
        let mut request=Request{version:1,operation:"identity_generate".into(),parameters:json!({"genesis_sha256":pin})};
        assert_eq!(request.validate(),Ok(true));
        for invalid in [json!({}),json!({"genesis_sha256":"a".repeat(63)+"\n"}),json!({"genesis_sha256":"A".repeat(64)}),
                        json!({"genesis_sha256":pin,"unlock":"fixture"})] {
            request.parameters=invalid;
            assert!(request.validate().is_err());
        }
        request.parameters=json!({"genesis_sha256":pin});
        let public=json!({"network_id":"fixture-testnet","chain_id":"1266","genesis_sha256":pin,
            "genesis_authority_verified":true,"address":"synv1".to_owned()+&"a".repeat(36),
            "possession_verified":true,"membership_granted":false});
        let wrap=|result| json!({"version":1,"ok":true,"result":result});
        assert_eq!(identity_generation_reply(&request,&wrap(public.clone())),Ok(json!({"version":1,"ok":true,"result":public})));
        for (key,value) in [("genesis_sha256",json!("b".repeat(64))),("chain_id",json!("1266\n")),("possession_verified",json!(false)),
            ("genesis_authority_verified",json!(false)),("membership_granted",json!(true)),("unlock",json!("fixture"))] {
            let mut altered=public.clone();
            altered[key]=value;
            assert!(identity_generation_reply(&request,&wrap(altered)).unwrap_err().contains("outcome is uncertain"));
        }
    }

    #[cfg(unix)]
    #[test] fn identity_generation_known_refusal_and_ambiguous_reply_preserve_journal_scope() {
        use crate::request_journal::{inspect,Dispatch};
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nodenetwork-identity-journal-{}-{stamp}",std::process::id()));
        let target=json!({"kind":"remote","host":"fixture.invalid","port":22,"root":ROOT});
        let request=Request{version:1,operation:"identity_generate".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
        let response=|message|json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":message}});
        for message in ["The reviewed Genesis artifact changed; inspect it again","fixture unknown custody failure"] {
            let dispatch=Dispatch::begin(&base,&target,&request.operation,&request.canonical()).unwrap();
            dispatch.finish(&identity_generation_reply(&request,&response(message)).map_err(String::from)).unwrap();
        }
        let history=inspect(&base).unwrap();
        let records=history["records"].as_array().unwrap();
        assert!(records.iter().any(|row| row["operation"] == "identity_generate" && row["state"] == "response_received" && row["response_ok"] == false));
        assert!(records.iter().any(|row| row["operation"] == "identity_generate" && row["state"] == "uncertain" && row["response_ok"].is_null()));
        assert!(Dispatch::begin(&base,&target,&request.operation,&request.canonical()).is_err());
        assert!(!history.to_string().contains("fixture"));
        std::fs::remove_dir_all(base).unwrap();
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
            value["result"]["request_sha256"] = json!("0e8a5f309948535cbc5fa7fdb13f298d053a1d964d673646d247a1008649463e");
        }
        value
    }
    #[test] fn genesis_binding_preflight_is_a_fixed_read() {
        let mut request = Request {version:1, operation:"genesis_binding_preflight".into(), parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"genesis_sha256":"a".repeat(64)});
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
            (genesis_binding_fixture(true),"request_sha256",json!("b".repeat(64))),
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
    #[test] fn genesis_bind_mutation_uses_the_exact_owner_pin_and_public_receipt() {
        let pin="a".repeat(64);
        let mut request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":pin})};
        assert_eq!(request.validate(),Ok(true));
        assert_eq!(request.canonical().to_string(),format!(r#"{{"operation":"genesis_bind","parameters":{{"genesis_sha256":"{pin}"}},"version":1}}"#));
        assert_eq!(request.approval_id(),"0e8a5f309948535cbc5fa7fdb13f298d053a1d964d673646d247a1008649463e");
        for invalid in [json!({}),json!({"genesis_sha256":"a".repeat(63)+"\n"}),
                        json!({"genesis_sha256":pin,"enrollment_json":"excluded"}),json!({"formation_sha256":pin})] {
            request.parameters=invalid;
            assert!(request.validate().is_err());
        }
        request.parameters=json!({"genesis_sha256":pin});
        let bound=genesis_binding_fixture(true);
        let projected=genesis_bind_reply(&request,&bound).unwrap();
        assert_eq!(projected,genesis_binding_reply(&bound).unwrap());
        assert_eq!(projected["result"]["stage_receipt_verified"],false);
        assert!(!projected.to_string().contains("synthetic"));
        let mut staged=bound.clone();
        staged["result"]["stage_request_sha256"]=json!("c".repeat(64));
        assert_eq!(genesis_bind_reply(&request,&staged).unwrap()["result"]["stage_receipt_verified"],true);
        assert!(genesis_bind_reply(&request,&genesis_binding_fixture(false)).is_err());
        let mut other=bound;
        other["result"]["genesis_sha256"]=json!("b".repeat(64));
        let other_request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":"b".repeat(64)})};
        other["result"]["request_sha256"]=json!(other_request.approval_id());
        assert!(genesis_binding_reply(&other).is_ok());
        assert!(genesis_bind_reply(&request,&other).unwrap_err().contains("outcome is uncertain"));
    }

    #[test] fn genesis_bind_scope_is_required_only_for_binding_and_rendered_from_validated_fields() {
        let request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
        let fixture=json!({"networkId":"fixture-network","chainId":"18446744073709551615",
            "validatorAddress":"synv1".to_owned()+&"a".repeat(36)});
        let valid=serde_json::from_value(fixture.clone()).unwrap();
        let review=GenesisBindingReview::for_request(&request,Some(valid)).unwrap().unwrap();
        let details=review.confirmation_details(&request);
        for line in ["Reviewed validator: synv1", "Network incarnation: fixture-network", "Chain ID: 18446744073709551615", "Genesis SHA-256: aaaa"] {
            assert!(details.contains(line));
        }
        assert!(GenesisBindingReview::for_request(&request,None).is_err());
        for (key,value) in [("networkId",json!("fixture-network\n")),("chainId",json!("01266")),("validatorAddress",json!("synv1wrong"))] {
            let mut invalid=fixture.clone();
            invalid[key]=value;
            assert!(GenesisBindingReview::for_request(&request,Some(serde_json::from_value(invalid).unwrap())).is_err());
        }
        let read=Request{version:1,operation:"health".into(),parameters:json!({})};
        assert!(GenesisBindingReview::for_request(&read,Some(review)).is_err());
        assert!(GenesisBindingReview::for_request(&read,None).unwrap().is_none());
    }

    #[test] fn genesis_bind_refusals_require_the_exact_owner_envelope() {
        let request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
        let refusal=json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"Host authorization expired or differs"}});
        assert_eq!(genesis_bind_reply(&request,&refusal).unwrap()["ok"],false);
        for (path,value) in [("/version",json!(2)),("/ok",json!("false")),("/error/message",json!("private fixture"))] {
            let mut malformed=refusal.clone();
            *malformed.pointer_mut(path).unwrap()=value;
            assert_eq!(genesis_bind_reply(&request,&malformed),Err(GENESIS_BIND_UNCERTAIN));
        }
        let mut extra_error=refusal.clone();
        extra_error["error"]["detail"]=json!("private fixture");
        let mut extra_reply=refusal;
        extra_reply["result"]=Value::Null;
        let mut extra_success=genesis_binding_fixture(true);
        extra_success["error"]=Value::Null;
        for malformed in [extra_error,extra_reply,extra_success] {
            assert_eq!(genesis_bind_reply(&request,&malformed),Err(GENESIS_BIND_UNCERTAIN));
        }
    }

    #[test] fn genesis_bind_and_stage_reject_ambiguous_raw_response_keys() {
        let valid=genesis_binding_fixture(true);
        assert_eq!(decode_receipt_reply(valid.to_string().as_bytes()).unwrap(),valid);
        for wire in [
            r#"{"version":1,"ok":true,"o\u006b":false,"error":{"code":"x","message":"y"}}"#,
            r#"{"version":1,"ok":false,"error":{"code":"x","message":"old","message":"new"}}"#,
            r#"{"version":1,"ok":true,"result":{"staged":false,"staged":true}}"#,
            r#"{"version":1,"ok":true,"result":{"bound":false,"boun\u0064":true}}"#,
        ] {
            assert!(decode_receipt_reply(wire.as_bytes()).is_err());
        }
    }

    #[test] fn reviewed_upgrade_receipt_rejects_ambiguous_raw_installation_identity() {
        let raw=r#"{"version":1,"ok":true,"result":{"installation":{"package_sha256":"first","package_sha\u0032\u0035\u0036":"second"}}}"#;
        assert!(decode_receipt_reply(raw.as_bytes()).is_err());
    }

    #[test] fn genesis_stage_and_bind_target_gate_requires_exact_distinct_owner_capabilities() {
        let stage=|operation,kind| json!({"operation":operation,"kind":kind,"available":true,"blocker":null});
        let controller=|operations|json!({"version":1,"ok":true,"result":{"controllerVersion":1,"platform":"linux",
            "architecture":"x86_64","root":ROOT,"installed":true,"localValidatorSupported":true,
            "communityEnrollment":false,"operations":operations}});
        let stage_ops=vec![stage("genesis_stage","mutation"),stage("formation_status","read"),stage("genesis_stage_preflight","read")];
        let stage_report=controller(stage_ops.clone());
        assert_eq!(require_genesis_target(&stage_report,"genesis_stage"),Ok(()));
        assert!(require_genesis_target(&stage_report,"genesis_bind").is_err());
        assert_eq!(require_genesis_target(&controller(vec![stage("genesis_bind","mutation"),stage("genesis_binding_preflight","read")]),"genesis_bind"),Ok(()));
        for (path,value) in [("/result/root",json!("/opt/Synergy")),("/result/installed",json!(false)),
            ("/result/communityEnrollment",json!(true)),("/result/operations/0/kind",json!("read")),
            ("/result/operations/0/blocker",json!("private fixture")),("/result/operations/1/available",json!(false))] {
            let mut malformed=stage_report.clone();
            *malformed.pointer_mut(path).unwrap()=value;
            assert!(require_genesis_target(&malformed,"genesis_stage").is_err(),"{path}");
        }
        let mut duplicate=stage_ops;
        duplicate.push(stage("genesis_stage_preflight","read"));
        assert!(require_genesis_target(&controller(duplicate),"genesis_stage").is_err());
    }

    #[cfg(unix)]
    #[test] fn genesis_bind_uncertainty_preserves_the_journal_and_separate_read() {
        use crate::request_journal::{inspect,Dispatch};
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nodenetwork-binding-journal-{}-{stamp}",std::process::id()));
        let target=json!({"kind":"remote","host":"fixture.invalid","port":22,"root":ROOT});
        let request=Request{version:1,operation:"genesis_bind".into(),parameters:json!({"genesis_sha256":"a".repeat(64)})};
        for message in ["Reviewed Genesis changed","fixture unknown binding failure"] {
            let reply=json!({"version":1,"ok":false,"error":{"code":"operation_refused","message":message}});
            Dispatch::begin(&base,&target,&request.operation,&request.canonical()).unwrap()
                .finish(&genesis_bind_reply(&request,&reply).map_err(String::from)).unwrap();
        }
        let history=inspect(&base).unwrap();
        let records=history["records"].as_array().unwrap();
        assert!(records.iter().any(|row| row["operation"] == "genesis_bind" && row["request_digest"] == request.approval_id()
            && row["state"] == "uncertain" && row["response_ok"].is_null()));
        assert!(records.iter().any(|row| row["operation"] == "genesis_bind" && row["state"] == "response_received" && row["response_ok"] == false));
        assert!(genesis_binding_reply(&genesis_binding_fixture(true)).is_ok());
        assert_eq!(inspect(&base).unwrap(),history);
        assert!(Dispatch::begin(&base,&target,&request.operation,&request.canonical()).is_err());
        std::fs::remove_dir_all(base).unwrap();
    }
    fn genesis_stage_policy_fixture() -> Value {
        json!({"version":1,"ok":true,"result":{
            "schema":"nodenetwork-genesis-stage-policy-v1","address":"synv1".to_string()+&"a".repeat(36),
            "genesis_sha256":"a".repeat(64),"authority_sha256":"b".repeat(64),"authority_root_sha256":"c".repeat(64)
        }})
    }
    #[test] fn genesis_stage_policy_admits_only_the_empty_preflight() {
        let mut request = Request {version:1, operation:"genesis_stage_preflight".into(), parameters:json!({})};
        assert_eq!(request.validate(), Ok(false));
        request.parameters = json!({"artifacts":{}});
        assert!(request.validate().is_err());
        request.operation = "genesis_stage".into();
        assert!(request.validate().is_err());
    }
    #[test] fn genesis_stage_policy_accepts_only_the_owner_pins_and_sanitizes_refusals() {
        let expected = genesis_stage_policy_fixture();
        assert_eq!(genesis_stage_policy_reply(&expected), Ok(expected.clone()));
        for (key, invalid) in [
            ("schema", json!("nodenetwork-genesis-stage-v1")),
            ("address", json!("synv1exampleinvalid\n")),
            ("genesis_sha256", json!("A".repeat(64))),
            ("authority_sha256", json!("b".repeat(63))),
            ("authority_root_sha256", Value::Null),
            ("artifacts", json!({"private":"fixture"})),
            ("membership_verified", json!(true)),
        ] {
            let mut value = expected.clone();
            value["result"][key] = invalid;
            assert!(genesis_stage_policy_reply(&value).is_err(), "{key}");
        }
        let refusal = json!({"version":1,"ok":false,"error":{"code":"authorization_required","message":"fixture secret"}});
        assert_eq!(genesis_stage_policy_reply(&refusal),
            Err("The controller could not confirm approved Genesis input pins. Review the policy with the node operator."));
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

#[cfg(test)]
mod vpn_stop_tests {
 use super::*;
 #[test]fn vpn_stop_status_reconciles_only_exact_consumed_request(){
  let request=Request{version:1,operation:"vpn_stop".into(),parameters:json!({})};
  let status=Request{version:1,operation:"vpn_stop_status".into(),parameters:json!({})};assert!(!status.validate().unwrap());
  let reply=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-stop-status-v1","stopped":true,"request_sha256":request.approval_id(),"attempt_preserved":true,"provider_action":false}});
  assert_eq!(vpn_stop_reconciliation(&reply).unwrap(),Some(request.approval_id()));
  for(field,value)in[("request_sha256",json!("f".repeat(64))),("stopped",json!(false)),("provider_action",json!(true)),("unknown",json!(true))]{let mut bad=reply.clone();bad["result"][field]=value;assert!(vpn_stop_reconciliation(&bad).is_err());}
  let mut absent=reply;absent["result"]["stopped"]=json!(false);absent["result"]["request_sha256"]=Value::Null;assert_eq!(vpn_stop_reconciliation(&absent).unwrap(),None);
 }
 #[test]fn vpn_stop_requires_parameterless_mutation_and_exact_acknowledgement(){
  let mut request=Request{version:1,operation:"vpn_stop".into(),parameters:json!({})};
  assert!(request.validate().unwrap());
  let reply=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-stop-v1","stopped":true,"attempt_preserved":true,"provider_action":false}});
  assert!(mutation_acknowledgement(&request,reply.clone()).is_ok());
  for field in ["provider_action","stopped","attempt_preserved"] {let mut bad=reply.clone();bad["result"][field]=json!(field=="provider_action");assert!(mutation_acknowledgement(&request,bad).is_err());}
  let mut bad=reply;bad["result"]["unexpected"]=json!(true);assert!(mutation_acknowledgement(&request,bad).is_err());
  request.parameters=json!({"unit":"foreign.service"});assert!(request.validate().is_err());
 }
}
#[cfg(test)]mod vpn_resume_tests{
 use super::*;
 #[test]fn vpn_resume_is_exact_parameterless_and_ack_cannot_start_validator(){
 let request=Request{version:1,operation:"vpn_resume".into(),parameters:json!({})};assert!(request.validate().unwrap());
 let refusal=json!({"version":1,"ok":false,"error":{"code":"vpn_resume_not_started","message":"Active unresponsive VPN must be inspected; resume never restarts it"}});assert_eq!(mutation_acknowledgement(&request,refusal.clone()).unwrap()["ok"],false);
 for(field,value)in[("code",json!("operation_refused")),("message",json!("VPN resume outcome uncertain; read exact resume status before another action"))]{let mut bad=refusal.clone();bad["error"][field]=value;assert!(mutation_acknowledgement(&request,bad).is_err())}
 let ack=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-resume-v1","resumed":true,"validator_started":false,"enrollment_preserved":true}});assert!(mutation_acknowledgement(&request,ack.clone()).is_ok());
 for(field,value)in[("validator_started",json!(true)),("enrollment_preserved",json!(false)),("resumed",json!(false)),("extra",json!(true))]{let mut bad=ack.clone();bad["result"][field]=value;assert!(mutation_acknowledgement(&request,bad).is_err())}
 for parameters in [json!({"provider":"new"}),json!({"setup_key":"forbidden"}),json!({"restart":true})]{assert!(Request{version:1,operation:"vpn_resume".into(),parameters}.validate().is_err())}
 }
 #[test]fn vpn_resume_status_closes_only_exact_consumed_connected_proof(){
 let request=Request{version:1,operation:"vpn_resume".into(),parameters:json!({})};let read=Request{version:1,operation:"vpn_resume_status".into(),parameters:json!({})};assert!(!read.validate().unwrap());
 let status=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-resume-status-v1","resumed":true,"request_sha256":request.approval_id(),"validator_started":false,"enrollment_preserved":true}});assert_eq!(vpn_resume_reconciliation(&status).unwrap(),Some(request.approval_id()));
 for(field,value)in[("request_sha256",json!("f".repeat(64))),("validator_started",json!(true)),("enrollment_preserved",json!(false)),("resumed",json!(false)),("extra",json!(true))]{let mut bad=status.clone();bad["result"][field]=value;assert!(vpn_resume_reconciliation(&bad).is_err())}
 let mut absent=status;absent["result"]["resumed"]=json!(false);absent["result"]["request_sha256"]=Value::Null;assert_eq!(vpn_resume_reconciliation(&absent).unwrap(),None);
 }
}

#[cfg(test)]mod boot_policy_tests{
 use super::*;
 #[test]fn boot_policy_requests_and_acknowledgements_bind_exact_service_and_boolean(){
  let mut digests=std::collections::BTreeSet::new();
  for service in ["node","vpn"]{for enabled in [false,true]{
   let r=Request{version:1,operation:"boot_policy".into(),parameters:json!({"service":service,"enabled":enabled})};assert!(r.validate().unwrap());assert!(digests.insert(r.approval_id()));
   let reply=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-boot-policy-v1","service":service,"enabled":enabled,"runtime_changed":false}});assert!(mutation_acknowledgement(&r,reply.clone()).is_ok());
   for(field,value)in[("enabled",json!(!enabled)),("service",json!("other")),("runtime_changed",json!(true)),("extra",json!(true))]{let mut bad=reply.clone();bad["result"][field]=value;assert!(mutation_acknowledgement(&r,bad).is_err());}
  }}assert_eq!(digests.len(),4);
  for parameters in [json!({}),json!({"service":"node","enabled":"true"}),json!({"service":"guest","enabled":true}),json!({"service":"vpn","enabled":false,"start":true})]{assert!(Request{version:1,operation:"boot_policy".into(),parameters}.validate().is_err());}
 }
 #[test]fn boot_policy_status_reconciles_only_matching_current_enabled_state(){
  let read=Request{version:1,operation:"boot_policy_status".into(),parameters:json!({})};assert!(!read.validate().unwrap());
  for service in ["node","vpn"]{for enabled in [false,true]{let r=Request{version:1,operation:"boot_policy".into(),parameters:json!({"service":service,"enabled":enabled})};
   let mut reply=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-boot-policy-status-v1","node_enabled":false,"vpn_enabled":false,"applied":true,"request_sha256":r.approval_id(),"runtime_changed":false}});reply["result"][format!("{service}_enabled")]=json!(enabled);assert_eq!(boot_policy_reconciliation(&reply).unwrap(),Some(r.approval_id()));
   reply["result"][format!("{service}_enabled")]=json!(!enabled);assert!(boot_policy_reconciliation(&reply).is_err());
  }}
  let status=json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-boot-policy-status-v1","node_enabled":false,"vpn_enabled":false,"applied":false,"request_sha256":null,"runtime_changed":false}});assert_eq!(boot_policy_reconciliation(&status).unwrap(),None);
  for(field,value)in[("applied",json!(true)),("node_enabled",json!(null)),("request_sha256",json!("a".repeat(64))),("runtime_changed",json!(true)),("extra",json!(false))]{let mut bad=status.clone();bad["result"][field]=value;assert!(boot_policy_reconciliation(&bad).is_err());}
 }
}
