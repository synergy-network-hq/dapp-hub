import assert from 'node:assert/strict';
import test from 'node:test';
import {formationPreparationInputs,formationPreparationObservation,genesisBindingInputs,genesisBindingObservation,identityGenerationInputs,identityGenerationObservation,
 identityPreflightObservation} from '../src/identity-preflight.js';

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

test('binds preparation to the reviewed formation, network and exact chain context', () => {
 const review=identityPreflightObservation('formation_preflight',formation);
 assert.deepEqual(formationPreparationInputs(review,{network_id:common.network_id,chain_id:common.chain_id}),{formation_sha256:formation.formation_sha256});
 assert.equal(formationPreparationInputs(review,{chain_id:'1266'}),null);
 assert.equal(formationPreparationInputs(review,{network_id:'other-network'}),null);
 assert.equal(formationPreparationInputs(identityPreflightObservation('identity_preflight',genesis),{}),null);
 const result={...formation,address:binding.address,pending:true,possession_verified:true,membership_granted:false,request_sha256:'d'.repeat(64)};
 assert.deepEqual(formationPreparationObservation(result,review),{kind:'Formation custody',pending:true,
  validatorAddress:binding.address,networkId:common.network_id,chainId:common.chain_id,formationSha256:formation.formation_sha256});
 for (const change of [{formation_id:'e'.repeat(64)},{formation_sha256:'e'.repeat(64)},{network_id:'other-network'},{chain_id:'1266'},
  {pending:false},{membership_granted:true},{possession_verified:false},{address:binding.address+'\n'},
  {request_sha256:'e'.repeat(63)+'\n'},{registration_json:'excluded'}]) {
  assert.throws(()=>formationPreparationObservation({...result,...change},review),/outcome is uncertain/);
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

test('binds only the unbound Genesis review with the same retained formation and returns scoped public acknowledgement', () => {
 const reviewed=identityPreflightObservation('genesis_binding_preflight',binding);
 const retained={kind:'Formation custody',pending:true,networkId:common.network_id,chainId:common.chain_id,
  validatorAddress:binding.address,formationSha256:formation.formation_sha256};
 assert.deepEqual(genesisBindingInputs(reviewed,retained,{chain_id:common.chain_id,network_id:common.network_id}),
  {genesis_sha256:genesis.genesis_sha256});
 assert.equal(genesisBindingInputs(reviewed,retained,{chain_id:'99999'}),null);
 assert.equal(genesisBindingInputs({...reviewed,bound:true},retained,{}),null);
 assert.equal(genesisBindingInputs(reviewed,null,{}),null);
 for (const change of [{kind:'Existing-network custody'},{pending:false},{validatorAddress:'synv1'+'b'.repeat(36)},
  {chainId:'99999'},{networkId:'other-network'},{formationSha256:null}]) {
  assert.equal(genesisBindingInputs(reviewed,{...retained,...change},{}),null);
 }
 const result={...binding,bound:true};
 assert.deepEqual(genesisBindingObservation(result,reviewed),{...reviewed,bound:true,stageReceiptVerified:false});
 assert.equal(genesisBindingObservation({...result,stage_receipt_verified:true},reviewed).stageReceiptVerified,true);
 for (const change of [{bound:false},{genesis_sha256:'e'.repeat(64)},{chain_id:'99999'},{network_id:'another-network'},
  {address:'synv1'+'e'.repeat(36)},{enrollment_json:'excluded'},{membership_verified:false}]) {
  assert.throws(()=>genesisBindingObservation({...result,...change},reviewed),/Genesis binding outcome is uncertain/);
 }
});

test('accepts optional scoped preflight while keeping request attribution separate',()=>{
 const scoped={...genesis,schema:'nodenetwork-existing-identity-network-v1',membership_granted:false,stage_request_sha256:'d'.repeat(64)};
 assert.deepEqual(identityPreflightObservation('identity_preflight',scoped),{
  title:'Existing-network preflight',networkId:common.network_id,chainId:common.chain_id,genesisSha256:genesis.genesis_sha256,
  existingNetworkScoped:true,stagingReceiptRecorded:true,identityRequestRecorded:false,
 });
 for(const change of [{schema:'future'},{membership_granted:true},{stage_request_sha256:'bad'},{request_sha256:'e'.repeat(64)},{private_key:'excluded'}])
  assert.throws(()=>identityPreflightObservation('identity_preflight',{...scoped,...change}),/unsupported validator preparation/);
});

test('verifies the scoped canonical identity request and refuses contradictory provenance',async()=>{
 const {verifyIdentityRequest}=await import('../src/identity-evidence.js');
 const {createHash}=await import('node:crypto');
 const base={...genesis,genesis_sha256:'b'.repeat(64),schema:'nodenetwork-existing-identity-network-v1',
  address:binding.address,possession_verified:true,membership_granted:false};
 // Independently encode the owner sorted ASCII JSON contract.
 const canonical='{"operation":"identity_generate","parameters":{"genesis_sha256":"'+'b'.repeat(64)+'"},"version":1}';
 const request=createHash('sha256').update(canonical).digest('hex');
 assert.equal(request,'31f7fc6d1f59c72c450c45c0c8c1f3e307ea7b038d9459d14a3aaca37626892e');
 await verifyIdentityRequest({...base,request_sha256:request},'generation');
 await verifyIdentityRequest({...base,pending:true},'status');
 await assert.rejects(verifyIdentityRequest({...base,request_sha256:'a'.repeat(64)},'generation'),/differs/);
 await assert.rejects(verifyIdentityRequest(base,'generation'),/Unsupported/);
 await assert.rejects(verifyIdentityRequest({...base,request_sha256:request,schema:'unsupported'},'generation'),/Unsupported/);
});
