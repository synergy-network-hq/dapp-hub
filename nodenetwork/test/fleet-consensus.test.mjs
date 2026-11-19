import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFleetConsensus,savedConsensusTargets,FLEET_SELECTION_KEY} from '../src/fleet-consensus.js';

const pin='a'.repeat(64),other='b'.repeat(64);
const targets=[2,3,4,6].map(n=>({kind:'remote',host:`validator-${n}.example`,root:'/opt/synergy'}));
function view(index,operation,height){
 const tip=100+index;
 return {schema:'nodenetwork-consensus-view-v1',scope:{network_id:'fresh',chain_id:'99999',genesis_hash:pin,formation_sha256:pin,manifest_sha256:pin},
  process_id:1000+index,observed_at_unix_ms:1795000000000+(operation==='finality'?100:0),epoch:1,epoch_context_root:pin,finalized_height:tip,
  commitment:{height:operation==='finality'?height:tip,block_id:pin,state_root:pin,finality_certificate_id:pin,protected_execution_root:pin},
  transport:{authenticated_peer_count:0,apqe_session_count:0,production_qualified:false,peers:[]},
  evidence:operation==='finality'?{kind:'finality',selector:height,sha256:pin,bytes:120,complete:true,certificate_verified:true}:null};
}
function reader(transform=()=>{}){
 const calls=[];
 return {calls,read:async(target,operation,height)=>{
  const index=targets.findIndex(t=>t.host===target.host);calls.push({target,operation,height});
  const v=view(index,operation,height);return transform(v,index,operation,height)??v;
 }};
}
test('advancing tips compare only one common height through fixed native reads',async()=>{
 const r=reader(),progress=[];
 const value=await collectFleetConsensus(targets,r.read,{onProgress:p=>progress.push(p)});
 assert.equal(value.status,'commitments_match');assert.equal(value.common_height,100);
 assert.equal(value.commitment.height,100);assert.equal(value.observations.length,4);
 assert.deepEqual(value.evidence_documents,{same_digest:true,all_complete:true,all_certificate_verified:true});
 assert.deepEqual(r.calls.map(c=>[c.operation,c.height]),[...targets.map(()=>['telemetry',null]),...targets.map(()=>['finality',100])]);
 assert.deepEqual(progress.filter(p=>p.completed===4).map(p=>p.operation),['telemetry','finality']);
 assert.equal(Object.hasOwn(value,'quorum'),false);assert.equal(Object.hasOwn(value,'proof_verified'),false);
});
test('foreign network, Genesis, formation or software prevents any cross-scope second wave',async()=>{
 for(const key of ['network_id','chain_id','genesis_hash','formation_sha256','manifest_sha256']){
  const r=reader((v,i)=>{if(i===2)v.scope[key]=key==='network_id'?'different':key==='chain_id'?'1266':other;});
  const value=await collectFleetConsensus(targets,r.read);assert.equal(value.status,'scope_mismatch',key);
  assert.equal(value.commitment,null);assert.equal(r.calls.length,4);
 }
});
test('one unavailable target drains issued reads, preserves observations, and never retries',async()=>{
 let finished=0;
 const r=reader(async(v,i)=>{try{if(i===1)throw Error('Controller unavailable');await new Promise(resolve=>setTimeout(resolve,5));return v;}finally{finished++;}});
 const value=await collectFleetConsensus(targets,r.read);
 assert.equal(value.status,'unavailable');assert.equal(finished,4);assert.equal(r.calls.length,4);
 assert.equal(value.observations[1].error,'Controller unavailable');assert.equal(value.observations[0].telemetry.process_id,1000);
});
test('exact-height absence, tip substitution, process change, or rollback cannot become agreement',async()=>{
 for(const transform of [
  v=>v.commitment=null,v=>v.commitment.height++,v=>v.evidence=null,v=>v.evidence.selector++,
  v=>v.process_id++,v=>v.finalized_height=100,v=>v.observed_at_unix_ms=1,
  v=>v.scope.manifest_sha256=other,
 ]){
  const r=reader((v,i,op)=>{if(i===3&&op==='finality')transform(v);});
  const value=await collectFleetConsensus(targets,r.read);assert.equal(value.status,'unavailable');
  assert.equal(value.commitment,null);assert.ok(value.observations[3].error);assert.equal(r.calls.length,8);
 }
});
test('each exact commitment component is compared; a matching state root alone is insufficient',async()=>{
 for(const key of ['block_id','state_root','finality_certificate_id','protected_execution_root']){
  const r=reader((v,i,op)=>{if(i===2&&op==='finality')v.commitment[key]=other;});
  const value=await collectFleetConsensus(targets,r.read);assert.equal(value.status,'commitments_differ',key);assert.equal(value.commitment,null);
 }
});
test('live epoch differences and bounded document metadata do not masquerade as commitment conflicts',async()=>{
 const r=reader((v,i,op)=>{v.epoch=i%2+1;v.epoch_context_root=i%2?other:pin;if(op==='finality'&&i===2){v.evidence.sha256=other;v.evidence.complete=false;v.evidence.certificate_verified=false;}});
 const value=await collectFleetConsensus(targets,r.read);assert.equal(value.status,'commitments_match');
 assert.deepEqual(value.evidence_documents,{same_digest:false,all_complete:false,all_certificate_verified:false});
});
test('selection or permission changes prevent the next wave, after current reads settle',async()=>{
 let current=true,finished=0;
 const r=reader(async(v,i)=>{await new Promise(resolve=>setTimeout(resolve,i));finished++;current=false;return v;});
 await assert.rejects(collectFleetConsensus(targets,r.read,{isCurrent:()=>current}),/changed/);
 assert.equal(finished,4);assert.equal(r.calls.length,4);
 const unused=reader();await assert.rejects(collectFleetConsensus(targets,unused.read,{isCurrent:()=>false}),/changed/);assert.equal(unused.calls.length,0);
});
test('a second-wave failure does not abandon queued native reads or produce a partial success',async()=>{
 let finalityFinished=0;
 const r=reader(async(v,i,op)=>{if(op==='finality'){try{if(i===0)throw Error('Proof was pruned');await new Promise(resolve=>setTimeout(resolve,5));}finally{finalityFinished++;}}return v;});
 const value=await collectFleetConsensus(targets,r.read);assert.equal(value.status,'unavailable');assert.equal(value.common_height,100);
 assert.equal(finalityFinished,4);assert.equal(r.calls.length,8);assert.equal(value.observations[0].error,'Proof was pruned');
});
test('zero finalized tip, malformed views and injected transport claims remain unavailable',async()=>{
 for(const transform of [v=>{v.finalized_height=0;v.commitment=null;},v=>v.transport.production_qualified=true,v=>v.proof_verified=true]){
  const r=reader((v,i)=>{if(i===1)transform(v);});const value=await collectFleetConsensus(targets,r.read);
  assert.equal(value.status,'unavailable');assert.equal(r.calls.length,4);assert.equal(value.commitment,null);
 }
});
test('public selection is bounded, normalized, duplicate-free and grants no native authority',async()=>{
 let used='';const storage={getItem:key=>{used=key;return JSON.stringify(targets);}};
 assert.deepEqual(savedConsensusTargets(storage),targets);assert.equal(used,FLEET_SELECTION_KEY);
 for(const raw of ['{',JSON.stringify({targets}),JSON.stringify([...targets,targets[0]]),' '.repeat(32769)])assert.throws(()=>savedConsensusTargets({getItem:()=>raw}));
 const r=reader();for(const selection of [[],targets.slice(0,1),[...targets,{...targets[0],host:'VALIDATOR-2.EXAMPLE'}],Array.from({length:6},(_,i)=>({...targets[0],host:`extra-${i}.example`}))])await assert.rejects(collectFleetConsensus(selection,r.read));
 assert.equal(r.calls.length,0);
});
