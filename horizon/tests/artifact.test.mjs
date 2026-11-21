import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {inspectHorizonRun, MAX_ARTIFACT_BYTES} from '../src/artifact.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', {value: webcrypto});

const record = {
  schemaVersion: 1,
  kind: 'horizon-local-run',
  model: 'local:fixture',
  prompt: 'Hello',
  output: 'Reply 🌐',
  runtime: 'Ollama at 127.0.0.1:11434',
  verification: 'unverified-local-inference',
};
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
function artifact(value = record, overrides = {}) {
  const hashContent = JSON.stringify(value, null, 2);
  return JSON.stringify({record: value, hashContent, sha256: digest(hashContent), ...overrides});
}

test('checks the exact exported hash string and accepts reordered object keys', async () => {
  const reordered = Object.fromEntries(Object.entries(record).reverse());
  const value = await inspectHorizonRun(artifact(record, {
    record: reordered,
    receipt: {algorithm: 'Falcon-1024', signature: 'untrusted data'},
  }));
  assert.deepEqual(value, {
    model: 'local:fixture',
    outputCharacters: 7,
    sha256: digest(JSON.stringify(record, null, 2)),
    replay: null,
    receiptFieldPresent: true,
  });
});

test('refuses altered content, changed digests, unsupported claims and oversized UTF-8', async () => {
  await assert.rejects(inspectHorizonRun(artifact(record, {record: {...record, output: 'tampered'}})), /differs/);
  await assert.rejects(inspectHorizonRun(artifact(record, {sha256: '0'.repeat(64)})), /does not match/);
  await assert.rejects(inspectHorizonRun(artifact({...record, verification: 'verified'})), /version 1/);
  await assert.rejects(inspectHorizonRun('☃'.repeat(Math.ceil(MAX_ARTIFACT_BYTES / 3))), /2 MB or less/);
  await assert.rejects(inspectHorizonRun('Sensitive malformed record'), {
    message: 'The file is not readable JSON.',
  });
});

test('recomputes replay comparisons and refuses a false claim even in a rehashed export', async () => {
  const secondOutput = 'Different output';
  const modelDigest = 'a'.repeat(64);
  const replay = {
    runs: 2,
    temperature: 0,
    seed: 0,
    inferenceVerified: false,
    secondOutput,
    firstOutputSha256: digest(record.output),
    secondOutputSha256: digest(secondOutput),
    exactOutputMatch: false,
    sameModelPromptAndRuntime: true,
    sameReportedModelDigest: true,
    repeatabilityMatched: false,
    secondModel: record.model,
    secondPrompt: record.prompt,
    secondRuntime: record.runtime,
    secondReportedModelDigest: modelDigest,
  };
  const replayRecord = {...record, reportedModelDigest: modelDigest, localReplay: replay};
  const value = await inspectHorizonRun(artifact(replayRecord));
  assert.deepEqual(value.replay, {
    exactOutputMatch: false, sameModelPromptAndRuntime: true, sameReportedModelDigest: true,
  });
  for (const change of [{exactOutputMatch: true}, {secondPrompt: 'changed'}, {secondOutputSha256: '0'.repeat(64)}]) {
    await assert.rejects(inspectHorizonRun(artifact({...replayRecord, localReplay: {...replay, ...change}})), /replay summary disagrees/);
  }
});

test('bounds nesting and rejects a superseded digest check', async () => {
  let metadata = {};
  for (let i = 0; i < 80; i++) metadata = {next: metadata};
  await assert.rejects(inspectHorizonRun(artifact({...record, metadata})), /nested too deeply/);

  const controller = new AbortController();
  const checking = inspectHorizonRun(artifact(), controller.signal);
  controller.abort();
  await assert.rejects(checking, {name: 'AbortError'});
});
