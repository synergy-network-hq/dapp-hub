import assert from 'node:assert/strict';
import test from 'node:test';
import {readValidatorActiveListing, validatorActiveListing} from '../src/validator-active-list.js';

const first = 'synv' + 'a'.repeat(37);
const second = 'synv' + 'b'.repeat(37);
const row = {address: first, status: 'Active', public_key: 'fixture key excluded'};
const profile = {rpc: 'https://fixture.example.invalid', chainId: 1266};

test('projects a matching or absent address without returning other validator metadata', () => {
 assert.deepEqual(validatorActiveListing([row], first, 1000), {address:first, listed:true, count:1, receivedAt:1000});
 assert.deepEqual(validatorActiveListing([row], second, 1000), {address:second, listed:false, count:1, receivedAt:1000});
 assert.deepEqual(validatorActiveListing([], second, 1000), {address:second, listed:false, count:0, receivedAt:1000});
 assert.equal(validatorActiveListing([{...row,address:first.toUpperCase()}], first).listed, true);
});

test('refuses malformed, duplicate, non-active, or oversized responses without inferring absence', () => {
 for (const value of [null, {items:[row]}, Array(513).fill(row), [null], [row, {...row,address:first.toUpperCase()}],
  [{...row,address:first+'\n'}], [{...row,status:'Inactive'}], [{...row,address:'synw'+'a'.repeat(37)}],
 ]) assert.throws(()=>validatorActiveListing(value, first), /unsupported active validator list/);
});

test('dispatches only the existing RPC reads after chain validation and honors cancellation', async () => {
 const methods = [];
 let chain = '0x4f2';
 const request = async (method, params, options) => {
  methods.push(method);
  assert.deepEqual(params, []);
  assert.equal(options.endpoint, profile.rpc);
  return method === 'synergy_getChainId' ? chain : [row];
 };
 assert.equal((await readValidatorActiveListing(request, profile, first)).listed, true);
 assert.deepEqual(methods, ['synergy_getChainId','synergy_getValidators']);
 methods.length = 0;
 assert.throws(()=>readValidatorActiveListing(request, {...profile,chainId:99999}, first), /requires Synergy Testnet chain 1266/);
 assert.deepEqual(methods, []);
 chain = 99999;
 await assert.rejects(readValidatorActiveListing(request, profile, first), /does not match/);
 assert.deepEqual(methods, ['synergy_getChainId']);

 const controller = new AbortController();
 const interrupted = async method => {
  assert.equal(method, 'synergy_getChainId');
  controller.abort();
  return '0x4f2';
 };
 await assert.rejects(readValidatorActiveListing(interrupted, profile, first, controller.signal), {name:'AbortError'});
});

const genesis = 'a'.repeat(64);
const context = {chain_id:1266, network_id:'testnet-fixture', chain_incarnation:'5', genesis_hash:genesis};
const readiness = {chain:context, ready:true, health:{
 chain:context, status:'healthy', chain_state_available:true, fail_closed:false, latest_height:0,
}};

test('checks a configured Genesis pin against matching owner readiness contexts before reading a list', async () => {
 const methods = [];
 const pinned = {...profile, genesisHash:genesis};
 const request = async (method, params, options) => {
  assert.deepEqual(params, []);
  assert.equal(options.endpoint, profile.rpc);
  methods.push(method);
  if (method === 'synergy_getChainId') return 1266;
  if (method === 'synergy_getReadiness') return readiness;
  return [row];
 };
 const result = await readValidatorActiveListing(request, pinned, first);
 assert.equal(result.listed, true);
 assert.equal(result.reportedGenesis, genesis);
 assert.deepEqual(methods, ['synergy_getChainId','synergy_getReadiness','synergy_getValidators']);
 methods.length = 0;
 await assert.rejects(readValidatorActiveListing(request, {...pinned,genesisHash:'b'.repeat(64)}, first), /Genesis hash does not match/);
 assert.deepEqual(methods, ['synergy_getChainId','synergy_getReadiness']);
});

test('stops before listing when a configured pin is malformed, readiness disagrees, or the scope aborts', async () => {
 const pinned = {...profile, genesisHash:genesis};
 await assert.rejects(readValidatorActiveListing(() => assert.fail('invalid pin dispatched'), {...pinned,genesisHash:'xyz'}, first), /pin is invalid/);
 for (const response of [
  {...readiness, health:{...readiness.health, chain:{...context, chain_incarnation:'6'}}},
  {...readiness, health:{...readiness.health, chain:{...context, genesis_hash:'b'.repeat(64)}}},
 ]) {
  const request = async method => {
   if (method === 'synergy_getChainId') return 1266;
   assert.equal(method, 'synergy_getReadiness');
   return response;
  };
  await assert.rejects(readValidatorActiveListing(request, pinned, first), /readiness chain contexts disagree/);
 }
 const controller = new AbortController();
 const request = async method => {
  if (method === 'synergy_getChainId') return 1266;
  assert.equal(method, 'synergy_getReadiness');
  controller.abort();
  return readiness;
 };
 await assert.rejects(readValidatorActiveListing(request, pinned, first, controller.signal), {name:'AbortError'});
});
