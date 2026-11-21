import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {recoveryPreflightObservation, reviewSavedRecovery} from '../src/recovery-handoff.js';
import {parseValidatorObservation} from '../src/validator-operations-observation.js';

const fixture = readFileSync(new URL('./fixtures/validator-operations-observation.json', import.meta.url), 'utf-8').trim();
const release = JSON.parse(fixture).release;

test('reviews exact captured heights, release mismatch, owner transition and ranked unresolved preflight', () => {
 const source = fixture.replace('{"id":"chain_id","status":"PASS","detail":"fixture detail excluded"}',
  '{"id":"chain_id","status":"PASS","detail":"fixture detail excluded"},'
  + '{"id":"storage","status":"FAIL","detail":"/fixture/private-path"},'
  + '{"id":"clock_sync","status":"PASS","detail":"ignored"},'
  + '{"id":"clock_sync","status":"FAIL","detail":"ignored"}');
 const raw = `${source.slice(0,-1)},"expected_release":${JSON.stringify({...release, core_revision:'different'})}}`;
 const review = reviewSavedRecovery(parseValidatorObservation(raw), 1000);
 assert.equal(review.schema, 'nodenetwork-recovery-handoff-v1');
 assert.equal(review.capturedAt, '2026-11-15T13:00:00Z');
 assert.equal(review.reviewedAt, '1970-01-01T00:00:01.000Z');
 assert.equal(review.headHeight, '18446744073709551615');
 assert.equal(review.finalizedHeight, '18446744073709551614');
 assert.equal(review.release.status, 'Reported mismatch');
 assert.deepEqual(review.release.fields, ['core_revision']);
 assert.equal(review.firstMissingTransition.to, 'POSY.FINALIZED');
 assert.match(review.firstMissingTransition.next, /proposal, vote and finality evidence/);
 assert.deepEqual(review.hostChecksNeedingReview.slice(0,2).map(({check,status})=>[check,status]),
  [['Storage','Reported fail'],['Clock synchronization','Ambiguous']]);
 for (const privateField of ['fixture-validator','fixture-hostname','fixture detail','fixture-network','fixture-release','/fixture/private-path','192.0.2.2']) {
  assert.ok(!JSON.stringify(review).includes(privateField));
 }
});

test('preserves unavailable reference and unknown capture time without reporting a repair result', () => {
 const source = fixture.replace('2026-11-15T13:00:00Z', '/private/time-token');
 const review = reviewSavedRecovery(parseValidatorObservation(source), 1000);
 assert.equal(review.capturedAt, null);
 assert.equal(review.release.status, 'Comparison unavailable');
 assert.ok(!JSON.stringify(review).includes('/private/time-token'));
 assert.match(review.operatorReview, /release-qualified recovery procedure/);
});

test('accepts only the typed negative controller report', () => {
 const blocked = {qualified:false,certifiedStateChanged:false};
 assert.deepEqual(recoveryPreflightObservation(blocked), {checkpointImportQualified:false,certifiedStateChanged:false});
 for (const value of [null, {...blocked,qualified:true}, {...blocked,certifiedStateChanged:true}, {...blocked,blocker:'/private/path'}]) {
  assert.throws(() => recoveryPreflightObservation(value), /unsupported recovery preflight/);
 }
});
