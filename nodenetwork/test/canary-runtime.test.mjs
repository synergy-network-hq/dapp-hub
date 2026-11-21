import {test} from 'node:test';import assert from 'node:assert/strict';
import {canaryRuntimeObservation} from '../src/canary-runtime.js';
import {readNodeNetwork} from '../src/nodeNetwork.js';
const profile={id:'posy-canary-current',rpc:'https://current.example',chainId:99999,networkId:'synergy-posy-canary-20261117',genesisHash:'a'.repeat(64)};
const telemetry=()=>({schema_version:1,chain_id:99999,network_identity:profile.networkId,genesis_hash:profile.genesisHash,process_id:123,observed_at_unix_ms:1795000000000,epoch:11,epoch_context_root:'b'.repeat(64),finalized_height:100,common_finalized_commitment:{height:100,block_id:'c'.repeat(64),state_root:'d'.repeat(64),finality_certificate_id:'e'.repeat(64),protected_execution_root:'f'.repeat(64)},raw_internal:{ignored:true}});
test('canonical runtime projection preserves actual commitments and excludes unneeded server fields',()=>{
 const view=canaryRuntimeObservation(telemetry(),profile,10);
 assert.equal(view.finalizedHeight,100);assert.equal(view.epoch,11);assert.equal(view.receivedAt,10);
 assert.equal(view.commitment.height,100);assert.equal('raw_internal' in view,false);assert.equal('ready' in view,false);
 const absent=canaryRuntimeObservation({...telemetry(),epoch:null,epoch_context_root:null,finalized_height:0,common_finalized_commitment:null},profile);
 assert.equal(absent.epoch,null);assert.equal(absent.commitment,null);assert.equal(absent.finalizedHeight,0);
});
test('foreign scope, unsafe or partial telemetry and malformed commitments fail closed',()=>{
 for(const change of [{chain_id:1266},{network_identity:'posy-apqe-canary-process-49028'},{genesis_hash:'0'.repeat(64)},{process_id:0},{epoch:0},{epoch_context_root:undefined},{finalized_height:Number.MAX_SAFE_INTEGER+1},{common_finalized_commitment:undefined},{common_finalized_commitment:{...telemetry().common_finalized_commitment,height:101}}])assert.throws(()=>canaryRuntimeObservation({...telemetry(),...change},profile));
});
test('current Overview uses only canonical methods and does not synthesize legacy readiness',async()=>{
 const calls=[];
 const result=await readNodeNetwork(async(method,params)=>{
  calls.push(method);
  if(method==='synergy_chainStatus')return {chain_id:99999};
  if(method==='synergy_chainTelemetry'){assert.deepEqual(params,{});return telemetry();}
  return {reported:true};
 },profile);
 assert.equal(result.canaryRuntime.finalizedHeight,100);
 assert.deepEqual(calls,['synergy_chainStatus','synergy_chainTelemetry','synergy_nodeStatus','synergy_posyStatus','synergy_syncStatus']);
 const refused=[];
 await assert.rejects(()=>readNodeNetwork(async method=>{refused.push(method);return method==='synergy_chainStatus'?{chain_id:99999}:{...telemetry(),genesis_hash:'0'.repeat(64)};},profile));
 assert.deepEqual(refused,['synergy_chainStatus','synergy_chainTelemetry']);
});
