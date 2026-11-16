import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 filterSavedValidatorLogs, parseSavedValidatorLogs, readSavedValidatorLogs, reviewSavedValidatorLogs, savedValidatorLogLimit,
} from '../src/saved-validator-logs.js';

const schema = 'synergy.validator-operations.v1';
const collectedAt = '2026-11-15T13:00:00.123456789+00:00';
const validator = 'private-validator-label';
const entry = {sequence:0,observed_at_utc:collectedAt,severity:'ERROR',subsystem:'NETWORK',
 message:'/private/raw-log-message',redacted:false};
const masked = {...entry,sequence:1,severity:'WARN',subsystem:'STORAGE',message:'[REDACTED SENSITIVE LOG LINE]',redacted:true};
const logs = {schema_version:schema,validator_id:validator,generated_at_utc:collectedAt,entries:[entry,masked],truncated:false};
const snapshot = {schema_version:schema,snapshot_id:'aca5cab1-878d-4d07-ab96-bb1a19a4b7c2',
 captured_at_utc:'2026-11-15T13:01:00Z',validator_id:validator,
 status:{schema_version:schema,discovery:{validator_id:validator,hostname:'private-fixture-host'}},
 preflight:{schema_version:schema,validator_id:validator},logs};
const inspect = value => parseSavedValidatorLogs(JSON.stringify(value));

const required = ['genesis_hash','chain_id','network','release_id','release_tag','binary_sha256','core_revision',
 'synq_revision','aegis_revision','validator_config','key_binding','validator_registry','protected_pipeline_config',
 'etdag_roots','vpn_reachability','peer_readiness','storage','clock_sync'];

function fullSnapshot() {
 const raw = readFileSync(new URL('./fixtures/validator-operations-observation.json',import.meta.url),'utf8')
  .replaceAll('18446744073709551615','101').replaceAll('18446744073709551614','100');
 const {observed_at_utc,...observation} = JSON.parse(raw);
 observation.discovery.validator_id = validator;
 const checks = required.map(id=>({id,status:id==='storage' ? 'FAIL' : 'PASS',detail:'private fixture check detail'}));
 const status = {...observation,generated_at_utc:observed_at_utc,preflight:checks,
  health:{classification:'MISCONFIGURED',reasons:['private fixture reason']},
  liveness:{health:'MISCONFIGURED',height:101,finalized_height:100,
   first_missing_transition:{from:'POSY.QC',to:'POSY.FINALIZED',reason:'private fixture transition reason'}},
  release_consistency:{matches_expected:false,mismatch_fields:[{field:'core_revision',expected:'private expected revision',actual:observation.release.core_revision}]},
 };
 const preflight = {...snapshot.preflight,generated_at_utc:observed_at_utc,ready:false,required_check_ids:required,
  checks,blocking_check_ids:['release_consistency','storage']};
 return {...snapshot,status,preflight};
}

test('projects the two owner envelopes and freezes selected metadata without private fields', () => {
 const standalone = inspect(logs);
 assert.equal(standalone.capturedAt,null);
 assert.deepEqual(standalone.rows,[{sequence:'0',severity:'ERROR',subsystem:'NETWORK',ownerMarkedRedacted:false},
  {sequence:'1',severity:'WARN',subsystem:'STORAGE',ownerMarkedRedacted:true}]);
 const nested = inspect(snapshot);
 assert.equal(nested.capturedAt,snapshot.captured_at_utc);
 assert.equal(nested.collectedAt,collectedAt);
 const matches = filterSavedValidatorLogs(nested.rows,'WARN','STORAGE');
 const reviewed = reviewSavedValidatorLogs(nested,matches.map(row=>row.sequence),1000);
 assert.deepEqual(reviewed.rows,[standalone.rows[1]]);
 assert.equal(reviewed.sourceTruncated,false);
 assert.equal(reviewed.reviewedAt,'1970-01-01T00:00:01.000Z');
 for (const hidden of ['/private/raw-log-message',validator,'private-fixture-host',snapshot.snapshot_id]) {
  assert.ok(!JSON.stringify(reviewed).includes(hidden));
  assert.ok(!JSON.stringify(nested).includes(hidden));
 }
 assert.throws(()=>reviewSavedValidatorLogs(nested,['2']),/Select available log metadata/);
});

test('keeps exact u64 sequence and scoped truncation without inventing an event timestamp', () => {
 const high = {...logs,truncated:true,entries:[{...entry,sequence:'18446744073709551614'},{...masked,sequence:'18446744073709551615'}]};
 const raw = JSON.stringify(high).replace(/"(1844674407370955161[45])"/g,'$1');
 const observation = parseSavedValidatorLogs(raw);
 assert.deepEqual(observation.rows.map(row=>row.sequence),['18446744073709551614','18446744073709551615']);
 assert.equal(observation.truncated,true);
 assert.deepEqual(inspect({...logs,entries:[]}).rows,[]);
 assert.throws(()=>parseSavedValidatorLogs(raw.replace('18446744073709551615','18446744073709551616')),/not a supported/);
});

test('derives safe findings only from a consistent combined snapshot and keeps log-only fallback', () => {
 const fixture = fullSnapshot();
 const data = inspect(fixture);
 assert.equal(data.diagnostics.statusObservedAt,'2026-11-15T13:00:00Z');
 assert.equal(data.diagnostics.reportedHealth,'Misconfigured');
 assert.equal(data.diagnostics.headHeight,'101');
 assert.equal(data.diagnostics.finalizedHeight,'100');
 assert.equal(data.diagnostics.requiredChecks,18);
 assert.equal(data.diagnostics.passingChecks,17);
 assert.deepEqual(data.diagnostics.releaseFields,['core_revision']);
 assert.deepEqual(data.diagnostics.blocked.map(({check,status})=>[check,status]),[['Storage','Reported fail']]);
 assert.equal(data.diagnostics.missingTransition.to,'POSY.FINALIZED');
 assert.doesNotMatch(JSON.stringify(data),/private|expected revision|transition reason|fixture detail/);

 for (const makeInvalid of [
  value=>{value.preflight.generated_at_utc='2026-11-15T13:00:01Z';},
  value=>{value.preflight.blocking_check_ids.pop();},
  value=>{value.preflight.ready=true;},
  value=>{value.preflight.checks = value.preflight.checks.map(row=>row.id==='storage' ? {...row,status:'PASS'} : row);},
  value=>{value.status.liveness.first_missing_transition.to='POSY.UNREVIEWED';},
  value=>{value.status.liveness.height=102;},
  value=>{value.status.health.classification='HEALTHY'; value.status.liveness.health='HEALTHY';},
  value=>{value.status.release_consistency.mismatch_fields[0].actual='wrong reference';},
 ]) {
  const invalid = fullSnapshot();
  makeInvalid(invalid);
  const projected = inspect(invalid);
  assert.equal(projected.diagnostics,null);
  assert.deepEqual(projected.rows,data.rows);
 }
 assert.equal(inspect(snapshot).diagnostics,null);
 assert.equal(inspect(logs).diagnostics,null);
});

const ownerDiagnosticPath = process.env.SYNERGY_VALIDATOR_DIAGNOSTIC_OWNER_FIXTURE;
test('accepts a snapshot serialized by the pinned owner types and evaluators', {skip:!ownerDiagnosticPath}, () => {
 const {diagnostics,rows} = parseSavedValidatorLogs(readFileSync(ownerDiagnosticPath,'utf8'));
 assert.equal(diagnostics.requiredChecks,18);
 assert.deepEqual(diagnostics.releaseFields,['core_revision']);
 assert.deepEqual(diagnostics.blocked.map(row=>row.id),['storage']);
 assert.equal(rows.length,1);
});

test('refuses mismatched capture scope, malformed rows or ambiguous JSON', async () => {
 for (const value of [
  {...snapshot,logs:{...logs,validator_id:'different'}},
  {...snapshot,preflight:{...snapshot.preflight,validator_id:'different'}},
  {...logs,generated_at_utc:collectedAt+'\n'},
  {...logs,truncated:true},
  {...logs,entries:[{...entry,sequence:1}]},
  {...logs,entries:[{...entry,sequence:'0'}]},
  {...logs,entries:[entry,{...masked,sequence:2}]},
  {...logs,entries:[{...entry,observed_at_utc:snapshot.captured_at_utc}]},
  {...logs,entries:[{...entry,severity:'WARNING'}]},
  {...logs,entries:[{...entry,subsystem:'NODE'}]},
  {...logs,entries:[{...entry,redacted:true}]},
  {...logs,entries:Array.from({length:501},(_,sequence)=>({...entry,sequence}))},
  {...snapshot,logs:{...logs,entries:Array.from({length:201},(_,sequence)=>({...entry,sequence}))}},
 ]) assert.throws(()=>inspect(value),/not a supported/);
 assert.throws(()=>parseSavedValidatorLogs(JSON.stringify(logs).replace('"sequence":0','"sequence":0,"sequence":1')),/not a supported/);
 await assert.rejects(readSavedValidatorLogs({size:savedValidatorLogLimit+1,arrayBuffer:()=>assert.fail('oversized file was read')}),/at most 7 MiB/);
 await assert.rejects(readSavedValidatorLogs(new Blob([new Uint8Array([255])])),/could not be read as UTF-8/);
});
