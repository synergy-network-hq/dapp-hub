import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {genesisStageFiles, inspectGenesisStageFile} from '../src/genesis-stage-files.js';
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
