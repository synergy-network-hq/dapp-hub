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
// First-party native extension only; remote community HTML has no Tauri bridge.
export async function nodeNetworkHostStatus(){if(!isTauri())throw new Error('Open the native Portal app to inspect this machine.');return invoke('portal_nodenetwork_status');}
export async function nodeNetworkReviewMaster(){if(!isTauri())throw new Error('Open the native Portal app to inspect the node master.');return invoke('portal_nodenetwork_review_master');}
export async function nodeNetworkReviewOperatorKey(){
 if(!isTauri())throw Error('Open the native Portal app to inspect an operator public key.');
 let reply;
 try{reply=await invoke('portal_nodenetwork_review_operator_key');}
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
const readOperations=new Set(['network_formation_status','authorization_status','target','inventory','health','install_preflight','identity_preflight','identity_status','formation_preflight','formation_status','formation_export','genesis_binding_preflight','upgrade_preflight','recovery_preflight','uninstall_preflight','vpn_status','vpn_diagnostics','diagnostics','genesis_stage_preflight']);


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
 if(!['enroll','reconcile','revoke','retire'].includes(operation))throw Error('Unsupported VPN action.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_vpn',{target,operation}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid native VPN response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Native VPN operation refused.'}`);
 return reply.result;
}

export async function nodeNetworkTransport(target,operation,reviewSha256=null){
 if(!isTauri())throw Error('Transport registry formation requires native Portal.');
 if(!['status','prepare','sign','export','stage'].includes(operation))throw Error('Unsupported transport operation.');
 const call=()=>invoke('portal_nodenetwork_transport',{target,operation,reviewSha256});
 const reply=await(operation==='status'?call():withNodeChange(call));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid transport response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Transport operation refused.'}`);
 return reply.result;
}

export async function nodeNetworkGuest(target,operation,guestId){
 if(!isTauri())throw Error('Managed guests require the native Portal app.');
 if(!['status','preflight','create','stop','remove'].includes(operation)||typeof guestId!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(guestId))throw Error('Unsupported guest operation or ID.');
 const call=()=>invoke('portal_nodenetwork_guest',{target,operation,guestId});
 const reply=await(['status','preflight'].includes(operation)?call():withNodeChange(call));
 if(reply===null)return null;
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
 if(!['collect','stage','reconcile'].includes(operation)||(operation==='collect'?(!Array.isArray(targets)||targets.length!==5||reviewSha256!==null):(targets!==null||(operation==='stage'?!/^[a-f0-9]{64}$/.test(reviewSha256):reviewSha256!==null))))throw Error('Unsupported bounded fleet readiness request.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_fleet_readiness',{target,operation,targets,reviewSha256}));if(reply===null)return null;
 const schema=operation==='collect'?'nodenetwork-native-fleet-readiness-v1':operation==='stage'?'nodenetwork-native-fleet-readiness-staged-v1':'nodenetwork-native-fleet-readiness-reconciled-v1';
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
