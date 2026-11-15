import assert from 'node:assert/strict';
import test from 'node:test';
import {filterRequests, parseRequestHistory, requestStatusLabel} from '../src/request-history.js';

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
