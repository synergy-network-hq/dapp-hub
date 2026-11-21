import assert from 'node:assert/strict';
import test from 'node:test';
import {controllerOperation} from '../src/nodeNetwork.js';
import {targetControllerObservation} from '../src/target-observation.js';

const known = {
 root: '/opt/synergy',
 platform: 'linux',
 architecture: 'x86_64',
 controllerVersion: 1,
 installed: false,
 communityEnrollment: false,
 operations: [{operation: 'health', available: true}],
};

test('controller status keeps its receipt and preserves false observations', () => {
 const observed = targetControllerObservation(known, 1000);
 assert.equal(observed.receivedAt, 1000);
 assert.deepEqual(observed.summary, {
  installationRoot: '/opt/synergy',
  reportedPlatform: 'linux',
  reportedArchitecture: 'x86_64',
  controllerVersion: 1,
  controllerReportedInstalled: false,
  controllerReportedLocalSupport: 'Not reported',
  controllerReportedCommunityEnrollment: false,
 });
 assert.equal(controllerOperation(observed, 'health').available, true);
});

test('missing and wrong-root metadata cannot supply capabilities', () => {
 for (const bad of [null, [], 'linux', {}, {...known, root: '/other'}]) {
  assert.throws(() => targetControllerObservation(bad, 1000), /unsupported installation root/);
 }
});

test('unsupported metadata and ambiguous operation declarations do not become valid observations', () => {
 const observed = targetControllerObservation({
  ...known,
  platform: '/private/fixture/path',
  controllerVersion: {arbitrary: 'fixture'},
  installed: 'false',
  unrelatedPayload: 'fixture',
  operations: [...known.operations, ...known.operations],
 }, 1000);
 assert.equal(observed.summary.reportedPlatform, 'Not reported');
 assert.equal(observed.summary.controllerVersion, 'Not reported');
 assert.equal(observed.summary.controllerReportedInstalled, 'Not reported');
 assert.doesNotMatch(JSON.stringify(observed.summary), /fixture/);
 assert.equal(controllerOperation(observed, 'health').available, false);
 const oversized = targetControllerObservation({...known, operations: Array(101).fill(known.operations[0])}, 1000);
 assert.equal(controllerOperation(oversized, 'health').available, false);
});
