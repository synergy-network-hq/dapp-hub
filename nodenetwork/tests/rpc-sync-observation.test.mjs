import assert from 'node:assert/strict';
import test from 'node:test';
import {rpcReadinessWithSync} from '../src/rpc-sync-observation.js';

const chain = {chain_id: 1266, network_id: 'fixture-testnet', chain_incarnation: 5, genesis_hash: 'fixture-genesis'};
const height = '9007199254740993';
const highest = '9007199254741001';
const headRead = {chain, syncing: true, current_block: height, highest_block: highest, state: 'Downloading',
 sync_percentage: 40, chain_state_available: true, fail_closed: false};
const readiness = (sync, available = true) => ({
 chain, ready: available,
 health: {chain, status: available ? 'healthy' : 'degraded', chain_state_available: available,
  fail_closed: !available, latest_height: available ? height : null, sync},
});

test('the owner synchronization payload yields exact reported heights and block gap', () => {
 const result = rpcReadinessWithSync(readiness(headRead), 1266);
 assert.equal(result.reportedReady, true);
 assert.deepEqual(result.sync, {
  mode: 'reported', current: height, highest, gap: '8', managerState: 'Downloading', syncing: true, percentage: 40,
 });
 assert.equal(result.syncError, null);
 const low = rpcReadinessWithSync(readiness({...headRead, highest_block: '1', state: 'Idle', syncing: false}), 1266);
 assert.equal(low.sync.gap, null);
 assert.equal(low.sync.syncing, false);
});

test('fallback and unavailable local tip keep progress unknown', () => {
 const fallback = {...headRead, fallback: true, sync_manager_available: false, chain_state_available: false, current_block: null};
 const result = rpcReadinessWithSync(readiness(fallback, false), 1266);
 assert.deepEqual(result.sync, {mode: 'manager-unavailable', current: null, highest});
 const noTip = {...headRead, chain_state_available: false, current_block: null, fail_closed: true};
 assert.deepEqual(rpcReadinessWithSync(readiness(noTip, false), 1266).sync, {mode: 'tip-unavailable', current: null, highest});
});

test('bad or missing nested synchronization leaves supported readiness separate', () => {
 for (const sync of [
  undefined,
  {...headRead, current_block: '4'},
  {...headRead, chain: {...chain, chain_incarnation: 6}},
  {...headRead, highest_block: Number.MAX_SAFE_INTEGER + 1},
  {...headRead, syncing: false},
  {...headRead, state: 'unknown'},
 ]) {
  const result = rpcReadinessWithSync(readiness(sync), 1266);
  assert.equal(result.reportedReady, true);
  assert.equal(result.sync, null);
  assert.ok(result.syncError);
 }
});
