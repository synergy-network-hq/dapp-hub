import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {genesisStageFiles,genesisStageInputsMatch,genesisStageLocalReview,genesisStageReceipt,genesisStageScope,inspectGenesisStageFile} from '../src/genesis-stage-files.js';
import {identityPreflightObservation} from '../src/identity-preflight.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('computes the digest of exact textual and binary artifact bytes without normalizing either', async () => {
 const files = [
  Buffer.from('\uFEFF{ "network": "local fixture é" }\r\n'),
  Buffer.from('{"authority":"fixture"}'),
  Buffer.from([0, 255, 128, 2]),
 ];
 for (const [index, input] of genesisStageFiles.entries()) {
  assert.equal(await inspectGenesisStageFile(input, new Blob([files[index]])), hash(files[index]));
 }
});

test('enforces per-file byte bounds, exact read length, and UTF-8 for both JSON fields', async () => {
 for (const input of genesisStageFiles) {
  const tooBig = {size: input.maxBytes + 1, arrayBuffer: () => assert.fail('oversize input was read')};
  await assert.rejects(inspectGenesisStageFile(input, tooBig), /nonempty/);
  await assert.rejects(inspectGenesisStageFile(input, new Blob()), /nonempty/);
  await assert.rejects(inspectGenesisStageFile(input, {size: 3, arrayBuffer: async () => new ArrayBuffer(2)}), /read in full/);
  if (input.utf8) {
   await assert.rejects(inspectGenesisStageFile(input, new Blob([new Uint8Array([255])])), /UTF-8/);
  }
 }
});

test('projected stage policy has three exact pins and no upload or identity authority', () => {
 const pins = {genesis_sha256: 'a'.repeat(64), authority_sha256: 'b'.repeat(64), authority_root_sha256: 'c'.repeat(64)};
 const policy = {schema: 'nodenetwork-genesis-stage-policy-v1', address: 'synv1' + 'b'.repeat(36),
  ...pins};
 assert.deepEqual(identityPreflightObservation('genesis_stage_preflight', policy), {
  title: 'Genesis staging policy', validatorAddress: policy.address, artifactPins: pins,
 });
 for (const invalid of [{...policy, schema: 'nodenetwork-genesis-stage-v1'},
  {...policy, genesis_authority_verified: true}, {...policy, authority_root_sha256: ''},
 ]) assert.throws(() => identityPreflightObservation('genesis_stage_preflight', invalid), /unsupported validator preparation/);
});

test('native review publishes only bounded counts and hashes and must match current owner scope', () => {
 const pins={genesis_sha256:'a'.repeat(64),authority_sha256:'b'.repeat(64),authority_root_sha256:'c'.repeat(64)};
 const validatorAddress='synv1'+'a'.repeat(36);
 const policy={validatorAddress,artifactPins:pins};
 const formation={validatorAddress,pending:true,kind:'Formation custody',networkId:'fixture-network',chainId:'99999',formationSha256:'d'.repeat(64)};
 const summary={schema:'nodenetwork-genesis-stage-local-review-v1',requestSha256:'e'.repeat(64),
  inputs:genesisStageFiles.map(({name,pin})=>({name,bytes:2,sha256:pins[pin]}))};
 const reviewed=genesisStageLocalReview(summary);
 const scope=genesisStageScope(policy,formation,{network_id:formation.networkId,chain_id:formation.chainId});
 assert.equal(genesisStageInputsMatch(reviewed,scope),true);
 assert.equal(genesisStageScope(policy,{...formation,pending:false},{}),null);
 assert.equal(genesisStageScope(policy,{...formation,validatorAddress:'synv1'+'b'.repeat(36)},{}),null);
 assert.equal(genesisStageScope(policy,formation,{chain_id:'1266'}),null);
 assert.equal(genesisStageInputsMatch({...reviewed,requestSha256:''},scope),false);
 for (const invalid of [{...summary,path:'/fixture/private'}, {...summary,inputs:summary.inputs.slice(1)},
  {...summary,inputs:[{...summary.inputs[0],bytes:0},...summary.inputs.slice(1)]},
  {...summary,inputs:[{...summary.inputs[0],bytes:genesisStageFiles[0].maxBytes+1},...summary.inputs.slice(1)]},
  {...summary,inputs:[{...summary.inputs[0],text:'fixture'},...summary.inputs.slice(1)]}]) {
  assert.throws(()=>genesisStageLocalReview(invalid),/unsupported public Genesis input evidence/);
 }
 const receipt={schema:'nodenetwork-genesis-stage-v1',address:validatorAddress,...pins,staged:true,genesis_authority_verified:true,membership_verified:true};
 assert.equal(genesisStageReceipt(receipt,scope).staged,true);
 for(const invalid of [{...receipt,staged:false},{...receipt,authority_sha256:'f'.repeat(64)},
  {...receipt,address:'synv1'+'b'.repeat(36)},{...receipt,request_sha256:'e'.repeat(64)}]) {
  assert.throws(()=>genesisStageReceipt(invalid,scope),/outcome is uncertain/);
 }
});
