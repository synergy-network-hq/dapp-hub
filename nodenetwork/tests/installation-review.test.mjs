import assert from 'node:assert/strict';
import test from 'node:test';
import {createInstallationReview, installationReviewMatches, readInstallationReview, saveInstallationReview} from '../src/installation-review.js';

const form = {release_id:'fixture-release',manifest_sha256:'a'.repeat(64),network_id:'fixture-chain',chain_id:'1266',node_name:'fixture-validator'};

function storage(initial = null) {
 let raw = initial;
 return {
  writes: 0,
  getItem() {return raw;},
  setItem(_key, value) {raw = value; this.writes++;}
 };
}

test('captures a validated non-executable installation reference and detects draft drift', () => {
 const record = createInstallationReview({...form,host:'ignored fixture',operation:'ignored fixture'}, 1000);
 assert.deepEqual(record, {
  version:1,kind:'nodenetwork-installation-draft-review',scope:'local-draft',installationRoot:'/opt/synergy',
  reviewedAt:'1970-01-01T00:00:01.000Z',parameters:{...form,chain_id:1266},
 });
 assert.equal(installationReviewMatches(record, form), true);
 assert.equal(installationReviewMatches(record, {...form,network_id:'another-chain'}), false);
 assert.equal(installationReviewMatches(record, {...form,chain_id:'1267'}), false);
 assert.equal(installationReviewMatches(record, {...form,chain_id:''}), false);
 assert.throws(()=>createInstallationReview({...form,node_name:'invalid/path'}));
});

test('returns the saved review after reread and refuses stale replacement', () => {
 const device = storage();
 const before = readInstallationReview(device);
 assert.equal(before.record, null);
 const record = createInstallationReview(form, 1000);
 const saved = saveInstallationReview(record, before.raw, device);
 assert.deepEqual(readInstallationReview(device), saved);
 const later = createInstallationReview({...form,node_name:'other-fixture'}, 2000);
 assert.throws(()=>saveInstallationReview(later, before.raw, device), /saved review changed/);
 assert.equal(device.writes,1);
 assert.deepEqual(readInstallationReview(device).record, record);
});

test('retains unreadable, unsupported or oversized data without repair writes', () => {
 const record = createInstallationReview(form, 1000);
 for (const raw of [
  '{broken',
  JSON.stringify({...record,installationRoot:'/opt/Synergy'}),
  'x'.repeat(4097),
  JSON.stringify({...record,scope:'signed-plan'}),
  JSON.stringify({...record,operation:'install'}),
  JSON.stringify({...record,parameters:{...record.parameters,chain_id:'1266'}}),
 ]) {
  const device = storage(raw);
  assert.throws(()=>readInstallationReview(device), /original record is retained/);
  assert.throws(()=>saveInstallationReview(record,raw,device), /original record is retained/);
  assert.equal(device.writes,0);
  assert.equal(device.getItem(),raw);
 }
});

test('a failed write leaves the saved record intact', () => {
 const first = createInstallationReview(form, 1000);
 const raw = JSON.stringify(first);
 const device = storage(raw);
 device.setItem = () => {throw Error('synthetic storage failure');};
 assert.throws(()=>saveInstallationReview(createInstallationReview(form,2000),raw,device), /previous record and current draft are retained/);
 assert.deepEqual(readInstallationReview(device).record,first);
});
