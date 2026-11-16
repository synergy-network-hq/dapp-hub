import assert from 'node:assert/strict';
import test from 'node:test';
import {filterRequests, matchesUnresolvedGenesisReceipt, matchesUnresolvedServiceDispatch, parseRequestHistory, requestStatusLabel, retainsUnresolvedDispatch, reviewRequestSelection} from '../src/request-history.js';

const targetA = 'a'.repeat(64);
const targetB = 'b'.repeat(64);
const record = (id, target_digest, operation, state, response_ok, observed_at_ms) => ({
 version: 1,
 id: id.repeat(64),
 target_digest,
 request_digest: 'c'.repeat(64),
 operation,
 recorded_at_ms: 1000,
 observed_at_ms,
 state,
 response_ok,
});

const accepted = record('1', targetA, 'start', 'response_received', true, 1001);
const refused = record('2', targetA, 'install', 'response_received', false, 1002);
const unknown = record('3', targetB, 'install', 'dispatch_intent', null, null);
const uncertain = record('4', targetB, 'upgrade', 'uncertain', null, 1003);
const envelope = {
 schema: 'nodenetwork-local-requests-v1',
 limit: 256,
 remoteJobRecovery: false,
 automaticReplay: false,
 records: [accepted, refused, unknown, uncertain],
};
const defaults = {status: 'all', operation: 'all', target: null};

test('distinct outcome filters preserve ordinary receipt and unresolved views', () => {
 const {records} = parseRequestHistory(envelope);
 assert.deepEqual(filterRequests(records, {...defaults, status: 'responses'}), [accepted, refused]);
 assert.deepEqual(filterRequests(records, {...defaults, status: 'reported-ok'}), [accepted]);
 assert.deepEqual(filterRequests(records, {...defaults, status: 'refused'}), [refused]);
 assert.deepEqual(filterRequests(records, {...defaults, status: 'unresolved'}), [unknown, uncertain]);
 assert.equal(requestStatusLabel(refused), 'Controller reported refusal');
 assert.equal(requestStatusLabel(accepted), 'Controller reported ok');
 assert.equal(requestStatusLabel(unknown), 'Outcome unknown · dispatch recorded');
 assert.equal(requestStatusLabel(uncertain), 'Outcome uncertain');
});

test('operation and exact configured target fingerprints combine without changing records', () => {
 const {records} = parseRequestHistory(envelope);
 assert.deepEqual(filterRequests(records, {...defaults, operation: 'install'}), [refused, unknown]);
 assert.deepEqual(filterRequests(records, {...defaults, operation: 'install', target: targetB}), [unknown]);
 assert.deepEqual(filterRequests(records, {...defaults, target: targetB.slice(0, 12)}), []);
 assert.deepEqual(records, [accepted, refused, unknown, uncertain]);
});

test('requires the exact still-unresolved service operation for the selected configured fingerprint', () => {
 assert.equal(matchesUnresolvedServiceDispatch(unknown, targetB), false);
 for (const operation of ['register', 'start', 'restart', 'stop']) {
  const reviewed = {...uncertain, operation};
  const differentServiceOperation = operation === 'start' ? 'restart' : 'start';
  assert.equal(matchesUnresolvedServiceDispatch(reviewed, targetB), true);
  assert.equal(matchesUnresolvedServiceDispatch({...unknown, operation}, targetB), true);
  assert.equal(matchesUnresolvedServiceDispatch(reviewed, targetA), false);
  assert.equal(retainsUnresolvedDispatch([{...reviewed}], reviewed, targetB), true);
  assert.equal(retainsUnresolvedDispatch([{...reviewed}], reviewed, targetA), false);
  const received = {...reviewed, state:'response_received', response_ok:true};
  for (const changed of [received, {...reviewed, state:'dispatch_intent', observed_at_ms:null},
   {...reviewed, id:accepted.id}, {...reviewed, operation:differentServiceOperation}, {...reviewed, recorded_at_ms:1001},
   {...reviewed, observed_at_ms:1002}, {...reviewed, target_digest:targetA}, {...reviewed, request_digest:targetA}]) {
   assert.equal(retainsUnresolvedDispatch([changed], reviewed, targetB), false);
  }
  assert.equal(retainsUnresolvedDispatch([], reviewed, targetB), false);
 }
});

test('admits only the exact unresolved Genesis staging or binding dispatch for receipt inspection', () => {
 for (const operation of ['genesis_stage','genesis_bind']) {
  const selected = {...unknown, operation};
  assert.equal(matchesUnresolvedGenesisReceipt(selected, targetB), true);
  assert.equal(matchesUnresolvedGenesisReceipt({...selected, state:'uncertain', observed_at_ms:1001}, targetB), true);
  assert.equal(matchesUnresolvedGenesisReceipt(selected, targetA), false);
  for (const record of [null, {...selected, operation:'formation_prepare'}, {...selected, state:'response_received', response_ok:true}]) {
   assert.equal(matchesUnresolvedGenesisReceipt(record, targetB), false);
  }
  assert.equal(retainsUnresolvedDispatch([selected], selected, targetB), true);
  const otherOperation = operation === 'genesis_stage' ? 'genesis_bind' : 'genesis_stage';
  assert.equal(retainsUnresolvedDispatch([{...selected, operation:otherOperation}], selected, targetB), false);
  assert.equal(retainsUnresolvedDispatch([{...selected, request_digest:targetA}], selected, targetB), false);
 }
});

test('unsupported envelopes never yield actionable or empty history', () => {
 for (const value of [
  {...envelope, remoteJobRecovery: true},
  {...envelope, records: [{...unknown, response_ok: false}]},
  {...envelope, records: [{...uncertain, observed_at_ms: null}]},
  {...envelope, records: [{...accepted, response_ok: null}]},
  {...envelope, records: [{...refused, operation: 'retry'}]},
  {...envelope, records: [accepted, {...refused, id: accepted.id}]},
 ]) {
  assert.throws(() => parseRequestHistory(value), /History is unavailable/);
 }
});

test('selected export snapshots retain local correlation while excluding target and request fingerprints', () => {
 const scoped = {...envelope, records: [{...accepted, rawResponse: 'fixture excluded'}, refused, unknown, uncertain]};
 const summary = reviewRequestSelection(scoped, [accepted.id, unknown.id], 2000);
 assert.equal(summary.schema, 'nodenetwork-local-request-summary-v1');
 assert.equal(summary.reviewedAt, '1970-01-01T00:00:02.000Z');
 assert.deepEqual(summary.records.map(observation => observation.localRequestId), [accepted.id, unknown.id]);
 assert.deepEqual(summary.records.map(observation => observation.controllerReportedOk), [true, null]);
 assert.equal(summary.records[1].outcomeRecordedAt, null);
 const text = JSON.stringify(summary);
 assert.ok(!text.includes(targetA));
 assert.ok(!text.includes(targetB));
 assert.ok(!text.includes(accepted.request_digest));
 assert.doesNotMatch(text, /target_digest|request_digest|rawResponse|fixture excluded/);
 scoped.records[0].response_ok = false;
 assert.equal(summary.records[0].controllerReportedOk, true);
});

test('rejects empty, malformed or stale selections before building an export', () => {
 for (const ids of [[], ['bad'], [accepted.id, accepted.id], ['9'.repeat(64)]]) {
  assert.throws(() => reviewRequestSelection(envelope, ids));
 }
 assert.throws(() => reviewRequestSelection({...envelope, automaticReplay: true}, [accepted.id]));
});
