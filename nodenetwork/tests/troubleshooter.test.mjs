import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewTroubleshooting, troubleshoot} from '../src/troubleshooter.js';

const inputs = {
 symptom: 'sync',
 permitted: true,
 profile: {chainId: 1266, rpc: 'https://reserved.test/diagnostic-fixture'},
 hasTarget: false,
 targetSettingsReadable: true,
 local: {},
 live: {data: {
  chain: {chain_id: 1266, ready: true},
  chainReceivedAt: 1000,
  observations: {},
  receivedAt: {},
  errors: {sync: 'private fixture error text'},
 }},
};

test('prioritizes a missing sync source over a received public chain report', () => {
 const findings = troubleshoot(inputs);
 assert.equal(findings.length, 2);
 assert.equal(findings[0].label, 'Public RPC sync status');
 assert.equal(findings[0].status, 'Unavailable');
 assert.equal(findings[1].receivedAt, '1970-01-01T00:00:01.000Z');
 assert.equal(findings[1].status, 'Observed');
 const mismatched = troubleshoot({...inputs, profile: {chainId: 99999}});
 assert.equal(mismatched.length, 1);
 assert.equal(mismatched[0].status, 'Unavailable');
});

test('projects known local runtime data without interpreting host eligibility', () => {
 const input = {
  ...inputs, symptom: 'local',
  local: {data: {qualification: 'not-verified', controlAvailable: false, localValidatorSupported: false}},
 };
 assert.equal(troubleshoot(input)[0].status, 'Needs attention');
 assert.equal(troubleshoot({...input, local: {data: {localValidatorSupported: true}}})[0].status, 'Unavailable');
 assert.equal(troubleshoot({...input, local: {loading: true}})[0].status, 'Pending');
});

test('permission denial suppresses source details and deferral remains distinct from saved configuration', () => {
 const denied = troubleshoot({...inputs, permitted: false});
 assert.equal(denied.length, 1);
 assert.equal(denied[0].label, 'NodeNetwork inspection');
 const target = {...inputs, symptom: 'target'};
 assert.equal(troubleshoot(target)[0].evidence, 'Host selection is deferred.');
 assert.equal(troubleshoot({...target, hasTarget: true})[0].status, 'Observed');
 assert.equal(troubleshoot({...target, targetSettingsReadable: false})[0].status, 'Needs attention');
});

test('a review contains a frozen projection rather than raw source responses or endpoint URLs', () => {
 const report = reviewTroubleshooting(inputs, 2000);
 assert.equal(report.reviewedAt, '1970-01-01T00:00:02.000Z');
 assert.equal(report.chainId, 1266);
 assert.match(JSON.stringify(report), /nodenetwork-diagnostics-v1/);
 assert.doesNotMatch(JSON.stringify(report), /reserved\.test|private fixture error text/);
 const updated = {...inputs, live: {...inputs.live, data: {chain: {chain_id: 1266, ready: false}}}};
 assert.equal(reviewTroubleshooting(updated).findings[0].status, 'Needs attention');
 assert.equal(report.findings[0].status, 'Unavailable');
});
