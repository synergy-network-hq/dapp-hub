import {isTauri,invoke} from "@tauri-apps/api/core";
export async function nodeNetworkRequests(){
 if(!isTauri())throw Error('Local request history requires the native Portal app. No native history has been read.');
 const value=await invoke('portal_nodenetwork_requests');
 const pin=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const states=new Set(['dispatch_intent','uncertain','response_received','verified_target_outcome']);
 const operations=new Set(['bootstrap','install','identity_generate','formation_prepare','genesis_stage','genesis_bind','commission','register','vpn_enroll','start','stop','restart','upgrade','uninstall']);
 const time=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
 if(value?.schema!=='nodenetwork-local-requests-v1'||value.limit!==256||value.remoteJobRecovery!==false||value.automaticReplay!==false||!Array.isArray(value.records)||value.records.length>256||value.records.some(r=>!r||r.version!==1||!pin(r.id)||!pin(r.target_digest)||!pin(r.request_digest)||!operations.has(r.operation)||!states.has(r.state)||!time(r.recorded_at_ms)||(r.state==='dispatch_intent'?(r.observed_at_ms!==null||r.response_ok!==null):(!time(r.observed_at_ms)||(r.state==='uncertain'?r.response_ok!==null:r.state==='verified_target_outcome'?(r.response_ok!==true||!['formation_prepare','genesis_stage','genesis_bind'].includes(r.operation)):typeof r.response_ok!=='boolean'))))||new Set(value.records.map(r=>r.id)).size!==value.records.length)throw Error('Local request history returned an unsupported record. History is unavailable; no empty or completed state is inferred.');
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
const readOperations=new Set(['target','inventory','health','install_preflight','identity_preflight','identity_status','formation_preflight','formation_status','formation_export','genesis_binding_preflight','upgrade_preflight','recovery_preflight','uninstall_preflight','vpn_status','diagnostics']);


export async function stageNodeNetworkSignedGenesis(target,expectedAddress){
 if(!isTauri())throw Error('Signed Genesis staging requires the native Portal app.');
 const reply=await withNodeChange(()=>invoke('portal_nodenetwork_stage_signed_genesis',{target,expectedAddress}));
 if(reply===null)return null;
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw Error('Invalid signed Genesis staging response.');
 if(!reply.ok)throw Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Target refused signed Genesis staging.'}`);
 return reply.result;
}
