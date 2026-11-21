import {consensusObservation} from './consensus-observation.js';
import {fleetTargets} from './fleet-readiness.js';

export const FLEET_SELECTION_KEY='portal-native-v1:nodeNetworkFleetTargets';
const scopeFields=['network_id','chain_id','genesis_hash','formation_sha256','manifest_sha256'];
const commitmentFields=['height','block_id','state_root','finality_certificate_id','protected_execution_root'];
const equalFields=(a,b,fields)=>fields.every(key=>a[key]===b[key]);

export function savedConsensusTargets(storage){
 const raw=storage.getItem(FLEET_SELECTION_KEY);
 if(raw&&raw.length>32768)throw Error('Saved controller selection exceeds its bound.');
 try{return fleetTargets(raw?JSON.parse(raw):[]);}
 catch{throw Error('Saved controller selection is unreadable. Review the public fleet selection before collecting observations.');}
}

export function consensusFailureMessage(error){
 const message=typeof error==='string'?error:error instanceof Error?error.message:'';
 return message&&message.length<=512&&!/[\u0000-\u001f\u007f]/.test(message)?message:'This controller observation is unavailable.';
}

// A bounded, read-only batch, not a network-size or quorum limit. The native
// controller serializes its authenticated exchanges. All issued reads settle
// before another wave starts; there are no retries or renderer-only timeouts.
export async function collectFleetConsensus(selection,read,{isCurrent=()=>true,onProgress=()=>{}}={}){
 const targets=fleetTargets(selection);
 if(targets.length<2)throw Error('Save at least two controllers for a same-height comparison.');
 if(!isCurrent())throw Error('Controller selection or native permission changed. Start a fresh observation.');
 const rows=targets.map(target=>({target,telemetry:null,finality:null,error:null}));
 const result=status=>({schema:'nodenetwork-fleet-consensus-v1',status,common_height:null,scope:null,
  commitment:null,evidence_documents:null,observations:rows,completed_at_unix_ms:Date.now()});
 async function wave(operation,height){
  let completed=0;onProgress({operation,completed,total:targets.length});
  const values=await Promise.allSettled(targets.map(async(target,index)=>{
   try{const view=consensusObservation(await read(target,operation,height));
    if(operation==='telemetry'&&view.evidence!==null)throw Error('Unexpected evidence in the current-tip observation.');
    return view;}
   finally{onProgress({operation,completed:++completed,total:targets.length,index});}
  }));
  return values;
 }
 const telemetry=await wave('telemetry',null);
 telemetry.forEach((value,index)=>{
  if(value.status==='fulfilled')rows[index].telemetry=value.value;
  else rows[index].error=consensusFailureMessage(value.reason);
 });
 if(!isCurrent())throw Error('Controller selection or native permission changed. Start a fresh observation.');
 if(rows.some(row=>row.error))return result('unavailable');
 const scope=rows[0].telemetry.scope;
 if(rows.some(row=>!equalFields(scope,row.telemetry.scope,scopeFields)))return result('scope_mismatch');
 const height=Math.min(...rows.map(row=>row.telemetry.finalized_height));
 if(height===0)return result('unavailable');
 const finality=await wave('finality',height);
 finality.forEach((value,index)=>{
  const row=rows[index];
  if(value.status==='rejected'){row.error=consensusFailureMessage(value.reason);return;}
  const view=value.value;
  if(!equalFields(scope,view.scope,scopeFields)||view.process_id!==row.telemetry.process_id
    ||view.finalized_height<row.telemetry.finalized_height||view.observed_at_unix_ms<row.telemetry.observed_at_unix_ms){
   row.error='Controller scope, process or finalized observation changed during collection. Read again; no agreement is inferred.';return;
  }
  if(!view.commitment||view.commitment.height!==height||view.evidence?.kind!=='finality'||view.evidence.selector!==height){
   row.error='Exact selected-height commitment and finality document were not observed. Historical data may be unavailable.';return;
  }
  row.finality=view;
 });
 if(!isCurrent())throw Error('Controller selection or native permission changed. Start a fresh observation.');
 const output={...result('unavailable'),common_height:height,scope};
 if(rows.some(row=>row.error))return output;
 const commitment=rows[0].finality.commitment;
 const match=rows.every(row=>equalFields(commitment,row.finality.commitment,commitmentFields));
 return {...output,status:match?'commitments_match':'commitments_differ',commitment:match?commitment:null,
  evidence_documents:{same_digest:rows.every(row=>row.finality.evidence.sha256===rows[0].finality.evidence.sha256),
   all_complete:rows.every(row=>row.finality.evidence.complete),
   all_certificate_verified:rows.every(row=>row.finality.evidence.certificate_verified)}};
}
