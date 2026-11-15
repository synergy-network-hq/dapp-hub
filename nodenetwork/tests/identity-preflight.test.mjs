import assert from 'node:assert/strict';
import test from 'node:test';
import {identityPreflightObservation} from '../src/identity-preflight.js';

const common = {network_id: 'fixture-network', chain_id: '18446744073709551615'};
const genesis = {...common, genesis_authority_verified: true, genesis_sha256: 'a'.repeat(64)};
const formation = {...common, schema: 'nodenetwork-formation-v1', formation_sha256: 'b'.repeat(64), formation_id: 'c'.repeat(64)};

test('keeps reviewed Genesis and formation context distinct with exact chain IDs', () => {
 assert.deepEqual(identityPreflightObservation('identity_preflight', genesis), {
  title: 'Existing-network preflight', networkId: common.network_id, chainId: common.chain_id, genesisSha256: genesis.genesis_sha256,
 });
 assert.deepEqual(identityPreflightObservation('formation_preflight', formation), {
  title: 'Formation preflight', networkId: common.network_id, chainId: common.chain_id,
  formationSha256: formation.formation_sha256, formationId: formation.formation_id,
 });
});

test('rejects wrong kinds, unsupported contexts and custody or private fields', () => {
 for (const input of [
  formation, {...genesis, chain_id: '18446744073709551616'}, {...genesis, chain_id: '1266\n'},
  {...genesis, network_id: 'fixture-network\n'}, {...genesis, genesis_authority_verified: false},
  {...genesis, possession_verified: true}, {...genesis, genesis_sha256: 'a'.repeat(63) + '\n'},
 ]) assert.throws(() => identityPreflightObservation('identity_preflight', input), /unsupported validator preparation/);
 for (const input of [genesis, {...formation, formation_id: '0'.repeat(64)}, {...formation, receipt_path: '/private/fixture'}]) {
  assert.throws(() => identityPreflightObservation('formation_preflight', input), /unsupported validator preparation/);
 }
});
