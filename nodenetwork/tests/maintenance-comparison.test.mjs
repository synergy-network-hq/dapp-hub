import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareMaintenanceObservations, readMaintenanceObservationFile} from '../src/validator-operations-observation.js';

const fixture = readFileSync(new URL('./fixtures/validator-operations-observation.json', import.meta.url), 'utf-8');
const time = '2026-11-15T13:00:00Z';
const laterTime = '2026-11-15T13:00:00.000000001+00:00';
const read = raw => readMaintenanceObservationFile(new Blob([raw]));
const later = fixture.replace(time, laterTime);

test('compares captured release values on the same reported scope without exposing binding details', async () => {
 const baseline = await read(fixture);
 const newer = await read(later.replace('fixture-release', 'next-release').replace('fixture-config', 'next-config').replace('"state":"ACTIVE"','"state":"ACTIVATING"'));
 const result = compareMaintenanceObservations(baseline, newer);
 assert.equal(result.before.observedAt, time);
 assert.equal(result.after.observedAt, laterTime);
 assert.equal(result.before.headHeight, '18446744073709551615');
 assert.equal(result.after.finalizedHeight, '18446744073709551614');
 assert.equal(result.after.serviceState, 'ACTIVATING');
 assert.deepEqual(result.changes, [
  {id:'release_id', field:'release id', before:'fixture-release', after:'next-release'},
  {id:'validator_config_version', field:'validator config version', before:'fixture-config', after:'next-config'},
 ]);
 assert.deepEqual(compareMaintenanceObservations(baseline, await read(later)).changes, []);
 for (const omitted of ['fixture-hostname', 'fixture-validator-key', 'fixture-consensus-key', 'fixture-ingress-key', '/fixture/private-path']) {
  assert.ok(!JSON.stringify(result).includes(omitted));
 }
});

test('refuses cross-validator, chain, genesis or key binding comparisons', async () => {
 const baseline = await read(fixture);
 for (const [key, current, edited] of [
  ['validator_id','fixture-validator','different-validator'],
  ['chain_id','1266','99999'],
  ['network','fixture-network','different-network'],
  ['incarnation','fixture-incarnation','different-incarnation'],
  ['genesis_hash','fixture-genesis','another-genesis'],
  ['validator_public_key_fingerprint','fixture-validator-key','different-validator-key'],
  ['consensus_public_key_fingerprint','fixture-consensus-key','different-consensus-key'],
  ['ingress_public_key_fingerprint','fixture-ingress-key','different-ingress-key'],
  ['key_binding_status','BOUND','UNKNOWN'],
 ]) {
  const different = await read(later.replace(`"${key}": "${current}"`, `"${key}": "${edited}"`));
  assert.throws(()=>compareMaintenanceObservations(baseline, different), /different validator, chain or public key binding contexts/);
 }
 await assert.rejects(read(fixture.replace('fixture-validator-key','')), /lacks usable validator identity/);
});

test('requires valid UTC capture times and strict order with exact fractional precision', async () => {
 const first = await read(fixture);
 const next = await read(later);
 const same = await read(fixture.replace(time,'2026-11-15T13:00:00.0+00:00'));
 assert.throws(()=>compareMaintenanceObservations(first, same), /earlier capture/);
 assert.throws(()=>compareMaintenanceObservations(next, first), /earlier capture/);
 for (const invalid of ['not-a-date','2026-02-31T13:00:00Z','2026-11-15T13:00:00.0000000001Z','2026-11-15T13:00:00+03:00']) {
  await assert.rejects(read(fixture.replace(time,invalid)), /supported UTC capture time/);
 }
});
