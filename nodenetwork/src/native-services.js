import {isTauri,invoke} from "@tauri-apps/api/core";
import {parseRequestHistory} from './request-history.js';
import {genesisStageLocalReview} from './genesis-stage-files.js';
export async function nodeNetworkRequests(){
 if(!isTauri())throw Error('Local request history requires the native Portal app. No native history has been read.');
 return parseRequestHistory(await invoke('portal_nodenetwork_requests'));
}
const genesisReceiptPorts = {
 genesis_stage:{command:'portal_nodenetwork_review_genesis_stage_receipt',schema:'nodenetwork-genesis-stage-receipt-review-v1',label:'staging'},
 genesis_bind:{command:'portal_nodenetwork_review_genesis_binding_receipt',schema:'nodenetwork-genesis-binding-receipt-review-v1',label:'binding'},
};
export async function nodeNetworkReviewGenesisReceipt(target, recordId, operation) {
 if (!Object.hasOwn(genesisReceiptPorts, operation)) throw Error('Select a supported Genesis receipt review.');
 const {command,schema,label}=genesisReceiptPorts[operation];
 if (!isTauri()) throw Error(`Genesis ${label} receipt review requires the native Portal app.`);
 const reply=await invoke(command,{target,recordId});
 if (!reply || typeof reply !== 'object' || Array.isArray(reply) || Object.keys(reply).length !== 2
  || reply.schema !== schema || !['match','different','absent','unsupported'].includes(reply.status)) {
  throw Error(`The native bridge returned unsupported Genesis ${label} receipt evidence.`);
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
export async function nodeNetworkController(target,operation,parameters={},bindingReview,preparationReview){
 if(!isTauri())throw new Error('Node management requires the native Portal app.');
 const args={target,request:{version:1,operation,parameters}};
 if(bindingReview!==undefined)args.bindingReview=bindingReview;
 if(preparationReview!==undefined)args.preparationReview=preparationReview;
 const call=()=>invoke('portal_nodenetwork_controller',args);
 const reply=await (readOperations.has(operation)?call():withNodeChange(call));
 if(reply?.version!==1||typeof reply.ok!=='boolean')throw new Error('Invalid controller response.');
 if(!reply.ok)throw new Error(`${reply.error?.code||'operation_refused'}: ${reply.error?.message||'Controller refused the operation.'}`);
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

// Survives controller component remounts; does not replace native grants or locks.
let changePending=false;
async function withNodeChange(task){if(changePending)throw Error('A NodeNetwork change is still pending. Wait for its result and inspect the target before repeating an uncertain operation.');changePending=true;try{return await task();}finally{changePending=false;}}
const readOperations=new Set(['target','inventory','health','diagnostics','install_preflight','upgrade_preflight','recovery_preflight','uninstall_preflight','vpn_status','identity_status','formation_status','identity_preflight','formation_preflight','genesis_binding_preflight','genesis_stage_preflight']);
