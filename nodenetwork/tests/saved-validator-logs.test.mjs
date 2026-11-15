import assert from 'node:assert/strict';
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
