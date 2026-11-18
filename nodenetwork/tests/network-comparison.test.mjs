import assert from 'node:assert/strict';
import test from 'node:test';
import {canCompareEndpoint, readNetworkComparison} from '../src/network-comparison.js';

const primary = {id: 'primary', rpc: 'https://primary.example.invalid/', chainId: 1266};
const baseline = {id: 'baseline', rpc: 'https://baseline.example.invalid/', chainId: 1266};
const chain = {chain_id: 1266, network_id: 'fixture-network', chain_incarnation: 5, genesis_hash: 'fixture-genesis'};

function readiness(identity = chain) {
 return {
  chain: identity, ready: true,
  health: {chain: identity, status: 'healthy', chain_state_available: true, fail_closed: false, latest_height: 0},
 };
}

test('rejects duplicate or incompatible endpoint references before either read', async () => {
 assert.equal(canCompareEndpoint(primary, baseline), true);
 for (const invalid of [
  {...baseline, rpc:'https://PRIMARY.example.invalid:443/#ignored'},
  {...baseline, id: primary.id}, {...baseline, chainId: 99999},
  {...baseline, rpc:'https://user@baseline.example.invalid/'}, {...baseline, rpc:'wss://baseline.example.invalid/'},
 ]) {
  assert.equal(canCompareEndpoint(primary, invalid), false);
  await assert.rejects(() => readNetworkComparison(() => assert.fail('request ran'), primary, invalid), /distinct RPC/);
 }
});

test('compares the exact reported network, incarnation and genesis after chain checks', async () => {
 const calls = [];
 let reference = chain;
 const request = async (method, params, {endpoint}) => {
  calls.push({method, params, endpoint});
  if (method === 'synergy_getChainId') return '0x4f2';
  return readiness(endpoint === baseline.rpc ? reference : chain);
 };
 const matching = await readNetworkComparison(request, primary, baseline);
 assert.equal(matching.outcome, 'match');
 assert.deepEqual(matching.differences, []);
 assert.equal(matching.selected.chain.incarnation, '5');
 assert.ok(Number.isSafeInteger(matching.reference.receivedAt));
 assert.deepEqual(calls.filter(call => call.endpoint === baseline.rpc).map(call => call.method), ['synergy_getChainId','synergy_getReadiness']);
 assert.deepEqual(calls.filter(call => call.endpoint === primary.rpc).map(call => call.method), ['synergy_getChainId','synergy_getReadiness']);
 assert.ok(calls.every(call => call.params.length === 0));

 reference = {...chain, network_id: 'other-fixture', chain_incarnation: 6, genesis_hash: 'other-genesis'};
 const mismatch = await readNetworkComparison(request, primary, baseline);
 assert.equal(mismatch.outcome, 'mismatch');
 assert.deepEqual(mismatch.differences, ['network','incarnation','genesis']);
});

test('keeps the supported peer report when the other source fails its chain check', async () => {
 const calls = [];
 const result = await readNetworkComparison(async (method, _params, {endpoint}) => {
  calls.push([endpoint, method]);
  if (method === 'synergy_getChainId') return endpoint === baseline.rpc ? 99999 : 1266;
  return readiness();
 }, primary, baseline);
 assert.equal(result.outcome, 'unavailable');
 assert.equal(result.selected.chain.chainId, 1266);
 assert.equal(result.reference, null);
 assert.ok(!calls.some(([endpoint, method]) => endpoint === baseline.rpc && method === 'synergy_getReadiness'));
});

test('an aborted comparison stops before dispatch', async () => {
 const controller = new AbortController();
 controller.abort();
 await assert.rejects(
  () => readNetworkComparison(() => assert.fail('aborted request ran'), primary, baseline, controller.signal),
  {name: 'AbortError'},
 );
});
