import {consensusObservation,consensusTransactionSelector} from './consensus-observation.js';
import {isTauri,invoke} from "@tauri-apps/api/core";
import {parseRequestHistory} from './request-history.js';
import {genesisStageLocalReview} from './genesis-stage-files.js';
import {verifyIdentityRequest} from './identity-evidence.js';
export async function nodeNetworkRequests(){
 if(!isTauri())throw Error('Local request history requires the native Portal app. No native history has been read.');
 return parseRequestHistory(await invoke('portal_nodenetwork_requests'));
}
const custodyReceiptPorts = {
 genesis_stage:{command:'portal_nodenetwork_review_genesis_stage_receipt',schema:'nodenetwork-genesis-stage-receipt-review-v1',label:'Genesis staging'},
 genesis_bind:{command:'portal_nodenetwork_review_genesis_binding_receipt',schema:'nodenetwork-genesis-binding-receipt-review-v1',label:'Genesis binding'},
 formation_prepare:{command:'portal_nodenetwork_review_formation_receipt',schema:'nodenetwork-formation-receipt-review-v1',label:'formation preparation'},
 identity_generate:{command:'portal_nodenetwork_review_identity_receipt',schema:'nodenetwork-identity-receipt-review-v1',label:'identity preparation'},
};
export async function nodeNetworkReviewCustodyReceipt(target, recordId, operation) {
 if (!Object.hasOwn(custodyReceiptPorts, operation)) throw Error('Select a supported custody receipt review.');
 const {command,schema,label}=custodyReceiptPorts[operation];
 if (!isTauri()) throw Error(`The ${label} receipt review requires the native Portal app.`);
 const reply=await invoke(command,{target,recordId});
 const identity=operation==='identity_generate';
 const attributed=identity&&Object.hasOwn(reply??{},'provenance');
 if (!reply || typeof reply !== 'object' || Array.isArray(reply) || Object.keys(reply).length !== (attributed?3:2)
  || reply.schema !== schema || !['match','different','absent','unsupported'].includes(reply.status)) {
  throw Error(`The native bridge returned unsupported ${label} receipt evidence.`);
 }
 if(identity) {
  const pending=['match','different'].includes(reply.status);
  const provenance=attributed?reply.provenance:pending?'genesis_input':'none';
  if(!(pending?['identity_request','genesis_input']:['none']).includes(provenance)) {
   throw Error('The native bridge returned unsupported identity preparation receipt evidence.');
  }
  return {status:reply.status,provenance};
 }
 return reply.status;
}
export async function nodeNetworkReviewSoftwareReceipt(target,recordId,operation,selection) {
 if (!['install','upgrade'].includes(operation)) throw Error('Select a supported installation receipt review.');
 if (!isTauri()) throw Error(`The ${operation} receipt review requires the native Portal app.`);
 const {release_id:releaseId,manifest_sha256:manifestSha256}=selection;
 const args=operation==='install'?{
  target,recordId,selection:{releaseId,manifestSha256,networkId:selection.network_id,chainId:selection.chain_id,nodeName:selection.node_name},
 }:{target,recordId,releaseId,manifestSha256};
 const reply=await invoke(`portal_nodenetwork_review_${operation}_receipt`,args);
 if (!reply || typeof reply!=='object' || Array.isArray(reply) || Object.keys(reply).length!==2
  || reply.schema!==`nodenetwork-${operation}-receipt-review-v1` || !['match','different','unavailable'].includes(reply.status)) {
  throw Error(`The native bridge returned unsupported ${operation} receipt evidence.`);
 }
 return reply.status;
}
export async function nodeNetworkReconcileContinuation(target){
 if(!isTauri())throw Error('Pending continuation reconciliation requires native Portal.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_reconcile_continuation',{target}));
 if(reply===null)return null;
 const fields=['schema','challenge','pending_sha256','request_sha256','parent_sha256','not_applied','mutation_performed'];
 if(!reply||typeof reply!=='object'||Array.isArray(reply)||Object.keys(reply).length!==fields.length||!fields.every(k=>Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-continuation-not-applied-v1'||reply.not_applied!==true||reply.mutation_performed!==false||!['challenge','pending_sha256','request_sha256','parent_sha256'].every(k=>typeof reply[k]==='string'&&/^[a-f0-9]{64}$/.test(reply[k])))throw Error('Unsupported pending continuation nonapplication proof.');
 return {...reply};
}
export async function nodeNetworkUpgradeNotApplied(target,recordId,selection) {
 if(!isTauri())throw Error('Upgrade reconciliation requires native Portal.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_upgrade_not_applied',{target,recordId,releaseId:selection.release_id,manifestSha256:selection.manifest_sha256}));
 if(reply===null)return null;
 const fields=['schema','challenge','request_sha256','old_manifest_sha256','candidate_manifest_sha256','not_applied','mutation_performed'];
 if(!reply||typeof reply!=='object'||Object.keys(reply).length!==fields.length||!fields.every(k=>Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-upgrade-not-applied-v1'||reply.not_applied!==true||reply.mutation_performed!==false||!['challenge','request_sha256','old_manifest_sha256','candidate_manifest_sha256'].every(k=>typeof reply[k]==='string'&&/^[a-f0-9]{64}$/.test(reply[k]))||reply.candidate_manifest_sha256!==selection.manifest_sha256)throw Error('Unsupported unchanged upgrade proof.');
 return reply;
}
// First-party native extension only; remote community HTML has no Tauri bridge.
export async function nodeNetworkHostStatus(){if(!isTauri())throw new Error('Open the native Portal app to inspect this machine.');return invoke('portal_nodenetwork_status');}
export async function nodeNetworkReviewMaster(){if(!isTauri())throw new Error('Open the native Portal app to inspect the node master.');return invoke('portal_nodenetwork_review_master');}
export async function nodeNetworkReviewOperatorKey(target=null){
 if(!isTauri())throw Error('Open the native Portal app to inspect an operator public key.');
 let reply;
 try{reply=await (target?withNodeChange(()=>invoke('portal_nodenetwork_review_operator_key',{target})):invoke('portal_nodenetwork_review_operator_key'));}
 catch{throw Error('The public key could not be reviewed. Select one OpenSSH Ed25519 .pub file.');}
 if(reply===null)return null;
 if(!reply || Object.keys(reply).length!==3 || reply.schema!=='nodenetwork-operator-public-key-v1'
  || reply.algorithm!=='ssh-ed25519' || typeof reply.canonicalSha256!=='string'
  || reply.canonicalSha256.length!==64 || /[^0-9a-f]/.test(reply.canonicalSha256)) throw Error('The native public key inspection returned an unsupported result.');
 return reply.canonicalSha256;
}
export async function nodeNetworkBootstrap(target,operator,parameters){if(!isTauri())throw new Error('Target bootstrap requires the native Portal app.');const reply=await withNodeChange(()=>invoke('portal_nodenetwork_bootstrap',{target,operator,parameters}));if(reply===null)return null;if(reply?.version!==1||typeof reply.ok!=='boolean')throw new Error('Invalid bootstrap response.');if(!reply.ok)throw new Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Bootstrap refused the operation.'}`);return reply.result;}
export async function nodeNetworkController(target,operation,parameters={}){
 if(!isTauri())throw new Error('Node management requires the native Portal app.');
 const args={target,request:{version:1,operation,parameters}};
 const call=()=>invoke('portal_nodenetwork_controller',args);
 const reply=await (readOperations.has(operation)?call():withNodeChange(call));
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw new Error('Invalid controller response.');
 if(!reply.ok)throw new Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Controller refused the operation.'}`);
 if(operation==='identity_generate'||operation==='identity_status'&&reply.result?.pending===true) {
  await verifyIdentityRequest(reply.result,operation==='identity_generate'?'generation':'status');
 }
 return reply.result;
}

export async function nodeNetworkReviewGenesisStageInputs(){
 if(!isTauri())throw Error('Open native Portal to review public Genesis files.');
 const reply=await invoke('portal_nodenetwork_review_genesis_stage_inputs');
 return reply===null?null:genesisStageLocalReview(reply);
}

export async function nodeNetworkStageGenesis(target,review){
 if(!isTauri())throw Error('Genesis staging requires native Portal.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_stage_genesis',{target,review}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid Genesis staging response.');
 if(!reply.ok)throw Error(reply.error?.message||'The controller refused Genesis staging.');
 return reply.result;
}

export async function exportNodeNetworkPublicArtifact(target,kind,expectedAddress,expectedScopeSha256){
 if(!isTauri())throw Error('Saving a verified public artifact requires the native Portal app.');
 const command=kind==='formation'?'portal_nodenetwork_export_registration':kind==='bound'?'portal_nodenetwork_export_bound_enrollment':null;
 if(!command)throw Error('Unsupported public artifact.');
 return invoke(command,{target,expectedAddress,expectedScopeSha256});
}

// Survives controller component remounts; does not replace native grants or locks.
let changePending=false;
async function withNodeChange(task){if(changePending)throw Error('A NodeNetwork change is still pending. Wait for its result and inspect the target before repeating an uncertain operation.');changePending=true;try{return await task();}finally{changePending=false;}}
const readOperations=new Set(['network_formation_status','authorization_status','target','inventory','health','install_preflight','identity_preflight','identity_status','formation_preflight','formation_status','formation_export','genesis_binding_preflight','upgrade_preflight','recovery_preflight','uninstall_preflight','vpn_status','vpn_stop_status','vpn_resume_status','boot_policy_status','vpn_diagnostics','diagnostics','genesis_stage_preflight']);


export async function stageNodeNetworkSignedGenesis(target,expectedAddress){
 if(!isTauri())throw Error('Signed Genesis staging requires the native Portal app.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_stage_signed_genesis',{target,expectedAddress}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid signed Genesis staging response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Target refused signed Genesis staging.'}`);
 return reply.result;
}

export async function stageNodeNetworkAuthorization(target,operator){
 if(!isTauri())throw Error('Engineering authorization requires the native Portal app.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_stage_authorization',{target,operator}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid authorization response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Target refused authorization staging.'}`);
 return reply.result;
}

export async function prepareNodeNetworkGenesis(target,formationSha256){
 if(!isTauri())throw Error('Fresh Genesis preparation requires the native Portal app.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_prepare_network_genesis',{target,formationSha256}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid Genesis preparation response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Preparation refused.'}`);
 return reply.result;
}
export async function exportNodeNetworkGenesis(target,reviewSha256){
 if(!isTauri())throw Error('Signed Genesis export requires the native Portal app.');
 return invoke('portal_nodenetwork_export_network_genesis',{target,reviewSha256});
}

export async function stageNodeNetworkUpdate(target){
 if(!isTauri())throw Error('Authenticated update staging requires native Portal.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_stage_update',{target}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid update staging response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Update staging refused.'}`);
 return reply.result;
}

export async function nodeNetworkVpn(target,operation){
 if(!isTauri())throw Error('VPN provider authorization requires the native Portal app.');
 if(!['enroll','reconcile','revoke','retire','cancel_unused'].includes(operation))throw Error('Unsupported VPN action.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_vpn',{target,operation}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid native VPN response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Native VPN operation refused.'}`);
 return reply.result;
}

export async function nodeNetworkTransport(target,operation,reviewSha256=null){
 if(!isTauri())throw Error('Transport registry formation requires native Portal.');
 if(!['status','prepare','sign','export','stage','reconcile_stage'].includes(operation))throw Error('Unsupported transport operation.');
 const call=()=>invoke('portal_nodenetwork_transport',{target,operation,reviewSha256});
 const reply=await(operation==='status'?call():withNodeChange(call));
 if(reply===null)return null;
 // This dedicated native command returns Option<validated public DTO>, not a controller envelope.
 if(!reply||typeof reply!=='object'||Array.isArray(reply)||Object.hasOwn(reply,'version')||Object.hasOwn(reply,'ok'))throw Error('Invalid transport response.');
 if(operation==='reconcile_stage'){
  const keys=['schema','not_applied','staged','dispatch_sha256','authorization_sha256','automatic_retry'];
  if(Object.keys(reply).length!==keys.length||!keys.every(k=>Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-native-transport-not-applied-v1'||reply.not_applied!==true||reply.staged!==false||reply.automatic_retry!==false||!['dispatch_sha256','authorization_sha256'].every(k=>typeof reply[k]==='string'&&/^[a-f0-9]{64}$/.test(reply[k])))throw Error('Invalid transport nonapplication proof response.');
 }else if(operation==='export'){
  const keys=['review_sha256','registry_sha256','issuer_root_sha256','node_count','fleet_readiness_verified','runtime_admission','exported_directory'];
  if(Object.keys(reply).length!==keys.length||!keys.every(k=>Object.hasOwn(reply,k))||!['review_sha256','registry_sha256','issuer_root_sha256'].every(k=>typeof reply[k]==='string'&&/^[a-f0-9]{64}$/.test(reply[k]))||reply.node_count!==5||reply.fleet_readiness_verified!==false||reply.runtime_admission!==false||typeof reply.exported_directory!=='string'||!reply.exported_directory)throw Error('Invalid public transport export.');
 }else if(operation==='stage'){
  if(reply.schema!=='nodenetwork-native-transport-staged-v1'||reply.staged!==true||reply.fleet_readiness_verified!==false||reply.runtime_admission!==false||reply.commissioned!==false)throw Error('Invalid transport staging response.');
 }else{
  const keys=['schema','pending','signed','formation_sha256','genesis_review_sha256','target_provider_report_sha256','network_id','chain_id','request_sha256','review_sha256','genesis_sha256','authority_sha256','issuer_root_sha256','valid_from_unix','expires_at_unix','validator_addresses','runtime_admission','fleet_readiness_verified','registry_sha256','sign_request_sha256'];
  if(Object.keys(reply).some(k=>!keys.includes(k))||reply.schema!=='nodenetwork-network-transport-v1'||typeof reply.pending!=='boolean'||(reply.pending&&(typeof reply.signed!=='boolean'||reply.runtime_admission!==false||reply.fleet_readiness_verified!==false)))throw Error('Invalid transport review.');
 }
 return reply;
}

export async function nodeNetworkGuest(target,operation,guestId){
 if(!isTauri())throw Error('Managed guests require the native Portal app.');
 if(!['status','preflight','connection','boot_diagnostics','create','stop','resume','remove'].includes(operation)||typeof guestId!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(guestId))throw Error('Unsupported guest operation or ID.');
 const call=()=>invoke('portal_nodenetwork_guest',{target,operation,guestId});
 const reply=await(['status','preflight','connection','boot_diagnostics'].includes(operation)?call():withNodeChange(call));
 if(reply===null)return null;
 if(operation==='connection'){
  const codes=['physical_controller_unavailable','physical_mux_unavailable','guest_inactive','guest_ssh_unavailable','guest_sudo_unavailable','ready'];
  const fields=['schema','guest_id','request_sha256','ssh_host_fingerprint','ready','code','mutation_performed'];
  if(!reply||Object.keys(reply).length!==fields.length||fields.some(k=>!Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-guest-connection-v1'||reply.guest_id!==guestId||!codes.includes(reply.code)||reply.ready!==(reply.code==='ready')||reply.mutation_performed!==false||!(reply.request_sha256===null||typeof reply.request_sha256==='string'&&/^[a-f0-9]{64}$/.test(reply.request_sha256))||!(reply.ssh_host_fingerprint===null||typeof reply.ssh_host_fingerprint==='string'&&/^SHA256:[A-Za-z0-9+/]{43}$/.test(reply.ssh_host_fingerprint))||reply.ready&&(reply.request_sha256===null||reply.ssh_host_fingerprint===null))throw Error('Invalid native guest connection observation.');
  return reply;
 }
 if(operation==='boot_diagnostics'){
  const fields=['schema','guest_id','request_sha256','runtime_version','sampled_bytes','log_size_bytes','categories','mutation_performed'];
  const categories=['firmware_started','boot_device_attempted','boot_device_failed','firmware_asset_missing','kernel_started','cloud_init_observed','ssh_started','ssh_failed','kernel_panic','login_prompt'];
  if(!reply||Object.keys(reply).length!==fields.length||fields.some(k=>!Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-guest-boot-diagnostics-v1'||reply.guest_id!==guestId||!/^[a-f0-9]{64}$/.test(reply.request_sha256)||![1,2].includes(reply.runtime_version)||!Number.isSafeInteger(reply.sampled_bytes)||reply.sampled_bytes<0||reply.sampled_bytes>65536||!Number.isSafeInteger(reply.log_size_bytes)||reply.log_size_bytes<reply.sampled_bytes||reply.mutation_performed!==false||!reply.categories||Object.keys(reply.categories).length!==categories.length||categories.some(k=>typeof reply.categories[k]!=='boolean'))throw Error('Invalid native guest boot diagnostic.');
  return reply;
 }
 const preflight=operation==='preflight';
 if(reply?.schema!==(preflight?'nodenetwork-guest-preflight-v1':'nodenetwork-guest-status-v1')||(preflight?reply.selection?.guest_id:reply.guest_id)!==guestId)throw Error('Invalid native guest response for the selected guest.');
 return reply;
}

export async function rollbackBareNodeBootstrap(target,operator,releaseId){
 if(!isTauri())throw Error('Bare bootstrap cleanup requires native Portal.');
 return withNodeChange(()=>invoke('portal_nodenetwork_bare_rollback',{target,operator,releaseId}));
}

export async function nodeNetworkSelectGuest(target,guestId){
 if(!isTauri())throw Error('Managed guest selection requires native Portal.');
 if(target?.guest||!/^[a-z][a-z0-9-]{0,31}$/.test(guestId))throw Error('Select a physical host and a valid guest.');
 return withNodeChange(()=>invoke('portal_nodenetwork_select_guest',{target,guestId}));
}

export async function nodeNetworkConfigureGuest(target){
 if(!isTauri())throw Error('Guest policy approval requires native Portal.');
 if(target?.guest)throw Error('Select the physical hosting machine.');
 const result=await withNodeChange(()=>invoke('portal_nodenetwork_configure_guest',{target}));
 if(result===null)return null;
 if(result?.schema!=='nodenetwork-guest-configuration-v1'||result.configured!==true||result.guest_created!==false||!/^[a-z][a-z0-9-]{0,31}$/.test(result.guest_id))throw Error('Invalid native guest configuration receipt.');
 return result;
}

export async function nodeNetworkFleetReadiness(target,operation,targets=null,reviewSha256=null){
 if(!isTauri())throw Error('Fleet readiness requires native Portal and authenticated controllers.');
 if(!['collect','stage','reconcile','verify_not_applied','verify_commission_not_applied'].includes(operation)||(operation==='collect'?(!Array.isArray(targets)||(targets.length<4||targets.length>5)||reviewSha256!==null):(targets!==null||(operation==='stage'?!/^[a-f0-9]{64}$/.test(reviewSha256):reviewSha256!==null))))throw Error('Unsupported bounded fleet readiness request.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_fleet_readiness',{target,operation,targets,reviewSha256}));if(reply===null)return null;
 if(operation==='verify_commission_not_applied'){
  const fields=['schema','not_applied','commissioned','record_id','request_sha256','readiness_sha256','automatic_retry'];
  if(!reply||Object.keys(reply).length!==fields.length||!fields.every(k=>Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-native-commission-not-applied-v1'||reply.not_applied!==true||reply.commissioned!==false||reply.automatic_retry!==false||!['record_id','request_sha256','readiness_sha256'].every(k=>typeof reply[k]==='string'&&/^[a-f0-9]{64}$/.test(reply[k])))throw Error('Unsupported commission nonapplication response; original request remains fenced.');return reply;
 }
 if(operation==='verify_not_applied'){
  const fields=['schema','not_applied','readiness_staged','dispatch_sha256','authorization_sha256','automatic_retry'];
  if(!reply||Object.keys(reply).length!==fields.length||!fields.every(k=>Object.hasOwn(reply,k))||reply.schema!=='nodenetwork-native-readiness-not-applied-v1'||reply.not_applied!==true||reply.readiness_staged!==false||reply.automatic_retry!==false||!['dispatch_sha256','authorization_sha256'].every(k=>typeof reply[k]==='string'&&/^[a-f0-9]{64}$/.test(reply[k])))throw Error('Unsupported readiness nonapplication response; original intent remains fenced.');
  return reply;
 }
 const schema=operation==='collect'?'nodenetwork-native-fleet-readiness-v2':operation==='stage'?'nodenetwork-native-fleet-readiness-staged-v1':'nodenetwork-native-fleet-readiness-reconciled-v1';
 if(operation==='collect'){
  const fields=['schema','review_sha256','observations','online_addresses','excluded_addresses','scope','runtime_participation_verified','finality_verified'];
  const strings=v=>Array.isArray(v)&&v.every(s=>typeof s==='string'&&s.length>0&&s.length<=256&&!/[\u0000-\u001f\u007f]/.test(s))&&v.every((s,i)=>i===0||v[i-1]<s);
  if(!reply||Object.keys(reply).length!==fields.length||!fields.every(k=>Object.hasOwn(reply,k))||!strings(reply.online_addresses)||!strings(reply.excluded_addresses)||reply.online_addresses.length!==targets.length||reply.online_addresses.length+reply.excluded_addresses.length!==5||reply.excluded_addresses.some(a=>reply.online_addresses.includes(a))||!Array.isArray(reply.observations)||reply.observations.length!==targets.length||reply.observations.some((v,i)=>v?.address!==reply.online_addresses[i]||v?.observation_kind!=='prestart_vpn'||JSON.stringify(v.online_addresses)!==JSON.stringify(reply.online_addresses))||reply.scope!=='commissioning_and_prestart_vpn_only')throw Error('Unsupported native selected-roster readiness response.');
 }
 if(reply?.schema!==schema||(operation==='reconcile'&&(reply.pending!==false||typeof reply.original_stage_verified!=='boolean'||reply.freshness_verified!==false||reply.commissioned!==false||(reply.review_sha256!==null&&!/^[a-f0-9]{64}$/.test(reply.review_sha256))))||(operation!=='reconcile'&&(!/^[a-f0-9]{64}$/.test(reply.review_sha256)||reply.finality_verified!==false||reply.runtime_participation_verified!==false)))throw Error('Unsupported native commissioning readiness response.');return reply;
}

export async function nodeNetworkTreasury(target,operation){
 if(!isTauri())throw Error('Ordinary treasury custody requires the native Portal app.');
 if(!['status','prepare','export'].includes(operation))throw Error('Unsupported ordinary treasury operation.');
 const call=()=>invoke('portal_nodenetwork_treasury',{target,operation});
 const reply=await(operation==='status'?call():withNodeChange(call));
 if(reply===null)return null;
 const exported=operation==='export';
 if(reply?.pending===false&&operation!=='export'&&Object.keys(reply).length===1)return reply;
 if(reply?.schema!==(exported?'nodenetwork-formation-treasury-export-v1':'nodenetwork-formation-treasury-v1')||reply.pending!==true||reply.possession_verified!==true||reply.allocation_nwei!=='5000000000000000'||typeof reply.address!=='string'||!reply.address.startsWith('syna1')||(exported&&reply.canary_testing_treasury?.address!==reply.address))throw Error('Unsupported ordinary treasury result; no custody or allocation is inferred.');
 return reply;
}

export async function nodeNetworkRequestScope(target){
 if(!isTauri())throw Error('Target request scope requires the native Portal app.');
 const value=await invoke('portal_nodenetwork_request_scope',{target});
 if(!value||Object.keys(value).length!==1||typeof value.targetDigest!=='string'||!/^[0-9a-f]{64}$/.test(value.targetDigest))throw Error('Native target request scope is unavailable.');
 return value;
}

export async function nodeNetworkTreasurySend(target,operation,parameters){
 if(!isTauri())throw Error('Ordinary test treasury sending requires the native Portal app.');
 if(!['quote','prepare','submit','status','phase','verify_not_applied'].includes(operation))throw Error('Unsupported treasury send operation.');
 return withNodeChange(()=>invoke('portal_nodenetwork_treasury_send',{target,operation,parameters}));
}

export async function nodeNetworkConsensus(target,operation,value=null){
 if(!isTauri())throw Error('Current-network consensus observations require native Portal.');
 if(operation==='transaction')consensusTransactionSelector(value);else if(!['telemetry','finality','epoch'].includes(operation)||(operation==='telemetry'?value!==null:!Number.isSafeInteger(value)||value<=0))throw Error('Unsupported consensus observation.');
 const view=consensusObservation(await invoke('portal_nodenetwork_consensus',{target,operation,value}));
 if(operation==='transaction'&&(view.evidence?.kind!=='transaction'||['transaction_id','sender','receiver','height'].some(k=>view.evidence.selector[k]!==value[k])))throw Error('Transaction observation differs from the exact requested selector.');return view;
}
