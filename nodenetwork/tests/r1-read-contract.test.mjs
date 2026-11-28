import assert from 'node:assert/strict';
import test from 'node:test';
import {r1NetworkCoordinate,sameR1NetworkCoordinate,r1PublicReadRequest} from '../../shared/data-view/src/r1-read-contract.js';
const tagged=(name,algorithm,size,byte)=>({profile:{name,revision:1},algorithm,encoding:'lowercase-hex',value:byte.repeat(size)});
const fixture=()=>({
 chain_id:'18446744073709551615',
 network_incarnation_commitment:{algorithm:'SHA3-512',encoding:'lowercase-hex',value:'11'.repeat(64)},
 genesis_commitment:tagged('SYNERGY-GENESIS-R1','SHA3-384',48,'22'),
 activated_profiles:tagged('SYNTHETIC-PROFILES','SHA3-512',64,'33'),
 identity_profile:{name:'APQE-NATIVE-ID',revision:1},presentation_version:2,
});
test('wire coordinate preserves full widths and u64 chain exactly without authority claims',()=>{
 const input=fixture(),parsed=r1NetworkCoordinate(input);
 assert.deepEqual(parsed,input);
 input.genesis_commitment.value='44'.repeat(48);
 assert.equal(parsed.genesis_commitment.value,'22'.repeat(48));
 assert.equal(sameR1NetworkCoordinate(input,parsed),false);
 for(const mutate of [
  c=>c.chain_id='0',c=>c.chain_id='18446744073709551616',c=>c.chain_id='09969',
  c=>c.chain_id=9969,c=>c.presentation_version=1,c=>c.identity_profile.revision=2,
  c=>c.genesis_commitment.algorithm='SHA-256',c=>c.genesis_commitment.value='22'.repeat(32),
  c=>c.activated_profiles.value='33'.repeat(48),c=>c.extra=true,
  c=>c.identity_profile=['APQE-NATIVE-ID',1],c=>c.genesis_commitment.profile.name='other',
 ]) {const c=fixture();mutate(c);assert.throws(()=>r1NetworkCoordinate(c));}
});
test('every coordinate component and profile participates in equality; zero never wildcard',()=>{
 const expected=fixture();
 for(const change of [
  c=>c.chain_id='9969',c=>c.network_incarnation_commitment.value='00'.repeat(64),
  c=>c.genesis_commitment.value='00'.repeat(48),c=>c.activated_profiles.value='00'.repeat(64),
  c=>c.activated_profiles.profile.revision=2,
 ]){const value=fixture();change(value);assert.equal(sameR1NetworkCoordinate(value,expected),false);}
});
test('exact current envelope has no positional or legacy fallback',()=>{
 const request=r1PublicReadRequest('synergy_getFinalizedHead',{},fixture(),'synthetic-read');
 assert.deepEqual(Object.keys(request),['api_version','request_id','caller_scope','network','args']);
 assert.equal(request.caller_scope,'public_read');
 assert.equal(request.api_version,1);
 for(const [method,args] of [['synergy_getFinalizedHead',[]],['synergy_getValidators',{}],
  ['synergy_getBlock',{height:'1',block_commitment:fixture().genesis_commitment}],
  ['synergy_getBlock',{height:1}],['synergy_getBlock',{height:'01'}],
  ['synergy_getAccount',{address:'synw'+'a'.repeat(36)}],
  ['synergy_getTransaction',{transaction_id:'syntxn.2.'+'A'.repeat(64)}],
 ])assert.throws(()=>r1PublicReadRequest(method,args,fixture(),'synthetic-read'));
});
test('full identifier case and exact block selectors survive request construction',()=>{
 const address='synw.2.'+'Aa_-'.repeat(16),tx='syntxn'+'Ab9_'.repeat(16);
 assert.equal(r1PublicReadRequest('synergy_getAccount',{address},fixture(),'read').args.address,address);
 assert.equal(r1PublicReadRequest('synergy_getTransaction',{transaction_id:tx},fixture(),'read').args.transaction_id,tx);
 assert.equal(r1PublicReadRequest('synergy_getBlock',{height:'18446744073709551615'},fixture(),'read').args.height,'18446744073709551615');
 assert.deepEqual(r1PublicReadRequest('synergy_getBlock',{block_commitment:fixture().genesis_commitment},fixture(),'read').args.block_commitment,fixture().genesis_commitment);
});
