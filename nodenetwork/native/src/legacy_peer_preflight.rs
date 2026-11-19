//! Separate, one-use credential-access purpose. Never authorizes peer deletion.
use crate::gateway_admission::{exact,pin};
use serde_json::{json,Value};
const REFUSED:&str="Legacy peer account read refused; no retirement or enrollment was attempted";
pub(super) fn scope(plan:&Value,policy:&Value,provider:&str,locator:&str,expires:u64)->Result<Value,String>{
 let b=&plan["legacy"]["vpn_binding"];
 if plan["schema"]!="nodenetwork-legacy-canary-retirement-plan-v1"||!pin(&plan["plan_sha256"])||plan["removal_authorized"]!=false||plan["mutation_performed"]!=false
  ||plan["legacy"]["old_network"]["network_id"]!="posy-apqe-canary-process-49028"
  ||plan["machine_id_sha256"]!="8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d"
  ||plan["legacy"]["old_network"]["genesis_sha256"]!="d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7"
  ||b["enrollment_sha256"]!="f27a0e0031ba00f2a234e77e55449ca5f4b9a15dec7e2c8da3da5bde6ea37573"||b["binding_sha256"]!="1629d857606c040ecbd7ed9d5dc692ac697dda3b129cc1f8b2bb9834e594d5f2"
  ||b["peer_name"]!="synergy-canary-rpc-99999"||b["hostname"]!="vmi3381382"
  ||b["peer_id"]!="dboqb9if611ohpqo0e1g"||b["ip"]!="10.69.51.205"||b["wireguard_public_key"]!="EhHDd/L7fXX+c8x2nyJx8wWUwGRij3AmioVZKiH4/2M="||b["retirement_verified"]!=false
  ||policy["api_origin"]!="https://vpn-coordinator.synergy-network.io"||policy["management_origin"]!="https://vpn-coordinator.synergy-network.io"
  ||policy["account_id"]!="da99e12f611ghl16dvjg"
  ||!pin(&json!(provider))||!pin(&json!(locator))||!pin(&policy["ca_sha256"]){return Err(REFUSED.into())}
 Ok(json!({"purpose":"nodenetwork-legacy-peer-account-read-v1","plan_sha256":plan["plan_sha256"],"provider_sha256":provider,
  "credential_locator_sha256":locator,"ca_sha256":policy["ca_sha256"],"account_id":policy["account_id"],"peer_id":b["peer_id"],"peer_name":b["peer_name"],"hostname":b["hostname"],"ip":b["ip"],"wireguard_public_key":b["wireguard_public_key"],"expires_at":expires}))
}
pub(super) fn result(value:&Value,scope:&Value)->Result<Value,String>{
 if !exact(value,&["schema","plan_sha256","provider_sha256","account_id","peer_id","ready","account_verified","peer_verified","public_key_verified","blocker","mutation_performed","retirement_authorized"])
  ||value["schema"]!="nodenetwork-legacy-peer-retirement-preflight-v1"||["plan_sha256","provider_sha256","account_id","peer_id"].iter().any(|k|value[*k]!=scope[*k])
  ||["ready","public_key_verified","mutation_performed","retirement_authorized"].iter().any(|k|value[*k]!=false)
  ||value["account_verified"]!=true||value["peer_verified"]!=true||value["blocker"]!="independent_peer_key_binding_unavailable"{return Err(REFUSED.into())}Ok(value.clone())
}
// Appended to the already authenticated provider library. Only GETs; no
// Authorization/issuance state is instantiated and no private data is exported.
pub(super) const RUNNER:&str=r#"
import base64,sys
try:
 wire=decode(sys.stdin.buffer.read(256*1024+1))
 scope=wire['scope']
 require(scope['purpose']=='nodenetwork-legacy-peer-account-read-v1','Exact native purpose required')
 ca=base64.b64decode(wire['ca'],validate=True)
 policy=provider_policy(wire['policy'].encode(),wire['pin'],ca,int(time.time()),cleanup_action='retire')
 require(policy['account_id']==scope['account_id'] and policy['api_origin']==policy['management_origin']=='https://vpn-coordinator.synergy-network.io','Coordinator transport differs')
 client=HttpsProvider(policy,ca,wire['token'])
 def get(path):
  require(type(scope['expires_at']) is int and int(time.time())<scope['expires_at']<=int(time.time())+120,'Native purpose expired')
  code,value=client.request('GET',path)
  require(code==200,'Authenticated read refused')
  return value
 accounts=get('/api/accounts')
 require(isinstance(accounts,list) and len(accounts)==1 and isinstance(accounts[0],dict) and accounts[0].get('id')==scope['account_id'],'Account differs')
 def matches(peer):
  return isinstance(peer,dict) and all(peer.get(remote)==scope[local] for remote,local in [('id','peer_id'),('name','peer_name'),('hostname','hostname'),('ip','ip')])
 peer=get('/api/peers/'+scope['peer_id']);require(matches(peer),'Peer differs')
 peers=get('/api/peers')
 require(isinstance(peers,list) and len(peers)<=8192 and all(isinstance(p,dict) and identifier(p.get('id')) for p in peers) and len({p['id'] for p in peers})==len(peers),'Peer inventory invalid')
 selected=[p for p in peers if p.get('id')==scope['peer_id'] or p.get('name')==scope['peer_name'] or p.get('ip')==scope['ip']]
 require(len(selected)==1 and matches(selected[0]),'Peer inventory ambiguous')
 result={'schema':'nodenetwork-legacy-peer-retirement-preflight-v1',**{k:scope[k] for k in ['plan_sha256','provider_sha256','account_id','peer_id']},'ready':False,'account_verified':True,'peer_verified':True,'public_key_verified':False,'blocker':'independent_peer_key_binding_unavailable','mutation_performed':False,'retirement_authorized':False}
 sys.stdout.buffer.write(encode(result))
except Exception:
 sys.exit(1)
"#;
#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->Value{json!({"schema":"nodenetwork-legacy-peer-retirement-preflight-v1","plan_sha256":"a".repeat(64),"provider_sha256":"b".repeat(64),"account_id":"account","peer_id":"dboqb9if611ohpqo0e1g","ready":false,"account_verified":true,"peer_verified":true,"public_key_verified":false,"blocker":"independent_peer_key_binding_unavailable","mutation_performed":false,"retirement_authorized":false})}
 #[test]fn legacy_peer_preflight_never_authorizes_or_infers_key_proof(){let v=fixture();assert!(result(&v,&v).is_ok());for k in ["ready","public_key_verified","mutation_performed","retirement_authorized"]{let mut b=v.clone();b[k]=json!(true);assert!(result(&b,&v).is_err())}for k in ["plan_sha256","provider_sha256","account_id","peer_id"]{let mut b=v.clone();b[k]=json!("foreign");assert!(result(&b,&v).is_err())}let mut b=v.clone();b["extra"]=json!("private");assert!(result(&b,&v).is_err());}
 #[test]fn legacy_peer_preflight_runner_cannot_issue_or_delete(){assert!(!RUNNER.contains("DELETE"));assert!(!RUNNER.contains("POST"));assert!(!RUNNER.contains("Authorization("));assert!(RUNNER.contains("client.request('GET',path)"));assert!(RUNNER.contains("public_key_verified':False"));}
 #[test]fn legacy_peer_preflight_fixed_request_requires_native_review_not_unreviewed_read(){use crate::node_controller::Request;let request=Request{version:1,operation:"legacy_peer_preflight".into(),parameters:json!({})};assert_eq!(request.validate(),Ok(true));let mut bad=request;bad.parameters=json!({"account":"foreign"});assert!(bad.validate().is_err());}

 #[test]fn legacy_peer_preflight_scope_binds_exact_public_legacy_inputs(){
  let b=json!({"peer_id":"dboqb9if611ohpqo0e1g","peer_name":"synergy-canary-rpc-99999","hostname":"vmi3381382","ip":"10.69.51.205","wireguard_public_key":"EhHDd/L7fXX+c8x2nyJx8wWUwGRij3AmioVZKiH4/2M=","retirement_verified":false,"enrollment_sha256":"f27a0e0031ba00f2a234e77e55449ca5f4b9a15dec7e2c8da3da5bde6ea37573","binding_sha256":"1629d857606c040ecbd7ed9d5dc692ac697dda3b129cc1f8b2bb9834e594d5f2"});
  let plan=json!({"schema":"nodenetwork-legacy-canary-retirement-plan-v1","plan_sha256":"a".repeat(64),"removal_authorized":false,"mutation_performed":false,"machine_id_sha256":"8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d","legacy":{"old_network":{"network_id":"posy-apqe-canary-process-49028","genesis_sha256":"d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7"},"vpn_binding":b}});
  let policy=json!({"api_origin":"https://vpn-coordinator.synergy-network.io","management_origin":"https://vpn-coordinator.synergy-network.io","account_id":"da99e12f611ghl16dvjg","ca_sha256":"c".repeat(64)});
  assert!(scope(&plan,&policy,&"b".repeat(64),&"d".repeat(64),1000).is_ok());
  for key in ["peer_id","wireguard_public_key","enrollment_sha256"]{let mut wrong=plan.clone();wrong["legacy"]["vpn_binding"][key]=json!("foreign");assert!(scope(&wrong,&policy,&"b".repeat(64),&"d".repeat(64),1000).is_err())}
 }
 #[cfg(unix)]#[test]fn legacy_peer_preflight_actual_runner_reads_only_fixed_public_prerequisites(){
  use base64::Engine as _;use sha2::{Digest,Sha256};use std::{io::Write,process::{Command,Stdio},time::{SystemTime,UNIX_EPOCH}};
  let ca=b"public fixture CA";let raw=serde_json::to_string(&json!({"version":1,"profile":"nodenetwork-controlled-canary-v1","network_binding":{"network_id":"synergy-posy-canary-20261117","chain_id":99999,"formation_sha256":"a".repeat(64)},"api_origin":"https://vpn-coordinator.synergy-network.io","management_origin":"https://vpn-coordinator.synergy-network.io","account_id":"da99e12f611ghl16dvjg","ca_sha256":format!("{:x}",Sha256::digest(ca)),"auto_groups":[],"required_peer_ips":["10.69.51.205"],"expires_at":1})).unwrap();
  let pin=format!("{:x}",Sha256::digest(raw.as_bytes()));let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
  let expected=json!({"purpose":"nodenetwork-legacy-peer-account-read-v1","plan_sha256":"a".repeat(64),"provider_sha256":pin,"account_id":"da99e12f611ghl16dvjg","peer_id":"dboqb9if611ohpqo0e1g","peer_name":"synergy-canary-rpc-99999","hostname":"vmi3381382","ip":"10.69.51.205","expires_at":now+100});
  for mode in ["good","foreign_account","foreign_peer","duplicate"]{
   let fake=format!(r#"class HttpsProvider:
 def __init__(self,*args):pass
 def request(self,method,path):
  assert method=='GET'
  peer={{'id':'dboqb9if611ohpqo0e1g','name':'synergy-canary-rpc-99999','hostname':'vmi3381382','ip':'10.69.51.205','public_key':'untrusted extension'}}
  mode='{mode}'
  if path=='/api/accounts':return 200,[{{'id':'foreign' if mode=='foreign_account' else 'da99e12f611ghl16dvjg'}}]
  if path=='/api/peers/dboqb9if611ohpqo0e1g':return 200,{{**peer,'id':'foreign'}} if mode=='foreign_peer' else peer
  assert path=='/api/peers'
  return 200,[peer,peer] if mode=='duplicate' else [peer]
"#);
   let script=crate::vpn_enrollment::legacy_preflight_test_script(&fake);let wire=json!({"scope":expected,"policy":raw,"pin":pin,"ca":base64::engine::general_purpose::STANDARD.encode(ca),"token":"SYNTHETIC-NOT-A-CREDENTIAL"});
   let mut child=Command::new("/usr/bin/python3").args(["-I","-B","-c",&script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
   child.stdin.take().unwrap().write_all(&serde_json::to_vec(&wire).unwrap()).unwrap();let output=child.wait_with_output().unwrap();
   if mode=="good"{assert!(output.status.success());let value=serde_json::from_slice(&output.stdout).unwrap();assert!(result(&value,&expected).is_ok());}else{assert!(!output.status.success());assert!(output.stdout.is_empty());}
  }
 }

}
