import assert from 'node:assert/strict';
import test from 'node:test';
import {readValidatorRecord, validatorRecordObservation} from '../src/validator-record.js';

const address = 'synv' + 'a'.repeat(37);
const genesis = 'b'.repeat(64);
const profile = {chainId:1266,rpc:'https://rpc.example.invalid',genesisHash:genesis};
const readiness = {chain:{chainId:1266,network:'synergy-testnet-v3',incarnation:'5',genesis}};
const sourceChain = {chain_id:1266,network_id:'synergy-testnet-v3',chain_incarnation:5,genesis_hash:genesis};
const wireReadiness = {chain:sourceChain,ready:true,health:{chain:sourceChain,status:'healthy',chain_state_available:true,fail_closed:false,latest_height:254}};
const row = {
 address,status:'Shadow',stake_amount:'9007199254740993',min_stake_required:'50000000000000',
 activation_tx_hash:`syntxn-${'c'.repeat(64)}`,cluster_id:'0',cluster_assignment_epoch:'0',
 cluster_assignment_effective_height:null,shadow_started_at_height:'100',activation_recorded_height:'120',activation_effective_height:'121',
 email:'excluded private fixture', public_key:'excluded key fixture',
};
const result = {chainContext:{chainId:1266,incarnation:5,genesis},record:row};

test('projects exact reported stake and separate activation and assignment fields', () => {
 assert.deepEqual(validatorRecordObservation(result,address,readiness,1000), {address,incarnation:'5',receivedAt:1000,record:{
  status:'Shadow',stakeNwei:'9007199254740993',minimumNwei:'50000000000000',activationReference:row.activation_tx_hash,
  cluster_id:'0',cluster_assignment_epoch:'0',cluster_assignment_effective_height:null,shadow_started_at_height:'100',
  activation_recorded_height:'120',activation_effective_height:'121',
 }});
 assert.equal(validatorRecordObservation({...result,record:null},address,readiness).record,null);
 assert.equal(validatorRecordObservation({...result,record:{...row,activation_tx_hash:'genesis'}},address,readiness).record.activationReference,'genesis');
});

test('refuses unsupported identity, status, amounts and lifecycle references without inferring absence', () => {
 for (const changed of [{address:'another'}, {status:'Queued'}, {stake_amount:'9007199254740993\n'}, {stake_amount:9007199254740993},
  {min_stake_required:'18446744073709551616'}, {activation_tx_hash:'syntxn-opaque'}, {activation_tx_hash:`synxxn-${'c'.repeat(64)}`},
  {activation_effective_height:undefined}]) {
  assert.throws(()=>validatorRecordObservation({...result,record:{...row,...changed}},address,readiness),/unsupported validator record/);
 }
 for (const changed of [{chainId:99999},{incarnation:6},{genesis:'d'.repeat(64)}]) {
  assert.throws(()=>validatorRecordObservation({chainContext:{...result.chainContext,...changed},record:null},address,readiness),/different chain contexts/);
 }
});

test('checks selected readiness, pin, permission and cancellation before and after the owner read', async () => {
 const controller = new AbortController();
 const signal = controller.signal;
 const calls = [];
 const reads = [];
 let allowed = true;
 let revokeAfterRead = false;
 const request = async (method,params,options) => {
  calls.push({method,params,options});
  return method==='synergy_getChainId' ? '0x4f2' : wireReadiness;
 };
 const readRecord = async (target,options) => {
  reads.push({target,options});
  if (revokeAfterRead) allowed=false;
  return result;
 };
 const lookup = (chosen = profile) => readValidatorRecord(request,readRecord,chosen,address,signal,()=>allowed);
 assert.equal((await lookup()).record.status,'Shadow');
 assert.deepEqual(calls.map(call=>[call.method,call.params]),[['synergy_getChainId',[]],['synergy_getReadiness',[]]]);
 assert.ok(calls.every(call=>call.options.endpoint===profile.rpc && call.options.signal===signal));
 assert.deepEqual(reads,[{target:address,options:{endpoint:profile.rpc,signal}}]);
 reads.length=0;
 await assert.rejects(lookup({...profile,genesisHash:'d'.repeat(64)}),/does not match the configured pin/);
 assert.equal(reads.length,0);
 revokeAfterRead=true;
 await assert.rejects(lookup(),/read access is unavailable/);
 assert.equal(reads.length,1);
 const earlierCalls = calls.length;
 controller.abort();
 await assert.rejects(lookup(),{name:'AbortError'});
 assert.equal(calls.length,earlierCalls);
});
