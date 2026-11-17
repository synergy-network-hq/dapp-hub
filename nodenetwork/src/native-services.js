import {isTauri,invoke} from "@tauri-apps/api/core";
export async function nodeNetworkRequests(){
 if(!isTauri())throw Error('Local request history requires the native Portal app. No native history has been read.');
 const value=await invoke('portal_nodenetwork_requests');
 const pin=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const states=new Set(['dispatch_intent','uncertain','response_received','verified_target_outcome']);
 const operations=new Set(['authorization_stage','update_stage','bare_bootstrap_rollback','network_formation_prepare','network_formation_sign','network_transport_prepare','network_transport_sign','guest_create','guest_stop','guest_remove','bootstrap','install','identity_generate','formation_prepare','genesis_stage','genesis_bind','commission','register','vpn_enroll','start','stop','restart','upgrade','uninstall']);
 const time=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
 if(value?.schema!=='nodenetwork-local-requests-v1'||value.limit!==256||value.remoteJobRecovery!==false||value.automaticReplay!==false||!Array.isArray(value.records)||value.records.length>256||value.records.some(r=>!r||r.version!==1||!pin(r.id)||!pin(r.target_digest)||!pin(r.request_digest)||!operations.has(r.operation)||!states.has(r.state)||!time(r.recorded_at_ms)||(r.state==='dispatch_intent'?(r.observed_at_ms!==null||r.response_ok!==null):(!time(r.observed_at_ms)||(r.state==='uncertain'?r.response_ok!==null:r.state==='verified_target_outcome'?(r.response_ok!==true||!['authorization_stage','update_stage','network_formation_prepare','network_formation_sign','network_transport_prepare','network_transport_sign','guest_create','identity_generate','formation_prepare','genesis_stage','genesis_bind'].includes(r.operation)):typeof r.response_ok!=='boolean'))))||new Set(value.records.map(r=>r.id)).size!==value.records.length)throw Error('Local request history returned an unsupported record. History is unavailable; no empty or completed state is inferred.');
 return value;
}
// First-party native extension only; remote community HTML has no Tauri bridge.
export async function nodeNetworkHostStatus(){if(!isTauri())throw new Error('Open the native Portal app to inspect this machine.');return invoke('portal_nodenetwork_status');}
export async function nodeNetworkReviewMaster(){if(!isTauri())throw new Error('Open the native Portal app to inspect the node master.');return invoke('portal_nodenetwork_review_master');}
export async function nodeNetworkBootstrap(target,operator,parameters){if(!isTauri())throw new Error('Target bootstrap requires the native Portal app.');const reply=await withNodeChange(()=>invoke('portal_nodenetwork_bootstrap',{target,operator,parameters}));if(reply===null)return null;if(reply?.version!==1||typeof reply.ok!=='boolean')throw new Error('Invalid bootstrap response.');if(!reply.ok)throw new Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Bootstrap refused the operation.'}`);return reply.result;}
export async function nodeNetworkController(target,operation,parameters={}){if(!isTauri())throw new Error('Node management requires the native Portal app.');const call=()=>invoke('portal_nodenetwork_controller',{target,request:{version:1,operation,parameters}});const reply=await (readOperations.has(operation)?call():withNodeChange(call));if(reply?.version!==1||typeof reply.ok!=='boolean')throw new Error('Invalid controller response.');if(!reply.ok)throw new Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Controller refused the operation.'}`);return reply.result;}

export async function exportNodeNetworkPublicArtifact(target,kind,expectedAddress,expectedScopeSha256){
 if(!isTauri())throw Error('Saving a verified public artifact requires the native Portal app.');
 const command=kind==='formation'?'portal_nodenetwork_export_registration':kind==='bound'?'portal_nodenetwork_export_bound_enrollment':null;
 if(!command)throw Error('Unsupported public artifact.');
 return invoke(command,{target,expectedAddress,expectedScopeSha256});
}

// Survives controller component remounts; does not replace native grants or locks.
let changePending=false;
async function withNodeChange(task){if(changePending)throw Error('A NodeNetwork change is still pending. Wait for its result and inspect the target before repeating an uncertain operation.');changePending=true;try{return await task();}finally{changePending=false;}}
const readOperations=new Set(['network_formation_status','authorization_status','target','inventory','health','install_preflight','identity_preflight','identity_status','formation_preflight','formation_status','formation_export','genesis_binding_preflight','upgrade_preflight','recovery_preflight','uninstall_preflight','vpn_status','diagnostics']);


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
 if(!['status','prepare','sign','export'].includes(operation))throw Error('Unsupported transport operation.');
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
