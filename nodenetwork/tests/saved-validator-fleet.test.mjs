import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSavedValidatorFleet,readSavedValidatorFleet,savedFleetLimit} from '../src/saved-validator-fleet.js';
import {savedValidatorFleetFixture} from './fixtures/saved-validator-fleet.mjs';

const inspect = value => parseSavedValidatorFleet(JSON.stringify(value));
const unsupported = /not a supported saved Validator Operations cluster status/;

test('reports exact fleet heights, removes private fields and checks derived summary flags',()=>{
 const result = inspect(savedValidatorFleetFixture());
 assert.equal(result.commonHead,'101');
 assert.equal(result.commonFinalized,'100');
 assert.equal(result.returnedQuorum,true);
 assert.equal(result.reportedDivergence,false);
 assert.equal(result.sharedChain.incarnation,'fixture-incarnation');
 assert.deepEqual(result.rows.map(({health})=>health),['HEALTHY','HEALTHY']);
 assert.doesNotMatch(JSON.stringify(result),/fixture-hostname|192\.0\.2\.2|private-path|excluded operator reason|fixture-validator-key/);

 const high = savedValidatorFleetFixture();
 high.common_head_height = '18446744073709551615';
 for (const status of high.validators) {
  status.chain.head_height = high.common_head_height;
  status.chain.sync_target_height = high.common_head_height;
 }
 assert.equal(parseSavedValidatorFleet(JSON.stringify(high).replaceAll('"18446744073709551615"','18446744073709551615')).commonHead,
  '18446744073709551615');

 for (const mutate of [
  value=>{value.common_head_height=102;}, value=>{value.quorum_available=false;}, value=>{value.divergence_detected=true;},
  value=>{value.generated_at_utc='2026-11-15T13:00:01Z';}, value=>{value.validators.reverse();},
  value=>{value.unavailable_validator_ids=[value.validators[0].discovery.validator_id];},
  value=>{value.validators[0].health.classification='OFFLINE';value.validators[0].liveness.health='OFFLINE';},
 ]) {
  const malformed = savedValidatorFleetFixture();
  mutate(malformed);
  assert.throws(()=>inspect(malformed),unsupported);
 }
});

test('reconciles the owner release differences and keeps unavailable or mixed scope independent',()=>{
 const changed = savedValidatorFleetFixture();
 changed.validators[1].release.core_revision='different-core';
 const id = changed.validators[1].discovery.validator_id;
 changed.release_consistency = {...changed.release_consistency,consistent:false,
  mismatched_validator_ids:[id],mismatched_fields_by_validator:{[id]:['core_revision']}};
 changed.divergence_detected = true;
 changed.validators.forEach(status=>{status.health.classification='RELEASE_MISMATCH';status.liveness.health='RELEASE_MISMATCH';});
 const result = inspect(changed);
 assert.equal(result.reportedDivergence,true);
 assert.equal(result.rows[1].health,'RELEASE_MISMATCH');
 assert.deepEqual(result.rows[1].releaseDifferences,['core_revision']);
 changed.release_consistency.mismatched_fields_by_validator[id]=['protocol_version'];
 assert.throws(()=>inspect(changed),unsupported);

 const partial = savedValidatorFleetFixture();
 partial.unavailable_validator_ids = ['operator-validator-c'];
 delete partial.common_head_height;
 delete partial.common_finalized_height;
 partial.divergence_detected = true;
 const observed = inspect(partial);
 assert.equal(observed.commonHead,null);
 assert.equal(observed.returnedQuorum,true);
 assert.deepEqual(observed.unavailable,['operator-validator-c']);

 partial.validators[1].discovery.incarnation = 'another-incarnation';
 const mixed = inspect(partial);
 assert.equal(mixed.sharedChain,null);
 assert.equal(mixed.commonFinalized,null);
 assert.equal(mixed.returnedQuorum,null);
 assert.equal(mixed.reportedDivergence,null);
 assert.equal(mixed.rows.length,2);
});

test('distinguishes all unavailable from unsupported input and bounds reads before dispatch',async()=>{
 const value = {schema_version:'synergy.validator-operations.v1',generated_at_utc:'',validators:[],unavailable_validator_ids:['offline-a'],
  release_consistency:{consistent:false,mismatched_validator_ids:[],mismatched_fields_by_validator:{}},quorum_available:false,divergence_detected:true};
 assert.deepEqual(inspect(value),{reportedAt:null,unavailable:['offline-a'],sharedChain:null,commonHead:null,commonFinalized:null,
  returnedQuorum:null,reportedDivergence:null,rows:[]});
 const oversized = {size:savedFleetLimit+1,arrayBuffer:()=>assert.fail('oversized capture must not be opened')};
 await assert.rejects(readSavedValidatorFleet(oversized),/at most 4 MiB/);
 const retired = {size:1,arrayBuffer:()=>assert.fail('retired capture must not be opened')};
 assert.equal(await readSavedValidatorFleet(retired,()=>false),null);
 await assert.rejects(readSavedValidatorFleet(new Blob([new Uint8Array([255])])),/as UTF-8/);
 assert.throws(()=>parseSavedValidatorFleet(JSON.stringify(value).replace('"validators":[]','"validators":[],"validators":[]')),unsupported);
});

const ownerFleetFixture = process.env.SYNERGY_VALIDATOR_FLEET_OWNER_FIXTURE;
test('accepts the pinned owner aggregate serializer on the five-validator fixture',{skip:!ownerFleetFixture},()=>{
 const report = parseSavedValidatorFleet(readFileSync(ownerFleetFixture,'utf8'));
 assert.equal(report.rows.length,5);
 assert.equal(report.unavailable.length,1);
 assert.equal(report.commonHead,null);
 assert.equal(report.reportedDivergence,true);
 assert.ok(report.rows.some(row=>row.releaseDifferences.includes('binary_sha256')));
});
