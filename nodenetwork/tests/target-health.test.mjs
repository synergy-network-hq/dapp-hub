import {strict as assert} from 'node:assert';
import test from 'node:test';
import {nodeServiceActionObservation,nodeServiceRegistrationObservation,targetHealthObservation} from '../src/target-health.js';
import {installedControllerMutation,targetControllerObservation} from '../src/target-observation.js';
import {validatorStartupBlocker,vpnStatusObservation} from '../src/vpn-status.js';

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

test('requires installed controller mutation metadata and the five exact VPN prerequisites for startup', () => {
 const start = {operation:'start',kind:'mutation',available:true};
 const controller = {root:'/opt/Synergy',controllerVersion:1,installed:true,platform:'linux',architecture:'x86_64',
  localValidatorSupported:true,operations:[start]};
 assert.equal(installedControllerMutation(targetControllerObservation(controller),'start').available,true);
 for (const change of [{installed:false},{operations:[start,start]},{architecture:'arm64'},
  {operations:[{...start,kind:'read'}]},{operations:[{...start,available:false}]}]) {
  assert.equal(installedControllerMutation(targetControllerObservation({...controller,...change}),'start').available,false);
 }
 const vpn = vpnStatusObservation({schema:'nodenetwork-vpn-status-v1',service_registered:true,enrollment_staged:false,
  enrollment_recorded:true,reconciliation_required:false,server_bound:true,connected:true});
 assert.equal(validatorStartupBlocker(vpn),null);
 assert.match(validatorStartupBlocker(null),/Read VPN status/);
 for (const key of ['service_registered','enrollment_recorded','reconciliation_required','server_bound','connected']) {
  assert.match(validatorStartupBlocker({...vpn,[key]:!vpn[key]}),/Resolve the reported/);
  assert.match(validatorStartupBlocker({...vpn,[key]:undefined}),/Resolve the reported/);
 }
});

test('admits an exact service acknowledgement without health, progress or activation fields', () => {
 for (const requested of ['start','restart','stop']) {
  const acknowledged = {requested,healthNotInferred:true};
  assert.deepEqual(nodeServiceActionObservation(requested,acknowledged),acknowledged);
  for (const invalid of [{...acknowledged,requested:'other'},{...acknowledged,healthNotInferred:false},
   {...acknowledged,healthy:true},{requested}]) {
   assert.throws(()=>nodeServiceActionObservation(requested,invalid),/outcome is uncertain/);
  }
 }
});

test('projects only the owned registration inventory and never promotes it to health or startup', () => {
 const receipt = {schema:'nodenetwork-service-registration-v1',services:['node','vpn'],services_started:false,boot_enabled:false};
 assert.deepEqual(nodeServiceRegistrationObservation(receipt),{services:['node','vpn']});
 const relay = ['node','vpn','canary-rpc-relay'];
 assert.deepEqual(nodeServiceRegistrationObservation({...receipt,services:relay}),{services:relay});
 for (const value of [{...receipt,services:['vpn','node']},{...receipt,services:['node','vpn','vpn']},
  {...receipt,services:['node','vpn','/etc/systemd/foreign.service']},{...receipt,services:['node']},
  {...receipt,services_started:true},{...receipt,boot_enabled:true},{...receipt,connected:true}]) {
  assert.throws(()=>nodeServiceRegistrationObservation(value),/Service registration outcome is uncertain/);
 }
});
