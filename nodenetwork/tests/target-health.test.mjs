import {strict as assert} from 'node:assert';
import test from 'node:test';
import {targetHealthObservation} from '../src/target-health.js';

const network = {id: 'network', state: 'running', health: 'degraded', readiness: 'pending'};
const storage = {id: 'storage', state: 'starting', health: 'healthy', readiness: 'blocked'};
const report = {schema_version: 1, services: [network, storage]};

test('keeps independent service lifecycle, health and readiness, including an empty snapshot', () => {
 assert.deepEqual(targetHealthObservation(report), [network, storage]);
 assert.deepEqual(targetHealthObservation({...report, services: []}), []);
});

test('rejects unprojected, unknown, duplicate or unbounded service evidence', () => {
 for (const [label, value] of Object.entries({
  version: {...report, schema_version: 2},
  id: {...report, request_id: 'private fixture'},
  control: {...report, services: [{...network, id: 'network\n'}]},
  duplicate: {...report, services: [network, network]},
  oversized: {...report, services: Array.from({length: 129}, (_, index) => ({...network, id: `service-${index}`}))},
  unknown: {...report, services: [{...network, state: 'active'}]},
  unprojected: {...report, services: [{...network, health: {degraded: {reason: 'private fixture'}}}]},
  unexpected: {...report, services: [{...network, detail: 'private fixture'}]},
 })) {
  assert.throws(() => targetHealthObservation(value), /unsupported service health evidence/i, label);
 }
});
