//! Native-only exact input and receipt model for Testnet v3 613fa6ab `controller.py::genesis_stage`.
use crate::node_bootstrap::read_bounded;
use crate::node_controller::{valid_validator_address, validator_chain_id, validator_network_id, GENESIS_STAGE_WIRE_LIMIT};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub(super) const INPUTS: [(&str, usize); 3] = [
    ("genesis.json", 4 * 1024 * 1024),
    ("authority.json", 1024 * 1024),
    ("authority-root.pub", 8 * 1024),
];

fn sha256(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn pin(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct GenesisPins {
    genesis_sha256: String,
    authority_sha256: String,
    authority_root_sha256: String,
}

impl GenesisPins {
    fn all(&self) -> [&str; 3] { [&self.genesis_sha256,&self.authority_sha256,&self.authority_root_sha256] }

    fn matches(&self, result: &Value) -> bool {
        ["genesis_sha256","authority_sha256","authority_root_sha256"].into_iter().zip(self.all())
            .all(|(field,expected)| result[field] == expected)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct GenesisStageReview {
    validator_address: String,
    network_id: String,
    chain_id: String,
    formation_sha256: String,
    request_sha256: String,
    pins: GenesisPins,
}

impl GenesisStageReview {
    pub(super) fn validate(&self) -> Result<(), String> {
        if valid_validator_address(&self.validator_address) && validator_network_id(&self.network_id) && validator_chain_id(&self.chain_id)
            && pin(&self.formation_sha256) && pin(&self.request_sha256) && self.pins.all().into_iter().all(pin) { return Ok(()); }
        Err("An exact reviewed formation, stage policy and local Genesis input request are required.".into())
    }

    pub(super) fn matches_preparation(&self, prepared: &PreparedGenesisStage) -> Result<(), String> {
        if self.request_sha256 == prepared.request_sha256 && self.pins == prepared.pins { return Ok(()); }
        Err("The selected files differ from the reviewed Genesis request or the controller's public input pins.".into())
    }

    pub(super) fn confirmation_details(&self, prepared: &PreparedGenesisStage) -> String {
        let mut message = format!("Reviewed validator: {}\nNetwork incarnation: {}\nChain ID: {}\nFormation SHA-256: {}\n",
            self.validator_address,self.network_id,self.chain_id,self.formation_sha256);
        for (index, ((name,_),digest)) in INPUTS.into_iter().zip(prepared.pins.all()).enumerate() {
            message.push_str(&format!("\n{name} · {} bytes\nSHA-256: {digest}\n",prepared.sizes[index]));
        }
        message.push_str(&format!("\nExact request approval ID: {}",prepared.request_sha256));
        message
    }

    pub(super) fn require_current_formation(&self, reply: &Value) -> Result<(), String> {
        let result=&reply["result"];
        if reply["ok"] == true && result["schema"] == "nodenetwork-formation-v1" && result["pending"] == true
            && result["possession_verified"] == true && result["membership_granted"] == false
            && result["address"] == self.validator_address && result["network_id"] == self.network_id
            && result["chain_id"] == self.chain_id && result["formation_sha256"] == self.formation_sha256 { return Ok(()); }
        Err("The current pending formation differs from the reviewed validator. Read formation custody status again.".into())
    }

    pub(super) fn require_current_policy(&self, reply: &Value) -> Result<(), String> {
        let result=&reply["result"];
        if reply["ok"] == true && result["schema"] == "nodenetwork-genesis-stage-policy-v1"
            && result["address"] == self.validator_address && self.pins.matches(result) { return Ok(()); }
        Err("The current Genesis staging policy differs from the reviewed address or input pins. Review it again.".into())
    }

    pub(super) fn stage_reply(&self, reply: &Value) -> Result<Value, String> {
        const UNKNOWN:&str="Genesis staging outcome is uncertain. Preserve the target state and review staged Genesis before another change.";
        if reply["ok"] == false {
            // These exact owner refusals occur before staging or consumption of the grant.
            let error=&reply["error"];
            let (code,message)=match (error["code"].as_str(),error["message"].as_str()) {
                (Some("operation_refused"),Some("Genesis is already staged or requires reconciliation")) =>
                    ("operation_refused","The controller reported existing staging or pending reconciliation."),
                (Some("operation_refused"),Some("Public upload differs from independently approved Genesis pins")) =>
                    ("operation_refused","The controller refused the reviewed files because its approved pins differ."),
                (Some("qualification_required"),Some("Operation has not passed host qualification")) =>
                    ("qualification_required","The host policy does not qualify this Genesis staging operation."),
                (Some("authorization_required"),Some("Exact request needs one-time host operator authorization" | "Host authorization expired or differs")) =>
                    ("authorization_required","A matching one-use host grant is required for Genesis staging."),
                _=>return Err(UNKNOWN.into()),
            };
            return Ok(json!({"version":1,"ok":false,"error":{"code":code,"message":message}}));
        }
        let result=&reply["result"];
        if reply["version"] != 1 || reply["ok"] != true || !result.as_object().is_some_and(|fields| fields.len() == 9)
            || result["schema"] != "nodenetwork-genesis-stage-v1" || result["address"] != self.validator_address
            || result["request_sha256"] != self.request_sha256 || !self.pins.matches(result)
            || result["staged"] != true || result["genesis_authority_verified"] != true || result["membership_verified"] != true {
            return Err(UNKNOWN.into());
        }
        Ok(json!({"version":1,"ok":true,"result":{"schema":result["schema"],"address":result["address"],
            "genesis_sha256":self.pins.genesis_sha256,"authority_sha256":self.pins.authority_sha256,
            "authority_root_sha256":self.pins.authority_root_sha256,"staged":true,
            "genesis_authority_verified":true,"membership_verified":true}}))
    }
}

pub(super) struct PreparedGenesisStage {
    sizes: [usize; 3],
    pins: GenesisPins,
    pub(super) request_sha256: String,
    pub(super) wire: String,
}

impl PreparedGenesisStage {
    pub(super) fn read(paths: [PathBuf; 3]) -> Result<Self, String> {
        let mut bytes: [Vec<u8>; 3] = Default::default();
        for ((path,(name,limit)),content) in paths.into_iter().zip(INPUTS).zip(bytes.iter_mut()) {
            if path.file_name().and_then(|name|name.to_str()) != Some(name) {
                return Err(format!("Select the expected public file {name}."));
            }
            *content=read_bounded(&path,limit).map_err(|_|format!("Could not read selected public file {name} within its byte limit."))?;
        }
        Self::from_bytes(bytes)
    }

    fn from_bytes(bytes: [Vec<u8>; 3]) -> Result<Self, String> {
        let sizes=bytes.each_ref().map(Vec::len);
        if INPUTS.iter().zip(sizes).any(|((_,limit),size)| size == 0 || size > *limit) {
            return Err("Genesis input files must be nonempty and within their byte limits.".into());
        }
        let [genesis,authority,root]=bytes;
        let pins=GenesisPins{genesis_sha256:sha256(&genesis),authority_sha256:sha256(&authority),authority_root_sha256:sha256(&root)};
        let genesis=String::from_utf8(genesis).map_err(|_|"genesis.json must use UTF-8.")?;
        let authority=String::from_utf8(authority).map_err(|_|"authority.json must use UTF-8.")?;
        // Preserve the source bytes, including whitespace and UTF-8. The pinned owner hashes sorted compact JSON with ensure_ascii=False.
        let wire=json!({"version":1,"operation":"genesis_stage","parameters":{"artifacts":{
            "genesis.json":genesis,"authority.json":authority,"authority-root.pub":STANDARD.encode(root)}}}).to_string();
        if wire.len() >= GENESIS_STAGE_WIRE_LIMIT { return Err("The exact Genesis request exceeds its encoded byte limit.".into()); }
        let request_sha256=sha256(wire.as_bytes());
        Ok(Self {sizes,pins,request_sha256,wire})
    }

    pub(super) fn summary(&self) -> Value {
        let inputs=INPUTS.into_iter().zip(self.sizes).zip(self.pins.all()).map(|(((name,_),size),digest)|
            json!({"name":name,"bytes":size,"sha256":digest})).collect::<Vec<_>>();
        json!({"schema":"nodenetwork-genesis-stage-local-review-v1","requestSha256":self.request_sha256,"inputs":inputs})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genesis_stage_prepares_exact_bytes_and_matches_pinned_python_request_digest() {
        let genesis="\u{feff}{ \"name\": \"café\u{2028}\", \"x\": 1 }\r\n";
        let authority="{\"authority\":\"fixture\"}\n";
        let root=[0,255,128,2];
        let prepared=PreparedGenesisStage::from_bytes([genesis.as_bytes().to_vec(),authority.as_bytes().to_vec(),root.to_vec()]).unwrap();
        assert_eq!(prepared.request_sha256,"40baa2ac62d04c9f74a6a97879719e32081c3ff1d0110f418acd43eea54a17cd");
        assert_eq!(prepared.pins.all(),[
            "1d0fbc8276849bb97457d015427015a9a8aafefc9222583b3648640ed5029c0c",
            "b143db57e52df553bad02f9a482e2b6834a60d0ffd2b15c44ee8f55aab061bd3",
            "020b257b1a7d9ca9e57398993c783c80b5998d3985a2e0884616db4a8c441000"
        ]);
        let value:Value=serde_json::from_str(&prepared.wire).unwrap();
        let artifacts=&value["parameters"]["artifacts"];
        assert_eq!(artifacts["genesis.json"].as_str().unwrap().as_bytes(),genesis.as_bytes());
        assert_eq!(artifacts["authority.json"].as_str().unwrap().as_bytes(),authority.as_bytes());
        assert_eq!(artifacts["authority-root.pub"],STANDARD.encode(root));
        let summary=prepared.summary().to_string();
        for private in ["café","fixture",artifacts["authority-root.pub"].as_str().unwrap()] {
            assert!(!summary.contains(private));
        }
    }

    #[test]
    fn genesis_stage_enforces_per_file_and_encoded_wire_bounds() {
        for index in 0..INPUTS.len() {
            let mut bytes=[b"{}".to_vec(),b"{}".to_vec(),vec![255]];
            bytes[index]=Vec::new();
            assert!(PreparedGenesisStage::from_bytes(bytes.clone()).is_err());
            bytes[index]=vec![b'a';INPUTS[index].1+1];
            assert!(PreparedGenesisStage::from_bytes(bytes).is_err());
        }
        for index in 0..2 {
            let mut bytes=[b"{}".to_vec(),b"{}".to_vec(),vec![255]];
            bytes[index]=vec![255];
            assert!(PreparedGenesisStage::from_bytes(bytes).err().unwrap().contains("UTF-8"));
        }
        assert!(PreparedGenesisStage::from_bytes([vec![0;INPUTS[0].1],b"{}".to_vec(),vec![255]])
            .err().unwrap().contains("encoded byte limit"));
    }

    #[cfg(unix)]
    #[test]
    fn genesis_stage_reads_fixed_regular_local_files_without_following_a_replacement_link() {
        use std::{fs, os::unix::fs::symlink, time::{SystemTime,UNIX_EPOCH}};
        let stamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let directory=std::env::temp_dir().canonicalize().unwrap().join(format!("nodenetwork-genesis-stage-files-{}-{stamp}",std::process::id()));
        fs::create_dir(&directory).unwrap();
        let paths=INPUTS.map(|(name,_)|directory.join(name));
        for (path,bytes) in paths.iter().zip([b"{}".as_slice(),b"{}",&[0,255]]) {fs::write(path,bytes).unwrap();}
        assert!(PreparedGenesisStage::read(paths.clone()).is_ok());
        let mut swapped=paths.clone();
        swapped.swap(0,1);
        assert!(PreparedGenesisStage::read(swapped).is_err());
        fs::remove_file(&paths[2]).unwrap();
        symlink(&paths[0],&paths[2]).unwrap();
        assert!(PreparedGenesisStage::read(paths).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
