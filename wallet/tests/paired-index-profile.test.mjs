import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesPairedIndexProfile } from '../src/paired-index-profile.js';

const connection = { chainId: 'synergy:1266' };
const rpc = 'https://testnet-core-rpc.synergy-network.io';

test('the paired index accepts its canonical RPC and the matching wallet chain', () => {
  for (const url of [rpc, `${rpc}/`]) {
    assert.equal(matchesPairedIndexProfile(connection, { chainId: 1266, rpc: url }), true);
  }
  assert.equal(matchesPairedIndexProfile({ chainId: 'synergy:99999' }, { chainId: 1266, rpc }), false);
  assert.equal(matchesPairedIndexProfile(connection, { chainId: 99999, rpc }), false);
});

test('same-chain custom RPCs cannot read the fixed paired Atlas index', () => {
  for (const url of ['https://example.invalid/', `${rpc}/other`, `${rpc}/?network=other`, 'not-a-url']) {
    assert.equal(matchesPairedIndexProfile(connection, { chainId: 1266, rpc: url }), false);
  }
});
