import assert from 'node:assert/strict';
import test from 'node:test';
import {serviceRegistrationAttribution, targetDiagnosticsObservation} from '../src/target-diagnostics.js';

const fixture = {
 schema: 'nodenetwork-diagnostics-v1', observed_at_ms: 1763010000000,
 services: {node: {state: 'active', restarts: 0, memory_bytes: Number.MAX_SAFE_INTEGER, cpu_usage_ns: null}, vpn: null},
 storage: {capacity_bytes: Number.MAX_SAFE_INTEGER, available_bytes: 0},
 log: {available: true, size_bytes: 70_000, window_bytes: 65_536, complete_lines: 2,
  severity: {error: 0, warn: 1, info: 1, debug: 0, trace: 0, unclassified: 0}},
};

test('keeps null, zero and exact counters separate in the native projection', () => {
 const value = targetDiagnosticsObservation(fixture);
 assert.equal(value.observedAt, fixture.observed_at_ms);
 assert.deepEqual(value.services, {node: {...fixture.services.node, state: 'Active'}, vpn: null});
 assert.deepEqual(value.storage, fixture.storage);
 assert.deepEqual(value.log, fixture.log);
 const unavailable = targetDiagnosticsObservation({...fixture, log: {
  available: false, size_bytes: null, window_bytes: 0, complete_lines: 0,
  severity: {...fixture.log.severity, warn: 0, info: 0},
 }});
 assert.equal(unavailable.log.available, false);
 assert.equal(unavailable.log.size_bytes, null);
});

test('refuses unknown fields, raw source content and contradictory counters', () => {
 for (const input of [
  {...fixture, installation: {node_name: 'private'}},
  {...fixture, services: {...fixture.services, node: {...fixture.services.node, pid: 23}}},
  {...fixture, services: {...fixture.services, node: {...fixture.services.node, state: ['active']}}},
  {...fixture, storage: {capacity_bytes: 1, available_bytes: 2}},
  {...fixture, observed_at_ms: Number.MAX_SAFE_INTEGER},
  {...fixture, log: {...fixture.log, complete_lines: 1}},
  {...fixture, log: {...fixture.log, available: false}},
  {...fixture, log: {...fixture.log, window_bytes: 65_537}},
  {...fixture, log: {...fixture.log, events: ['private log fixture']}},
 ]) {
  assert.throws(() => targetDiagnosticsObservation(input), /unsupported target diagnostics/);
 }
});

test('classifies current registration attribution without treating missing or partial evidence as a result for the prior dispatch', () => {
 const observe = services => serviceRegistrationAttribution(targetDiagnosticsObservation({...fixture, services}));
 assert.deepEqual(observe({node:fixture.services.node, vpn:{...fixture.services.node,state:null}}), {
  summary:'The controller attributed both Node and VPN services.', node:'Active', vpn:'Not reported',
 });
 assert.deepEqual(observe(fixture.services), {
  summary:'The controller returned partial service attribution. The observation is inconclusive.', node:'Active', vpn:'No attribution reported',
 });
 assert.deepEqual(observe({node:null,vpn:null}), {
  summary:'The controller reported no attributed Node or VPN service.', node:'No attribution reported', vpn:'No attribution reported',
 });
});
