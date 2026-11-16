import assert from 'node:assert/strict';
import test from 'node:test';
import {identityGenerationInputs,identityGenerationObservation,identityPreflightObservation} from '../src/identity-preflight.js';

const common = {network_id: 'fixture-network', chain_id: '18446744073709551615'};
const genesis = {...common, genesis_authority_verified: true, genesis_sha256: 'a'.repeat(64)};
const formation = {...common, schema: 'nodenetwork-formation-v1', formation_sha256: 'b'.repeat(64), formation_id: 'c'.repeat(64)};
const binding = {...genesis, schema: 'nodenetwork-genesis-binding-v1', address: 'synv1' + 'a'.repeat(36),
 membership_verified: true, bound: false, stage_receipt_verified: false};

test('uses only the reviewed existing-network Genesis digest and validates the correlated public reply', () => {
 const reviewed=identityPreflightObservation('identity_preflight',genesis);
 assert.deepEqual(identityGenerationInputs(reviewed,{network_id:common.network_id,chain_id:common.chain_id}),{genesis_sha256:genesis.genesis_sha256});
 assert.equal(identityGenerationInputs(reviewed,{chain_id:'1266'}),null);
 assert.equal(identityGenerationInputs(reviewed,{network_id:'other-network'}),null);
 assert.equal(identityGenerationInputs(null,{}),null);
 const result={...genesis,address:binding.address,possession_verified:true,membership_granted:false};
 assert.deepEqual(identityGenerationObservation(result,reviewed),{kind:'Existing-network custody',pending:true,
  validatorAddress:binding.address,networkId:common.network_id,chainId:common.chain_id,genesisSha256:genesis.genesis_sha256});
 for (const invalid of [{...result,genesis_sha256:'b'.repeat(64)},{...result,network_id:'other-network'},
  {...result,chain_id:'1266'},{...result,membership_granted:true},{...result,possession_verified:false},
  {...result,address:binding.address+'\n'},{...result,unlock:'private fixture'}]) {
  assert.throws(()=>identityGenerationObservation(invalid,reviewed),/outcome is uncertain/);
 }
});

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

test('decodes typed binding evidence with independent bound and stage-receipt states', () => {
 const expected = {title: 'Staged Genesis binding', networkId: common.network_id, chainId: common.chain_id,
  genesisSha256: genesis.genesis_sha256, validatorAddress: binding.address};
 assert.deepEqual(identityPreflightObservation('genesis_binding_preflight', binding), {
  ...expected, bound: false, stageReceiptVerified: false,
 });
 assert.deepEqual(identityPreflightObservation('genesis_binding_preflight', {...binding, bound: true, stage_receipt_verified: true}), {
  ...expected, bound: true, stageReceiptVerified: true,
 });
 assert.equal(identityPreflightObservation('genesis_binding_preflight', {...binding, bound: true}).stageReceiptVerified, false);
 assert.equal(identityPreflightObservation('genesis_binding_preflight', {...binding, stage_receipt_verified: true}).bound, false);
 for (const input of [genesis, {...binding, membership_verified: false}, {...binding, bound: 'yes'},
  {...binding, stage_receipt_verified: null}, {...binding, enrollment_json: 'unexpected artifact'},
 ]) assert.throws(() => identityPreflightObservation('genesis_binding_preflight', input), /unsupported validator preparation/);
});
