import assert from 'node:assert/strict';
import test from 'node:test';
import {installParameters, sameUpgradeParameters, upgradeParameters} from '../src/nodeNetwork.js';
import {upgradeObservation, upgradePreflightObservation} from '../src/upgrade-preflight.js';

const packageReferences = {release_id: 'synergy-linux-test', manifest_sha256: 'a'.repeat(64)};

test('upgrade submissions match the native two-field request independently of install draft inputs', () => {
 const draft = {...packageReferences, network_id: '', chain_id: 'invalid', node_name: ''};
 assert.throws(() => installParameters(draft));
 assert.deepEqual(upgradeParameters(draft), packageReferences);
 assert.deepEqual(upgradeParameters({...draft, root: '/scratch'}), packageReferences);
});

test('upgrade refuses malformed exact release IDs and digests', () => {
 for (const invalid of [
  {...packageReferences, release_id: ''},
  {...packageReferences, release_id: 'release/path'},
  {...packageReferences, release_id: 'test\n'},
  {...packageReferences, release_id: 'a'.repeat(129)},
  {...packageReferences, manifest_sha256: 'A'.repeat(64)},
  {...packageReferences, manifest_sha256: 'a'.repeat(63)},
  {...packageReferences, manifest_sha256: 'a'.repeat(64)+'\n'},
 ]) assert.throws(() => upgradeParameters(invalid));
});

test('preflight and review become out of date when either exact package reference changes', () => {
 const review = upgradeParameters(packageReferences);
 assert.equal(sameUpgradeParameters(review, {...review}), true);
 assert.equal(sameUpgradeParameters(review, {...review, release_id: 'other'}), false);
 assert.equal(sameUpgradeParameters(review, {...review, manifest_sha256: 'b'.repeat(64)}), false);
 assert.equal(sameUpgradeParameters(review, null), false);
 assert.equal(sameUpgradeParameters({}, {}), false);
});

test('accepts only the owner’s exact release-bound result', () => {
 const receipt = {release:packageReferences.release_id, packageVerified:true, automaticRestart:false};
 assert.deepEqual(upgradePreflightObservation(receipt, packageReferences), receipt);
 for (const value of [null, {...receipt,release:'other'}, {...receipt,packageVerified:false},
  {...receipt,automaticRestart:true}, {...receipt,private:'fixture'}]) {
  assert.throws(() => upgradePreflightObservation(value, packageReferences), /unsupported or mismatched update preflight/);
 }
});

test('accepts only typed upgrade outcomes for the submitted manifest and keeps restart evidence scoped', () => {
 const current = {schema:'nodenetwork-software-upgrade-v1',outcome:'already_current',manifest_sha256:packageReferences.manifest_sha256,
  previous_manifest_sha256:null,vpn_restart_required:null};
 const prior = 'b'.repeat(64);
 const completed = {...current,outcome:'completed',previous_manifest_sha256:prior,vpn_restart_required:false};
 for (const value of [current,completed,{...completed,outcome:'resumed',vpn_restart_required:true}]) {
  assert.deepEqual(upgradeObservation(value,packageReferences),{outcome:value.outcome,manifest:value.manifest_sha256,
   previous:value.previous_manifest_sha256,vpnRestartRequired:value.vpn_restart_required});
 }
 for (const changed of [{...current,manifest_sha256:prior},{...current,vpn_restart_required:false},
  {...current,previous_manifest_sha256:prior},{...completed,previous_manifest_sha256:current.manifest_sha256},
  {...completed,previous_manifest_sha256:prior+'\n'},{...completed,vpn_restart_required:null},
  {...completed,outcome:'success'},{...completed,automatic_restart:false}]) {
  assert.throws(()=>upgradeObservation(changed,packageReferences),/Software upgrade outcome is uncertain/);
 }
});
