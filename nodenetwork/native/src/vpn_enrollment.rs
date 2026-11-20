//! Isolated native coordinator. Never returns provider credentials or setup keys to JS.
use crate::{authorization_lifecycle as lifecycle,node_controller::{Target,Request}};
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::Path,process::Stdio};
use tokio::io::{AsyncReadExt,AsyncWriteExt};
use zeroize::Zeroizing;
const PROVIDER:&str=include_str!(concat!(env!("SYNERGY_NODE_ENGINE_ROOT"),"/vpn_authorization.py"));
static SERIAL:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
fn hash(b:&[u8])->String{format!("{:x}",Sha256::digest(b))}
fn read(path:&Path,limit:usize,private:bool)->Result<Zeroizing<Vec<u8>>,String>{
 use std::io::Read;
 let mut o=std::fs::OpenOptions::new();o.read(true);
 #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;o.custom_flags(libc::O_NOFOLLOW|libc::O_NONBLOCK);}
 let f=o.open(path).map_err(|_|"Cannot read native-selected VPN input")?;let m=f.metadata().map_err(|_|"Cannot inspect VPN input")?;
 if !m.is_file()||m.len()==0||m.len()>limit as u64{return Err("Invalid bounded VPN input".into())}
 #[cfg(unix)]{use std::os::unix::fs::MetadataExt;if m.nlink()!=1||(private&&(m.mode()&0o077!=0||m.uid()!=unsafe{libc::geteuid()})){return Err("VPN credential must be a private0600 native-owned regular file".into())}}
 let mut b=Zeroizing::new(Vec::new());f.take(limit as u64+1).read_to_end(&mut b).map_err(|_|"Cannot read VPN input")?;
 if b.len()!=m.len() as usize{return Err("VPN input changed while reading".into())}Ok(b)
}
struct Config{raw:String,ca:Zeroizing<Vec<u8>>,policy:Value,pin:String}
fn config(directory:&Path)->Result<Config,String>{
 if !cfg!(all(debug_assertions,unix)){return Err("Native VPN issuer remains unavailable in production".into())}
 let raw=read(&directory.join("provider.json"),16384,false)?;
 let raw=String::from_utf8(raw.to_vec()).map_err(|_|"Provider approval must be UTF8")?;
 let policy:Value=serde_json::from_str(&raw).map_err(|_|"Invalid provider approval")?;
 let pin=crate::gateway_vpn::verified_provider_pin(&raw,policy["profile"].as_str().ok_or("Exact VPN provider profile required")?,option_env!("SYNERGY_NODENETWORK_QUALIFICATION_VPN_PROVIDER_SHA256"),option_env!("SYNERGY_NODENETWORK_QUALIFICATION_GATEWAY_VPN_PROVIDER_SHA256"),cfg!(debug_assertions))?;
 let ca=read(&directory.join("ca.pem"),128*1024,false)?;
 if policy["ca_sha256"]!=hash(&ca){return Err("VPN CA bytes differ from the independently approved provider".into())}
 Ok(Config{raw,ca,policy,pin:pin.into()})
}
// Provider intent is anchored to the immutable installation origin. A current
// release adoption authorizes operations but must not rewrite that identity.
fn binding(target:&Target,status:&Value,doc:&Value,initial_sha256:&str)->Result<Value,String>{
 let origin=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});
 let selected=&status["selection"];
 let target_identity=target.journal_identity();
 if status["schema"]!="nodenetwork-engineering-authorization-status-v1"||status["initial_sha256"]!=initial_sha256||status["target"]!=doc["target"]||target_identity.as_object().unwrap().iter().any(|(k,v)|if k=="host"{doc["target"][k].as_str().map(str::to_ascii_lowercase)!=v.as_str().map(str::to_ascii_lowercase)}else{&doc["target"][k]!=v})||status.get("initial_selection").unwrap_or(selected)!=&origin||["network_id","chain_id","node_name"].iter().any(|k|selected[k]!=origin[k])||status["formation_sha256"]!=doc["artifacts"]["formation-context.json"]{return Err("VPN origin differs from the independently approved target, network or formation".into())}
 if selected!=&origin{
  let adoption=&status["update"];
  if adoption["initial_sha256"]!=status["initial_sha256"]||adoption["formation_sha256"]!=status["formation_sha256"]||!["selection","previous_selection"].iter().any(|key|&adoption[key]==selected){return Err("VPN current release lacks its exact native-reviewed adoption".into())}
 }
 for value in [&origin["manifest_sha256"],&selected["manifest_sha256"],&status["formation_sha256"]]{if !value.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("VPN release or formation commitment is unavailable".into())}}
 if !selected["release_id"].is_string()||!selected["network_id"].is_string()||!selected["chain_id"].is_u64(){return Err("Target selected network is unavailable".into())}
 Ok(json!({"target_sha256":hash(target_identity.to_string().as_bytes()),"manifest_sha256":origin["manifest_sha256"],"formation_sha256":status["formation_sha256"],"network_id":origin["network_id"],"chain_id":origin["chain_id"]}))
}
fn cleanup_action(operation:&str)->Result<Option<&str>,String>{match operation{"revoke"|"retire"=>Ok(Some(operation)),"cancel_unused"=>Ok(Some("revoke")),"prepare"|"reconcile"=>Ok(None),_=>Err("Unsupported native provider action".into())}}
async fn provider(config:&Config,credential:&[u8],directory:&Path,operation:&str,binding:&Value,local:&Value)->Result<(Value,Zeroizing<String>),String>{
 let token=std::str::from_utf8(credential).map_err(|_|"Provider credential must be ASCII")?.trim_end_matches(['\r','\n']);
 if token.is_empty()||token.len()>4096||!token.bytes().all(|c|(33..=126).contains(&c)){return Err("Private provider credential is invalid".into())}
 #[derive(serde::Serialize)]struct PrivateWire<'a>{policy:&'a str,pin:&'a str,ca:String,token:&'a str,directory:&'a Path,operation:&'a str,cleanup_action:Option<&'a str>,binding:&'a Value,local:&'a Value}
 let wire=Zeroizing::new(serde_json::to_vec(&PrivateWire{policy:&config.raw,pin:&config.pin,ca:STANDARD.encode(config.ca.as_slice()),token,directory,operation,cleanup_action:cleanup_action(operation)?,binding,local}).map_err(|_|"Cannot encode private provider exchange")?);
 let runner=r#"
import base64,sys
try:
    wire=decode(sys.stdin.buffer.read(256*1024+1))
    ca=base64.b64decode(wire['ca'],validate=True)
    policy=provider_policy(wire['policy'].encode(),wire['pin'],ca,int(time.time()),cleanup_action=wire['cleanup_action'])
    client=HttpsProvider(policy,ca,wire['token'])
    flow=Authorization(wire['directory'],policy,client.request,cleanup_action=wire['cleanup_action'])
    if wire['operation']=='prepare':
        public,secret=flow.prepare(wire['binding'])
        sys.stdout.buffer.write(encode(public)+b'\n'+secret.encode())
    else:
        intent=flow._read('intent.json')
        require(intent['binding']==wire['binding'],'Original target/release/network differs')
        if wire['operation']=='reconcile': result=flow.reconcile(wire['local'])
        elif wire['operation']=='revoke': result=flow.revoke_setup_key()
        elif wire['operation']=='retire': result=flow.retire_bound_peer(wire['local'])
        elif wire['operation']=='cancel_unused': result=flow.cancel_unused(wire['local'])
        else: raise ValueError('Unknown native provider operation')
        sys.stdout.buffer.write(encode(result)+b'\n')
except Exception:
    sys.exit(1)
"#;
 let script=format!("{PROVIDER}\n{runner}");
 let mut c=tokio::process::Command::new("/usr/bin/python3");c.args(["-I","-B","-c",&script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=c.spawn().map_err(|_|"Native provider transport is unavailable")?;
 let mut input=child.stdin.take().ok_or("Provider input unavailable")?;let mut output=child.stdout.take().ok_or("Provider response unavailable")?.take(32769);
 let result=tokio::time::timeout(std::time::Duration::from_secs(90),async{
  input.write_all(&wire).await.map_err(|_|"Private provider exchange interrupted")?;drop(input);
  let mut raw=Zeroizing::new(Vec::new());output.read_to_end(&mut raw).await.map_err(|_|"Provider response unavailable")?;
  if raw.len()>32768||!child.wait().await.map_err(|_|"Provider outcome unknown")?.success(){return Err("Provider operation refused or uncertain; use reconciliation, never reissue")}
  let split=raw.iter().position(|c|*c==b'\n').ok_or("Unsupported provider response")?;
  let public=serde_json::from_slice(&raw[..split]).map_err(|_|"Invalid public provider receipt")?;
  let secret=Zeroizing::new(std::str::from_utf8(&raw[split+1..]).map_err(|_|"Invalid private provider response")?.to_string());Ok((public,secret))
 }).await.map_err(|_|"Provider operation timed out; preserve intent and reconcile, never reissue")?;
 result.map_err(String::from)
}
fn enrollment_controller_refusal(reply:&Value)->String{
 // Only fixed public codes/messages produced by the sealed controller survive.
 // Arbitrary remote error strings can contain secrets and are never reflected.
 match reply["error"]["code"].as_str(){
  Some("vpn_reconciliation_required")=>"vpn_reconciliation_required: VPN enrollment did not return a verified receipt. Read VPN diagnostics and reconcile the original intent; never issue another key.".into(),
  Some("authorization_required")=>"authorization_required: Controller refused the original VPN authorization. Read target authorization and diagnostics; never reissue a key.".into(),
  _=>"Enrollment outcome uncertain; read VPN diagnostics and reconcile provider and target, never issue another key".into(),
 }
}

fn state_directory(base:&Path,target:&Target)->Result<std::path::PathBuf,String>{
 let physical=hash(target.journal_identity().to_string().as_bytes());
 let name=if let Some(pin)=lifecycle::incarnation(base,&target.journal_identity())?{format!("{physical}-{pin}")}else{physical};
 Ok(base.join("nodenetwork-vpn-v1").join(name))
}
/// Local immutable provider receipts are never inferred from target booleans.
/// The provider wrote retired.json only after exact peer GET404 and list absence.
pub(super) fn require_terminal(base:&Path,target:&Target,doc:&Value)->Result<(),String>{
 let directory=state_directory(base,target)?;
 let expected=json!({"target_sha256":hash(target.journal_identity().to_string().as_bytes()),"manifest_sha256":doc["manifest_sha256"],"formation_sha256":doc["artifacts"]["formation-context.json"],"network_id":doc["network_id"],"chain_id":doc["chain_id"]});
 terminal_directory(&directory,&expected,0)
}
fn unused_proof(value:&Value)->bool{
 let fields=["format","binding","provider_sha256","account_id","setup_key_id","name","intent_sha256","attempt_sha256","unused_verified","setup_key_absent","peer_absence_verified"];
 let pin=|v:&Value|v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 value.as_object().is_some_and(|m|m.len()==fields.len()&&fields.iter().all(|k|m.contains_key(*k)))
 &&value["format"]=="nodenetwork-vpn-unused-cancellation-v1"
 &&["provider_sha256","intent_sha256","attempt_sha256"].iter().all(|k|pin(&value[*k]))
 &&["account_id","setup_key_id","name"].iter().all(|k|value[*k].as_str().is_some_and(|s|!s.is_empty()&&s.len()<=100&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b))))
 &&["unused_verified","setup_key_absent","peer_absence_verified"].iter().all(|k|value[*k]==true)
}
fn terminal_directory(directory:&Path,expected:&Value,depth:usize)->Result<(),String>{
 if depth>64{return Err("Provider attempt history exceeds its bound".into())}
 if !directory.exists()&&!directory.is_symlink(){return Ok(())}
 for path in directory.ancestors(){if !path.symlink_metadata().is_ok_and(|m|m.is_dir()){return Err("Unsafe original provider state ancestry".into())}}
 let load=|name:&str|->Result<Value,String>{serde_json::from_slice(&read(&directory.join(name),32768,true)?).map_err(|_|"Invalid original provider terminal receipt".into())};
 let intent=load("intent.json")?;
 if directory.join("cancelled-unused.json").exists(){
  let proof=load("cancelled-unused.json")?;let pending=load("cancel-unused-intent.json")?;let issued=load("issued.json")?;
  if !unused_proof(&proof)||proof!=pending||&proof["binding"]!=expected||&intent["binding"]!=expected||issued["binding"]!=intent["binding"]||issued["name"]!=intent["name"]||proof["name"]!=intent["name"]||proof["setup_key_id"]!=issued["setup_key_id"]||proof["account_id"]!=intent["account_id"]||proof["provider_sha256"]!=intent["provider_sha256"]||proof["intent_sha256"]!=hash(intent.to_string().as_bytes())||proof["format"]!="nodenetwork-vpn-unused-cancellation-v1"||proof["unused_verified"]!=true||proof["setup_key_absent"]!=true||proof["peer_absence_verified"]!=true||proof["attempt_sha256"].as_str().is_none_or(|s|s.len()!=64||!s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("Original unused provider cancellation is not exact".into())}
  let pin=hash(json!({"kind":"cancel","receipt":proof}).to_string().as_bytes());
  for item in std::fs::read_dir(directory).map_err(|_|"Cannot inspect original provider history")?{
   let item=item.map_err(|_|"Cannot inspect provider attempt")?;
   let kind=item.file_type().map_err(|_|"Cannot inspect provider attempt type")?;
   if kind.is_symlink(){return Err("Linked provider attempt history".into())}
   if kind.is_dir(){
    if item.file_name()!=format!("retry-{pin}").as_str(){return Err("Foreign provider retry history".into())}
    let mut next=expected.clone();next["attempt_sha256"]=json!(pin);terminal_directory(&item.path(),&next,depth+1)?;
   }
  }
  return Ok(())
 }
 if std::fs::read_dir(directory).map_err(|_|"Cannot inspect provider history")?.any(|e|e.is_err()||e.is_ok_and(|e|e.file_type().map_or(true,|t|t.is_dir()||t.is_symlink()))){return Err("Unexpected provider child attempt".into())}
 let bound=load("bound.json")?;let retired=load("retired.json")?;let deletion=load("retire-intent.json")?;

 let identifier=|v:&Value|v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=253&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_.-".contains(&b)));
 let pin=|v:&Value|v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 if [&intent["account_id"],&intent["name"],&bound["peer_id"],&bound["name"],&bound["hostname"],&bound["provider_account_id"]].iter().any(|v|!identifier(v))||bound["provider_account_id"]!=intent["account_id"]||bound["new_peer_verified"]!=true||bound["one_off_usage_verified"]!=true||bound["ip"].as_str().is_none_or(|s|s.parse::<std::net::IpAddr>().is_err())||bound["wireguard_public_key"].as_str().and_then(|s|STANDARD.decode(s).ok()).is_none_or(|b|b.len()!=32)||[&intent["provider_sha256"],&deletion["enrollment_sha256"],&deletion["binding_sha256"]].iter().any(|v|!pin(v)){return Err("Original provider retirement lacks exact typed attribution and commitments".into())}

 if &intent["binding"]!=expected||&bound["binding"]!=expected||&deletion["binding"]!=expected||retired["format"]!="synergy-vpn-retirement-v1"||retired["retired"]!=true||retired["absence_verified"]!=true||retired["account_id"]!=intent["account_id"]||retired["peer_name"]!=intent["name"]||retired["peer_id"]!=bound["peer_id"]||retired["peer_name"]!=bound["name"]||retired["hostname"]!=bound["hostname"]||retired["ip"]!=bound["ip"]||deletion["peer_id"]!=bound["peer_id"]||retired["enrollment_sha256"]!=deletion["enrollment_sha256"]||retired["binding_sha256"]!=deletion["binding_sha256"]{return Err("Original provider peer is not exactly retired; reconcile without issuing new access".into())}
 Ok(())
}
fn attempt_scope<'a>(state:&'a Value,origin:&Value,operation:&str)->Result<Option<&'a str>,String>{
 let pin=|v:&Value|v.as_str().is_some_and(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)));
 if state.as_object().is_none_or(|m|m.len()!=8||["schema","quiescent","attempt_sha256","scope_sha256","retry_after_sha256","pending_cancellation_sha256","attempt_scopes","binding"].iter().any(|k|!m.contains_key(*k)))||state["attempt_scopes"].as_array().is_none_or(|a|a.len()>64||a.iter().any(|v|!pin(v))||a.last().unwrap_or(&Value::Null)!=&state["scope_sha256"])||state["schema"]!="nodenetwork-vpn-unused-preflight-v1"||state["quiescent"].as_bool().is_none()||["attempt_sha256","scope_sha256","retry_after_sha256","pending_cancellation_sha256"].iter().any(|k|!state[*k].is_null()&&!pin(&state[*k])){return Err("Invalid original VPN attempt state".into())}
 let mut expected=origin.clone();if !state["scope_sha256"].is_null(){expected["attempt_sha256"]=state["scope_sha256"].clone();}
 if state["binding"]!=expected{return Err("Original VPN attempt scope differs from authenticated installation".into())}
 let key=if operation=="enroll"&&!state["retry_after_sha256"].is_null(){"retry_after_sha256"}else{"scope_sha256"};
 Ok(state[key].as_str())
}
// A diagnostic is a fresh identity observation, never a receipt or a peer-probe claim.
// Provider reconciliation still verifies the original one-use intent independently.
fn recovery_identity(diagnostic:&Value,current:&Value,context:&Value,policy:&Value,now_ms:u64)->Result<Value,String>{
 let client=&diagnostic["client"];let observed=diagnostic["observed_at_ms"].as_u64().ok_or("VPN recovery observation has no time")?;
 if diagnostic["schema"]!="nodenetwork-vpn-diagnostics-v1"||diagnostic["mutation_performed"]!=false
  ||observed>now_ms.saturating_add(30_000)||now_ms.saturating_sub(observed)>120_000
  ||[current,&diagnostic["enrollment"]].iter().any(|s|s["service_registered"]!=true||s["enrollment_recorded"]!=false||s["enrollment_staged"]!=false||s["reconciliation_required"]!=true||s["server_bound"]!=false)
  ||diagnostic["trust"]["mode"]!="approved_private_ca"||!diagnostic["trust"]["error_code"].is_null()
  ||client["available"]!=true||client["management_connected"]!=true||client["signal_connected"]!=true||!client["error_code"].is_null(){return Err("Original VPN attempt lacks a fresh connected native identity; preserve it without replay".into())}
 let key=client["wireguard_public_key"].as_str().ok_or("VPN recovery key unavailable")?;
 let bytes=STANDARD.decode(key).map_err(|_|"VPN recovery key invalid")?;
 if bytes.len()!=32||STANDARD.encode(&bytes)!=key{return Err("VPN recovery key invalid".into())}
 let address=client["overlay_address"].as_str().ok_or("VPN recovery address unavailable")?;
 let (ip,prefix)=address.split_once('/').ok_or("VPN recovery address invalid")?;
 let ip=ip.parse::<std::net::IpAddr>().map_err(|_|"VPN recovery address invalid")?;
 let prefix=prefix.parse::<u8>().map_err(|_|"VPN recovery prefix invalid")?;
 if prefix>if ip.is_ipv4(){32}else{128}||ip.is_unspecified()||ip.is_multicast()||ip.is_loopback(){return Err("VPN recovery address invalid".into())}
 let origin=policy["management_origin"].as_str().ok_or("Original VPN management origin unavailable")?;
 Ok(json!({"native_enrollment_verified":true,"wireguard_public_key":key,"overlay_address":address,
   "hostname":format!("nn-{}",&hash(context.to_string().as_bytes())[..60]),"management_url":origin}))
}
pub(super) async fn legacy_read(window:&tauri::WebviewWindow,_app:&tauri::AppHandle,target:Target,control:&Path)->Result<Value,String>{
 use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
 use std::time::{SystemTime,UNIX_EPOCH};
 if !cfg!(all(debug_assertions,unix)){return Err("Legacy peer prerequisites require the isolated engineering native app".into())}
 let reviewed=crate::legacy_gateway_plan::inspect(&target,"root",control).await?;
 let (folder,locator_path)=legacy_provider_inputs(window).await?;
 let approved=config(&folder)?;let locator=read(&locator_path,16384,true)?;
 let coordinator=crate::vpn_credential::public_review(&locator,&approved.pin)?;
 let now=||SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_secs()).map_err(|_|"Local clock unavailable");
 let proposed=crate::legacy_peer_preflight::scope(&reviewed,&approved.policy,&approved.pin,coordinator["locator_sha256"].as_str().ok_or("Approved locator commitment unavailable")?,now()?+120)?;
 let prompt=window.clone();let message=format!("Use ONLY the existing approved coordinator credential for one bounded read-only legacy-peer prerequisite check?\nTarget: {}\nObsolete network: posy-apqe-canary-process-49028\nPreserved lower root: /opt/synergy; obsolete upper root: /opt/Synergy\nOld raw Genesis SHA256: d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7\nPlan SHA256: {}\nProvider SHA256: {}\nAccount: {}\nCoordinator: {}:{} / {}\nCredential locator SHA256: {}\nPeer: {} / {}\nOne read-only credential use, at most120seconds; provider requests GET only.\nGET account, exact peer and peer inventory only. No setup key, enrollment, DELETE, host mutation or retirement is authorized. REST does not independently expose the WireGuard key, so this result cannot authorize removal. The expired previous network issuance scope is NOT reused.",target.label(),proposed["plan_sha256"],approved.pin,proposed["account_id"],coordinator["host"],coordinator["port"],coordinator["account"],coordinator["locator_sha256"],proposed["peer_id"],proposed["ip"]);
 let accepted=tauri::async_runtime::spawn_blocking(move||prompt.dialog().message(message).parent(&prompt).title("Review exact legacy peer account read").buttons(MessageDialogButtons::OkCancelCustom("Allow one read-only credential use".into(),"Cancel".into())).blocking_show()).await.map_err(|_|"Legacy credential review interrupted")?;
 if !accepted{return Err("Legacy credential access cancelled; no provider contacted".into())}
 let expires=now()?+120;
 let _serial=SERIAL.lock().await;
 let fresh=crate::legacy_gateway_plan::inspect(&target,"root",control).await?;
 let current=config(&folder)?;
 let current_locator=read(&locator_path,16384,true)?;
 if fresh["plan_sha256"]!=reviewed["plan_sha256"]||current.pin!=approved.pin||current.raw!=approved.raw||current.ca.as_slice()!=approved.ca.as_slice()||current_locator.as_slice()!=locator.as_slice()||now()? >= expires{return Err("Legacy scope changed or review expired; no credential was loaded".into())}
 let scope=crate::legacy_peer_preflight::scope(&fresh,&current.policy,&current.pin,coordinator["locator_sha256"].as_str().ok_or("Approved locator commitment unavailable")?,expires)?;
 let credential=crate::vpn_credential::load(current_locator,&current.pin,true,control).await?;
 if now()? >= expires{return Err("Legacy credential review expired; no provider request was sent".into())}
 let result=legacy_account_reads(&current,&credential,&scope).await?;
 if now()? >= expires||config(&folder)?.raw!=current.raw||read(&locator_path,16384,true)?.as_slice()!=locator.as_slice(){return Err("Legacy prerequisite observation expired or approval inputs changed; no retirement was attempted".into())}
 Ok(serde_json::json!({"version":1,"ok":true,"result":result}))
}

async fn legacy_provider_inputs(window: &tauri::WebviewWindow) -> Result<(std::path::PathBuf,std::path::PathBuf),String> {
    use tauri_plugin_dialog::DialogExt;
    let select = window.clone();
    let (folder, locator) = tauri::async_runtime::spawn_blocking(move || {
        let cancelled = "Legacy peer review cancelled before provider contact";
        let folder = select.dialog().file().set_parent(&select)
            .set_title("Choose approved public coordinator provider.json and CA folder")
            .blocking_pick_folder().ok_or(cancelled)?.into_path().map_err(|_| "Local public provider folder required")?;
        let locator = select.dialog().file().add_filter("Public credential locator", &["json"]).set_parent(&select)
            .set_title("Choose approved public credential-locator.json")
            .blocking_pick_file().ok_or(cancelled)?.into_path().map_err(|_| "Local approved credential locator required")?;
        Ok::<_,&str>((folder, locator))
    }).await.map_err(|_| "Legacy provider selection interrupted")??;
    if locator.file_name().and_then(|v| v.to_str()) != Some("credential-locator.json") {
        return Err("Select the approved public credential-locator.json".into());
    }
    Ok((folder, locator))
}

pub(super) async fn legacy_retire(window: &tauri::WebviewWindow, target: Target, control: &Path, base: &Path, reconcile_only: bool) -> Result<Value,String> {
    use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
    use std::time::{SystemTime,UNIX_EPOCH};
    if !cfg!(all(debug_assertions, unix)) {
        return Err("Legacy peer retirement requires the isolated engineering native app".into());
    }
    let directory = base.join("nodenetwork-legacy-canary-peer-retirement-v1");
    let intent = directory.join("retire-intent.json");
    match (intent.symlink_metadata(), reconcile_only) {
        (Ok(_), false) => return Err("Retirement already dispatched. Check the original provider result.".into()),
        (Err(error), false) if error.kind() == std::io::ErrorKind::NotFound => {},
        (Ok(meta), true) if meta.is_file() => {},
        _ => return Err("An exact native retirement intent is unavailable".into()),
    }
    let now = || SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_secs()).map_err(|_| "Local clock unavailable");
    let plan = crate::legacy_gateway_plan::inspect(&target, "root", control).await?;
    let (folder, locator_path) = legacy_provider_inputs(window).await?;
    let approved = config(&folder)?;
    let locator = read(&locator_path, 16384, true)?;
    let coordinator = crate::vpn_credential::public_review(&locator, &approved.pin)?;
    if coordinator["host"] != "68.183.139.56" || coordinator["port"] != 22 || coordinator["account"] != "root" {
        return Err("Exact legacy coordinator SSH endpoint required".into());
    }
    let locator_pin = coordinator["locator_sha256"].as_str().ok_or("Exact coordinator locator required")?;
    let scope = crate::legacy_peer_preflight::retirement_scope(&plan, &approved.policy, &approved.pin, locator_pin, now()? + 120)?;
    let prompt = window.clone();
    let (verb, action, explanation) = if reconcile_only {
        ("Check original peer retirement", "Verify peer absence", "Provider reads verify absence only.")
    } else {
        ("Retire exact obsolete VPN peer", "Retire this peer once", "After verifying the public key, Portal will send one DELETE for this exact peer and verify absence. An interrupted removal can only be reconciled.")
    };
    let message = format!("{verb}?\nTarget: {}\nObsolete network: posy-apqe-canary-process-49028\nPlan SHA256: {}\nAccount: {}\nPeer: {} · {}\nWireGuard SHA256: {}\nCoordinator: vpn-coordinator.synergy-network.io\n{explanation}\nExisting coordinator credential is used in memory for up to 120 seconds. No enrollment or gateway filesystem operation is included.",
        target.label(), scope["plan_sha256"], scope["account_id"], scope["peer_id"], scope["ip"], scope["wireguard_public_key_sha256"]);
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        prompt.dialog().message(message).parent(&prompt).title(verb)
            .buttons(MessageDialogButtons::OkCancelCustom(action.into(), "Cancel".into())).blocking_show()
    }).await.map_err(|_| "Legacy retirement review interrupted")?;
    if !accepted { return Err("Legacy retirement review cancelled before provider contact".into()); }

    let expires = now()? + 120;
    let _serial = SERIAL.lock().await;
    let fresh = crate::legacy_gateway_plan::inspect(&target, "root", control).await?;
    let current = config(&folder)?;
    let current_locator = read(&locator_path, 16384, true)?;
    if fresh["plan_sha256"] != plan["plan_sha256"] || current.raw != approved.raw
        || current.ca.as_slice() != approved.ca.as_slice() || current_locator.as_slice() != locator.as_slice() || now()? >= expires
    {
        return Err("Legacy retirement scope changed before provider contact".into());
    }
    let scope = crate::legacy_peer_preflight::retirement_scope(&fresh, &current.policy, &current.pin, locator_pin, expires)?;
    if !reconcile_only {
        let request = crate::legacy_peer_preflight::key_request(&fresh, expires)?;
        let wire = serde_json::to_vec(&request).map_err(|_| "Cannot encode reviewed legacy peer key request")?;
        let raw = crate::vpn_credential::legacy_peer_proof(&current_locator, &current.pin, control, &wire).await?;
        crate::legacy_peer_preflight::key_result(&raw, &request, &fresh)?;
    }
    if now()? >= expires { return Err("Legacy retirement review expired before credential access".into()); }
    let credential = crate::vpn_credential::load(current_locator, &current.pin, true, control).await?;
    let retirement = legacy_provider_exchange(&current, &credential, &scope, Some((&directory, reconcile_only))).await?;
    let receipt = crate::legacy_peer_preflight::retirement_result(retirement, &scope)?;
    Ok(json!({"version":1,"ok":true,"result":receipt}))
}
pub(super) async fn legacy_peer_key_read(window: &tauri::WebviewWindow, target: Target, control: &Path) -> Result<Value,String> {
    use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
    use std::time::{SystemTime,UNIX_EPOCH};
    if !cfg!(all(debug_assertions, unix)) {
        return Err("Legacy peer key verification requires the isolated engineering native app".into());
    }
    let provider = option_env!("SYNERGY_NODENETWORK_QUALIFICATION_VPN_PROVIDER_SHA256")
        .ok_or("No approved coordinator profile is compiled into this app")?;
    let plan = crate::legacy_gateway_plan::inspect(&target, "root", control).await?;
    let now = || SystemTime::now().duration_since(UNIX_EPOCH).map(|v| v.as_secs()).map_err(|_| "Local clock unavailable");
    let request = crate::legacy_peer_preflight::key_request(&plan, now()? + 120)?;
    let select = window.clone();
    let locator_path = tauri::async_runtime::spawn_blocking(move || {
        select.dialog().file().add_filter("Public credential locator", &["json"]).set_parent(&select)
            .set_title("Choose approved public credential-locator.json").blocking_pick_file()
            .ok_or("Legacy peer key verification cancelled")?.into_path()
            .map_err(|_| "Local approved public locator required")
    }).await.map_err(|_| "Legacy peer key selection interrupted")??;
    if locator_path.file_name().and_then(|v| v.to_str()) != Some("credential-locator.json") {
        return Err("Select the approved public credential-locator.json".into());
    }
    let locator = read(&locator_path, 16384, true)?;
    let coordinator = crate::vpn_credential::public_review(&locator, provider)?;
    if coordinator["host"] != "68.183.139.56" || coordinator["port"] != 22 || coordinator["account"] != "root" {
        return Err("Exact legacy coordinator SSH endpoint required".into());
    }
    let prompt = window.clone();
    let message = format!("Verify one public WireGuard key binding on the pinned VPN coordinator?\nTarget: {}\nObsolete network: posy-apqe-canary-process-49028\nPlan SHA256: {}\nAccount: {}\nPeer: {}\nKey SHA256: {}\nCoordinator: {}:{}\nLocator SHA256: {}\nThe installed provider's exact public peer row is read once through the approved SSH session. No management token, enrollment, removal or host changes.",
        target.label(), plan["plan_sha256"], request["context"]["account_id"], request["context"]["peer_id"],
        request["context"]["wireguard_public_key_sha256"], coordinator["host"], coordinator["port"], coordinator["locator_sha256"]);
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        prompt.dialog().message(message).parent(&prompt).title("Verify exact legacy VPN peer key")
            .buttons(MessageDialogButtons::OkCancelCustom("Verify one public peer key".into(), "Cancel".into())).blocking_show()
    }).await.map_err(|_| "Legacy peer key review interrupted")?;
    if !accepted { return Err("Legacy peer key verification cancelled".into()); }
    let expires_at = now()? + 120;
    let _serial = SERIAL.lock().await;
    let fresh = crate::legacy_gateway_plan::inspect(&target, "root", control).await?;
    let current_locator = read(&locator_path, 16384, true)?;
    if fresh["plan_sha256"] != plan["plan_sha256"] || current_locator.as_slice() != locator.as_slice() || now()? >= expires_at {
        return Err("Legacy scope changed or review expired before the public key read".into());
    }
    let request = crate::legacy_peer_preflight::key_request(&fresh, expires_at)?;
    let wire = serde_json::to_vec(&request).map_err(|_| "Cannot encode exact legacy peer scope")?;
    let raw = crate::vpn_credential::legacy_peer_proof(&current_locator, provider, control, &wire).await?;
    if now()? >= expires_at || read(&locator_path, 16384, true)?.as_slice() != locator.as_slice() {
        return Err("Legacy peer observation expired or the locator changed".into());
    }
    Ok(json!({"version":1,"ok":true,"result":crate::legacy_peer_preflight::key_result(&raw, &request, &fresh)?}))
}

#[cfg(test)]pub(super) fn legacy_preflight_test_script(fake:&str)->String{format!("{PROVIDER}\n{fake}\n{}",crate::legacy_peer_preflight::RUNNER)}
async fn legacy_account_reads(config:&Config,credential:&[u8],scope:&Value)->Result<Value,String>{
 let value=legacy_provider_exchange(config,credential,scope,None).await?;
 crate::legacy_peer_preflight::result(&value,scope)
}

async fn legacy_provider_exchange(config:&Config,credential:&[u8],scope:&Value,retirement:Option<(&Path,bool)>)->Result<Value,String>{
 let refused=if retirement.is_some(){"No verified retirement receipt. If the original request was dispatched, check its result without repeating removal."}
  else{"Legacy peer account read unavailable; no retirement or enrollment was attempted"};
 let token=std::str::from_utf8(credential).map_err(|_|refused)?.trim_end_matches(['\r','\n']);
 if token.is_empty()||token.len()>4096||!token.bytes().all(|c|(33..=126).contains(&c)){return Err(refused.into())}
 #[derive(serde::Serialize)]struct LegacyReadWire<'a>{
  policy:&'a str,pin:&'a str,ca:String,token:&'a str,scope:&'a Value,
  #[serde(skip_serializing_if="Option::is_none")]directory:Option<&'a Path>,
  #[serde(skip_serializing_if="Option::is_none")]reconcile_only:Option<bool>,
 }
 let wire=Zeroizing::new(serde_json::to_vec(&LegacyReadWire{policy:&config.raw,pin:&config.pin,ca:STANDARD.encode(config.ca.as_slice()),token,scope,
  directory:retirement.map(|(path,_)|path),reconcile_only:retirement.map(|(_,reconcile)|reconcile)}).map_err(|_|refused)?);
 let script=format!("{PROVIDER}\n{}",if retirement.is_some(){crate::legacy_peer_preflight::RETIREMENT_RUNNER}else{crate::legacy_peer_preflight::RUNNER});
 let mut command=tokio::process::Command::new("/usr/bin/python3");command.args(["-I","-B","-c",&script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
 let mut child=command.spawn().map_err(|_|refused)?;
 let response=tokio::time::timeout(std::time::Duration::from_secs(40),async{
  let mut input=child.stdin.take().ok_or(refused)?;input.write_all(&wire).await.map_err(|_|refused)?;drop(input);
  let mut bytes=Vec::new();child.stdout.take().ok_or(refused)?.take(8193).read_to_end(&mut bytes).await.map_err(|_|refused)?;
  if bytes.len()>8192||!child.wait().await.map_err(|_|refused)?.success(){return Err(refused.to_string())}
  serde_json::from_slice(&bytes).map_err(|_|refused.to_owned())
 }).await.map_err(|_|refused.to_owned())?;
 response
}

pub async fn execute(base:&Path,target:Target,control:&Path,config_directory:&Path,credential_path:&Path,operation:&str)->Result<Value,String>{
 let _serial=SERIAL.lock().await;
 if !matches!(operation,"enroll"|"reconcile"|"revoke"|"retire"|"cancel_unused"){return Err("Unsupported native VPN workflow".into())}
 let config=config(config_directory)?;

 let original=lifecycle::bare_initial(base,&target)?.ok_or("VPN target requires its original native authorization receipt")?;
 let doc=crate::operator_authorization::verify_initial(&original,&target)?;
 let status=lifecycle::execute(base,target.clone(),Request{version:1,operation:"authorization_status".into(),parameters:json!({})},control).await?;
 if status["ok"]!=true{return Err("VPN target authorization is unavailable".into())}
 let mut context=binding(&target,&status["result"],&doc,&hash(original.as_bytes()))?;
 let gateway_tcp=crate::gateway_vpn::selection(&config.policy,&doc,&context)?;
 if let Some(tcp)=&gateway_tcp{
  let selected=lifecycle::execute(base,target.clone(),Request{version:1,operation:"gateway_target_status".into(),parameters:json!({})},control).await?;
  if selected["ok"]!=true{return Err("Gateway VPN requires verified commissioned gateway custody before provider access".into())}
  let selected=crate::gateway_target::review(&selected["result"],false)?;
  let preflight=lifecycle::execute(base,target.clone(),Request{version:1,operation:"gateway_vpn_preflight".into(),parameters:json!({"required_gateway_tcp":tcp})},control).await?;
  crate::gateway_vpn::preflight(&preflight,&selected,tcp,&doc["genesis_pins"]["genesis.json"])?;
 }
 let credential=crate::vpn_credential::load(read(credential_path,16384,true)?,&config.pin,matches!(config.policy["profile"].as_str(),Some("nodenetwork-controlled-canary-v1"|crate::gateway_vpn::PROFILE)),control).await?;
 let app=base.join("nodenetwork-vpn-v1");if !app.exists(){#[cfg(unix)]{use std::os::unix::fs::DirBuilderExt;std::fs::DirBuilder::new().mode(0o700).create(&app).map_err(|_|"Cannot protect native VPN state")?;}}
 let mut directory=state_directory(base,&target)?;
 let mut result=lifecycle::execute(base,target.clone(),Request{version:1,operation:"vpn_status".into(),parameters:json!({})},control).await?;
 if result["ok"]!=true{return Err("Read native VPN status before dispatch".into())}
 let unused;
 {
  let reply=lifecycle::execute(base,target.clone(),Request{version:1,operation:"vpn_unused_preflight".into(),parameters:json!({})},control).await?;
  if reply["ok"]!=true{return Err("Read exact original VPN attempt state before any further provider action".into())}
  unused=reply["result"].clone();
  let scope=attempt_scope(&unused,&context,if operation=="reconcile"&&result["result"]["enrollment_staged"]==true{"enroll"}else{operation})?;
  for pin in unused["attempt_scopes"].as_array().ok_or("VPN attempt scopes unavailable")?{directory=directory.join(format!("retry-{}",pin.as_str().ok_or("Invalid VPN attempt scope")?));}
  if let Some(pin)=scope{
   context["attempt_sha256"]=json!(pin);
   if unused["scope_sha256"]!=pin{directory=directory.join(format!("retry-{pin}"));}
  }
 }
 if operation=="cancel_unused"{
  if unused["quiescent"]!=true||!unused["attempt_sha256"].is_string(){return Err("Stop the exact owned node/VPN and preserve the original attempt before unused cancellation".into())}
  let(public,_)=provider(&config,&credential,&directory,"cancel_unused",&context,&unused).await?;
  if !unused_proof(&public)||public["binding"]!=context||public["attempt_sha256"]!=unused["attempt_sha256"]{return Err("Provider unused cancellation proof differs from original target".into())}
  let raw=serde_json::to_vec(&public).map_err(|_|"Cannot encode exact unused cancellation")?;
  let cancelled=hash(json!({"kind":"cancel","receipt":public}).to_string().as_bytes());
  if unused["retry_after_sha256"]==cancelled&&unused["pending_cancellation_sha256"].is_null(){return Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-unused-cancellation-v1","cancelled":true,"retry_requires_new_confirmation":true,"attempt_sha256":unused["attempt_sha256"],"cancellation_sha256":cancelled}}))}
  let request=Request{version:1,operation:"vpn_cancel_unused".into(),parameters:json!({"attempt_sha256":unused["attempt_sha256"]})};
  if unused["pending_cancellation_sha256"].is_null(){
   lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-unused-cancellation.json",bytes:&raw,ca:None,provider:None}).await?;
  }else if unused["pending_cancellation_sha256"]!=hash(&raw){return Err("Pending cancellation proof changed; preserve original intent".into())}
  let reply=lifecycle::execute(base,target,request,control).await?;
  if reply["ok"]!=true||reply["result"]["schema"]!="nodenetwork-vpn-unused-cancellation-v1"||reply["result"]["cancelled"]!=true||reply["result"]["retry_requires_new_confirmation"]!=true||reply["result"]["attempt_sha256"]!=unused["attempt_sha256"]||reply["result"]["cancellation_sha256"]!=hash(json!({"kind":"cancel","receipt":public}).to_string().as_bytes()){return Err("Unused cancellation outcome must reconcile; never enroll automatically".into())}
  return Ok(reply)
 }
 if operation=="retire"{
  let(public,_)=provider(&config,&credential,&directory,"retire",&context,&result["result"]).await?;
  if result["result"]["retired"]==true{return Ok(json!({"version":1,"ok":true,"result":{"schema":"nodenetwork-vpn-retirement-v1","retired":true,"absence_verified":true,"peer_id":public["peer_id"]}}))}
  let raw=serde_json::to_vec(&public).map_err(|_|"Cannot encode exact provider retirement")?;
  let request=Request{version:1,operation:"vpn_retire".into(),parameters:json!({})};
  lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-retirement.json",bytes:&raw,ca:None,provider:None}).await?;
  return lifecycle::execute(base,target,request,control).await;
 }
 if operation=="revoke"{
  let(public,_)=provider(&config,&credential,&directory,"revoke",&context,&Value::Null).await?;return Ok(json!({"version":1,"ok":true,"result":public}))
 }
 if operation=="enroll"{
  let current=&result["result"];
  if current["service_registered"]!=true||current["enrollment_recorded"]!=false||current["reconciliation_required"]!=false||current["enrollment_staged"]!=false{return Err("Register a fresh VPN service and reconcile any prior enrollment before issuing one key".into())}
  let(public,secret)=provider(&config,&credential,&directory,"prepare",&context,&Value::Null).await?;
  let mut data=Zeroizing::new(crate::gateway_vpn::enrollment(&config.policy,&public["name"],secret.as_str(),gateway_tcp.as_ref())?);
  let request=Request{version:1,operation:"vpn_enroll".into(),parameters:context.get("attempt_sha256").map_or_else(||json!({}),|pin|json!({"attempt_sha256":pin}))};
  lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-enrollment.json",bytes:&data,ca:Some(config.ca.as_slice()),provider:Some(config.raw.as_bytes())}).await?;
  use zeroize::Zeroize;data.zeroize();
  result=lifecycle::execute(base,target.clone(),request,control).await?;
  if result["ok"]!=true{return Err(enrollment_controller_refusal(&result))}
 }
 if operation=="reconcile"&&result["result"]["enrollment_recorded"]==false&&result["result"]["enrollment_staged"]==true&&result["result"]["reconciliation_required"]==false{
  // The target's durable attempt fence is absent: enrollment never dispatched.
  // Use only its existing exact one-use grant; do not restage/reissue a key.
  result=lifecycle::execute(base,target.clone(),Request{version:1,operation:"vpn_enroll".into(),parameters:context.get("attempt_sha256").map_or_else(||json!({}),|pin|json!({"attempt_sha256":pin}))},control).await?;
  if result["ok"]!=true{return Err("Original staged enrollment could not be dispatched; preserve it and reconcile or cancel its exact key".into())}
 }
 let local=if operation=="reconcile"&&result["result"]["enrollment_recorded"]==false{
  let observed=lifecycle::execute(base,target.clone(),Request{version:1,operation:"vpn_diagnostics".into(),parameters:json!({})},control).await?;
  if observed["ok"]!=true{return Err("Read original VPN diagnostics before reconciliation; do not enroll again".into())}
  let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"VPN recovery clock unavailable")?.as_millis();
  recovery_identity(&observed["result"],&result["result"],&context,&config.policy,u64::try_from(now).map_err(|_|"VPN recovery clock overflow")?)?
 }else{
  if result["result"]["enrollment_recorded"]!=true{return Err("Native enrollment is absent or uncertain; preserve intent for provider reconciliation".into())}
  result["result"]["enrollment"].clone()
 };
 let(public,_)=provider(&config,&credential,&directory,"reconcile",&context,&local).await?;
 if result["result"]["server_bound"]!=true{
  let raw=serde_json::to_vec(&public).map_err(|_|"Cannot encode independently verified binding")?;
  let request=Request{version:1,operation:"vpn_bind".into(),parameters:json!({})};
  lifecycle::vpn_grant(base,&target,&request,control,crate::operator_authorization::NativeVpnArtifact{name:"vpn-server-binding.json",bytes:&raw,ca:None,provider:None}).await?;
  result=lifecycle::execute(base,target,request,control).await?;
 }
 if result["ok"]!=true||result["result"]["enrollment_recorded"]!=true||result["result"]["server_bound"]!=true||result["result"]["connected"]!=true{return Err("Original VPN binding did not complete; preserve intent and reconcile without reissuing".into())}
 // Remove the consumed setup key only after independent provider+local binding.
 provider(&config,&credential,&directory,"revoke",&context,&Value::Null).await?;
 if let Some(object)=result.get_mut("result").and_then(Value::as_object_mut){object.remove("enrollment");}
 Ok(result)
}
#[cfg(test)]mod tests{
 use super::*;
 pub(super) fn fixture()->(Target,Value,Value,String){
  let t=Target{kind:"remote".into(),host:Some("guest.example".into()),port:Some(22),root:"/opt/synergy".into(),guest:None};
  let doc=json!({"target":t.journal_identity(),"release_id":"original","manifest_sha256":"a".repeat(64),"network_id":"isolated-network","chain_id":999998,"node_name":"validator-test","artifacts":{"formation-context.json":"b".repeat(64)}});
  let selection=json!({"release_id":doc["release_id"],"manifest_sha256":doc["manifest_sha256"],"network_id":doc["network_id"],"chain_id":doc["chain_id"],"node_name":doc["node_name"]});let pin=hash(doc.to_string().as_bytes());
  let status=json!({"schema":"nodenetwork-engineering-authorization-status-v1","target":doc["target"],"initial_sha256":pin,"selection":selection,"formation_sha256":"b".repeat(64)});(t,doc,status,pin)
 }
 fn upgrade(s:&mut Value){let origin=s["selection"].clone();s["initial_selection"]=origin;s["selection"]["release_id"]=json!("upgraded");s["selection"]["manifest_sha256"]=json!("c".repeat(64));s["update"]=json!({"initial_sha256":s["initial_sha256"],"formation_sha256":s["formation_sha256"],"previous_selection":s["initial_selection"],"selection":s["selection"]});}
 #[test]fn uncertain_receipt_recovery_uses_fresh_native_identity_without_claiming_peer_connectivity(){
  let current=json!({"service_registered":true,"enrollment_recorded":false,"enrollment_staged":false,"reconciliation_required":true,"server_bound":false});
  let diagnostic=json!({"schema":"nodenetwork-vpn-diagnostics-v1","observed_at_ms":100_000,"mutation_performed":false,"enrollment":current,"trust":{"mode":"approved_private_ca","error_code":null},"client":{"available":true,"management_connected":true,"signal_connected":true,"wireguard_public_key":STANDARD.encode([3;32]),"overlay_address":"100.64.0.2/16","error_code":null},"peers":[{"reachable":false}]});
  let context=json!({"target_sha256":"a".repeat(64)});let policy=json!({"management_origin":"https://original.example"});
  let local=recovery_identity(&diagnostic,&current,&context,&policy,100_001).unwrap();
  assert_eq!(local["hostname"],format!("nn-{}",&hash(context.to_string().as_bytes())[..60]));
  assert_eq!(local["management_url"],policy["management_origin"]);assert!(local.get("verified_peer_ips").is_none());assert!(local.get("setup_key").is_none());
  for (field,value) in [("enrollment_recorded",json!(true)),("reconciliation_required",json!(false)),("enrollment_staged",json!(true)),("service_registered",json!(false)),("server_bound",json!(true))]{let mut changed=current.clone();changed[field]=value;assert!(recovery_identity(&diagnostic,&changed,&context,&policy,100_001).is_err())}
  for (field,value) in [("management_connected",json!(false)),("signal_connected",json!(false)),("wireguard_public_key",json!("invalid")),("overlay_address",json!("127.0.0.1/8")),("overlay_address",json!("100.64.0.2/99"))]{let mut changed=diagnostic.clone();changed["client"][field]=value;assert!(recovery_identity(&changed,&current,&context,&policy,100_001).is_err())}
  assert!(recovery_identity(&diagnostic,&current,&context,&policy,220_001).is_err());let mut future=diagnostic.clone();future["observed_at_ms"]=json!(130_002);assert!(recovery_identity(&future,&current,&context,&policy,100_001).is_err());
  let mut changed=diagnostic.clone();changed["trust"]["error_code"]=json!("approved_trust_scope_refused");assert!(recovery_identity(&changed,&current,&context,&policy,100_001).is_err());
 }
 #[test]fn controller_enrollment_refusal_preserves_only_public_categories(){
  let error=json!({"error":{"code":"vpn_reconciliation_required","message":"secret-token-not-public"}});
  let public=enrollment_controller_refusal(&error);assert!(public.starts_with("vpn_reconciliation_required:"));assert!(!public.contains("secret-token"));
  assert!(enrollment_controller_refusal(&json!({"error":{"code":"authorization_required"}})).starts_with("authorization_required:"));
  let error=json!({"error":{"code":"untrusted-secret-code","message":"untrusted-secret-message"}});assert!(!enrollment_controller_refusal(&error).contains("untrusted-secret"));
 }
 #[test]fn authenticated_upgrade_preserves_exact_original_provider_intent_binding(){
  let(t,doc,mut status,pin)=fixture();let original=binding(&t,&status,&doc,&pin).unwrap();upgrade(&mut status);assert_eq!(binding(&t,&status,&doc,&pin).unwrap(),original);assert_eq!(original["manifest_sha256"],doc["manifest_sha256"]);
  let mut mixed_case=doc.clone();mixed_case["target"]["host"]=json!("GUEST.EXAMPLE");let mut same=status.clone();same["target"]=mixed_case["target"].clone();assert_eq!(binding(&t,&same,&mixed_case,&pin).unwrap(),original);
  // During a reviewed update the still-current previous selection is also valid.
  let adopted=status["selection"].clone();status["selection"]=status["initial_selection"].clone();assert_eq!(binding(&t,&status,&doc,&pin).unwrap(),original);status["selection"]=adopted;
 }
 #[test]fn forged_adoption_or_changed_origin_scope_never_rebinds_existing_vpn(){
  let(t,doc,mut status,pin)=fixture();upgrade(&mut status);
  for field in ["initial_sha256","formation_sha256","selection","previous_selection"]{let mut bad=status.clone();if field=="previous_selection"{bad["update"]["selection"]=Value::Null;}bad["update"][field]=Value::Null;assert!(binding(&t,&bad,&doc,&pin).is_err(),"{field}");}
  for field in ["target","initial_selection","initial_sha256","formation_sha256"]{let mut bad=status.clone();bad[field]=Value::Null;assert!(binding(&t,&bad,&doc,&pin).is_err(),"{field}");}
  for field in ["network_id","chain_id","node_name"]{let mut bad=status.clone();bad["selection"][field]=Value::Null;bad["update"]["selection"]=bad["selection"].clone();assert!(binding(&t,&bad,&doc,&pin).is_err(),"{field}");}
  let mut wrong=t.clone();wrong.host=Some("substituted.example".into());assert!(binding(&wrong,&status,&doc,&pin).is_err());
  let mut no_origin=status;no_origin.as_object_mut().unwrap().remove("initial_selection");assert!(binding(&t,&no_origin,&doc,&pin).is_err());
 }
}

#[cfg(test)]mod cleanup_tests{
 use super::*;
 #[test]fn only_exact_cleanup_actions_can_use_expired_approval_mode(){
  assert_eq!(cleanup_action("cancel_unused").unwrap(),Some("revoke"));
  assert_eq!(cleanup_action("revoke").unwrap(),Some("revoke"));assert_eq!(cleanup_action("retire").unwrap(),Some("retire"));
  for op in ["prepare","reconcile"]{assert_eq!(cleanup_action(op).unwrap(),None)}for op in ["enroll","delete","","Revoke"]{assert!(cleanup_action(op).is_err())}
 }
}

#[cfg(test)]mod reinstallation_tests{
 use super::*;
 fn write(path:&Path,value:&Value){std::fs::write(path,value.to_string()).unwrap();#[cfg(unix)]{use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(path,std::fs::Permissions::from_mode(0o600)).unwrap();}}
 #[test]fn original_provider_must_be_exactly_retired_and_new_incarnation_has_separate_state(){
  let base=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-vpn-retired-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
  struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(base.clone());std::fs::create_dir(&base).unwrap();
  let(t,doc,status,pin)=super::tests::fixture();let binding=super::binding(&t,&status,&doc,&pin).unwrap();
  assert!(require_terminal(&base,&t,&doc).is_ok());let directory=state_directory(&base,&t).unwrap();std::fs::create_dir_all(&directory).unwrap();assert!(require_terminal(&base,&t,&doc).is_err());
  let intent=json!({"binding":binding,"account_id":"account","name":"exact","provider_sha256":"c".repeat(64)});let bound=json!({"binding":binding,"peer_id":"peer","name":"exact","hostname":"host","ip":"100.64.0.2","provider_account_id":"account","wireguard_public_key":STANDARD.encode([3u8;32]),"new_peer_verified":true,"one_off_usage_verified":true});
  let deletion=json!({"binding":binding,"peer_id":"peer","enrollment_sha256":"a".repeat(64),"binding_sha256":"b".repeat(64)});
  let retired=json!({"format":"synergy-vpn-retirement-v1","retired":true,"absence_verified":true,"account_id":"account","peer_id":"peer","peer_name":"exact","hostname":"host","ip":"100.64.0.2","enrollment_sha256":"a".repeat(64),"binding_sha256":"b".repeat(64)});
  for(n,v)in[("intent.json",&intent),("bound.json",&bound),("retire-intent.json",&deletion),("retired.json",&retired)]{write(&directory.join(n),v)}assert!(require_terminal(&base,&t,&doc).is_ok());
  for key in["retired","absence_verified","peer_id","peer_name","account_id","ip","enrollment_sha256","binding_sha256"]{let mut wrong=retired.clone();wrong[key]=Value::Null;write(&directory.join("retired.json"),&wrong);assert!(require_terminal(&base,&t,&doc).is_err(),"{key}");}write(&directory.join("retired.json"),&retired);
  // Matching absent JSON fields must never count as attribution (Null != proof).
  for key in["account_id","name","peer_id","hostname","ip","enrollment_sha256","binding_sha256","provider_account_id","wireguard_public_key","new_peer_verified","one_off_usage_verified","provider_sha256"]{
   for(n,v)in[("intent.json",&intent),("bound.json",&bound),("retire-intent.json",&deletion),("retired.json",&retired)]{let mut missing=v.clone();missing.as_object_mut().unwrap().remove(key);write(&directory.join(n),&missing)}assert!(require_terminal(&base,&t,&doc).is_err(),"missing {key}");
  }
  for(n,v)in[("intent.json",&intent),("bound.json",&bound),("retire-intent.json",&deletion),("retired.json",&retired)]{write(&directory.join(n),v)}
  let mut foreign=doc.clone();foreign["manifest_sha256"]=json!("f".repeat(64));assert!(require_terminal(&base,&t,&foreign).is_err());
  let app=base.join("nodenetwork-engineering-v1");std::fs::create_dir(&app).unwrap();#[cfg(unix)]{use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(&app,std::fs::Permissions::from_mode(0o700)).unwrap();}
  write(&app.join(format!("incarnation-{}.json",hash(t.journal_identity().to_string().as_bytes()))),&json!({"initial_sha256":"f".repeat(64),"target_sha256":hash(t.journal_identity().to_string().as_bytes())}));assert_ne!(state_directory(&base,&t).unwrap(),directory);assert!(directory.join("retired.json").exists());
 }
}

#[cfg(test)]mod unused_tests{
 use super::*;
 #[test]fn retry_scope_is_exact_and_ordinary_requests_remain_distinct(){
  let origin=json!({"target_sha256":"a".repeat(64),"manifest_sha256":"b".repeat(64),"formation_sha256":"c".repeat(64),"network_id":"fresh","chain_id":99999});
  let mut state=json!({"schema":"nodenetwork-vpn-unused-preflight-v1","quiescent":true,"attempt_sha256":"d".repeat(64),"scope_sha256":null,"retry_after_sha256":"e".repeat(64),"pending_cancellation_sha256":null,"attempt_scopes":[],"binding":origin});
  assert_eq!(attempt_scope(&state,&origin,"cancel_unused").unwrap(),None);
  assert_eq!(attempt_scope(&state,&origin,"enroll").unwrap(),Some("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"));
  state["scope_sha256"]=json!("e".repeat(64));state["attempt_scopes"]=json!(["e".repeat(64)]);state["binding"]["attempt_sha256"]=state["scope_sha256"].clone();state["retry_after_sha256"]=Value::Null;
  assert_eq!(attempt_scope(&state,&origin,"reconcile").unwrap(),state["scope_sha256"].as_str());
  let request=Request{version:1,operation:"vpn_enroll".into(),parameters:json!({"attempt_sha256":"e".repeat(64)})};assert!(request.validate().unwrap());
  let mut original=request.clone();original.parameters=json!({});assert_ne!(request.approval_id(),original.approval_id());assert!(original.validate().unwrap());
  original.operation="vpn_cancel_unused".into();assert!(original.validate().is_err());original.parameters=request.parameters.clone();assert!(original.validate().unwrap());
  for field in ["binding","attempt_scopes","scope_sha256","schema"]{let mut wrong=state.clone();wrong[field]=Value::Null;assert!(attempt_scope(&wrong,&origin,"enroll").is_err(),"{field}")}
 }
 #[test]fn canceled_provider_history_is_terminal_only_when_every_exact_retry_is_terminal(){
  use std::os::unix::fs::PermissionsExt;
  let dir=std::env::temp_dir().canonicalize().unwrap().join(format!("nn-unused-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
  struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(dir.clone());std::fs::create_dir(&dir).unwrap();
  fn save(path:&Path,value:&Value){std::fs::write(path,value.to_string()).unwrap();std::fs::set_permissions(path,std::fs::Permissions::from_mode(0o600)).unwrap()}
  fn canceled(dir:&Path,binding:&Value)->Value{
   let intent=json!({"binding":binding,"account_id":"account","name":"exact","provider_sha256":"c".repeat(64)});
   let proof=json!({"format":"nodenetwork-vpn-unused-cancellation-v1","binding":binding,"account_id":"account","name":"exact","setup_key_id":"key","provider_sha256":"c".repeat(64),"intent_sha256":hash(intent.to_string().as_bytes()),"attempt_sha256":"d".repeat(64),"unused_verified":true,"setup_key_absent":true,"peer_absence_verified":true});
   for(name,value)in[("intent.json",intent),("issued.json",json!({"binding":binding,"name":"exact","setup_key_id":"key"})),("cancel-unused-intent.json",proof.clone()),("cancelled-unused.json",proof.clone())]{save(&dir.join(name),&value)}proof
  }
  let binding=json!({"target_sha256":"a".repeat(64)});let proof=canceled(&dir,&binding);assert!(terminal_directory(&dir,&binding,0).is_ok());
  for key in ["attempt_sha256","unused_verified","account_id","setup_key_id"]{let mut bad=proof.clone();bad.as_object_mut().unwrap().remove(key);save(&dir.join("cancelled-unused.json"),&bad);assert!(terminal_directory(&dir,&binding,0).is_err())}save(&dir.join("cancelled-unused.json"),&proof);
  let pin=hash(json!({"kind":"cancel","receipt":proof}).to_string().as_bytes());let child=dir.join(format!("retry-{pin}"));std::fs::create_dir(&child).unwrap();assert!(terminal_directory(&dir,&binding,0).is_err());
  let mut next=binding.clone();next["attempt_sha256"]=json!(pin);canceled(&child,&next);assert!(terminal_directory(&dir,&binding,0).is_ok());
  let foreign=dir.join("retry-foreign");std::fs::create_dir(&foreign).unwrap();assert!(terminal_directory(&dir,&binding,0).is_err());
 }
}
