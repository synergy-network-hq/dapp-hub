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
 const controller = {root:'/opt/synergy',controllerVersion:1,installed:true,platform:'linux',architecture:'x86_64',
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

test('projects only the current exact owned OS registration inventory without inferring startup', () => {
 const registered=['/etc/systemd/system/synergy-node.service','/etc/systemd/system/synergy-vpn.service'];
 const receipt={registered,services_started:false,boot_enabled:false};
 assert.deepEqual(nodeServiceRegistrationObservation(receipt),{services:['node','vpn']});
 assert.deepEqual(nodeServiceRegistrationObservation({schema:'nodenetwork-service-registration-v1',
  services:['node','vpn'],services_started:false,boot_enabled:false}),{services:['node','vpn']});
 assert.deepEqual(nodeServiceRegistrationObservation({...receipt,registered:[...registered,'/etc/systemd/system/synergy-canary-rpc-relay.service']}),{services:['node','vpn','canary-rpc-relay']});
 for(const value of [{...receipt,registered:[...registered].reverse()},{...receipt,registered:[...registered,registered[0]]},
  {...receipt,registered:[...registered,'/etc/systemd/system/foreign.service']},{...receipt,registered:registered.slice(0,1)},
  {...receipt,services_started:true},{...receipt,boot_enabled:true},{...receipt,connected:true},
  {schema:'nodenetwork-service-registration-v1',services:['vpn','node'],services_started:false,boot_enabled:false}])
  assert.throws(()=>nodeServiceRegistrationObservation(value),/Service registration outcome is uncertain/);
});


test('service health never adopts a roster-five online-four quorum or candidate cluster claim', () => {
 // Five running service records are not five validators or four connected peers.
 const services=Array.from({length:5},(_,index)=>({...network,id:`service-${index}`}));
 const health={schema_version:1,services};
 assert.deepEqual(targetHealthObservation(health),services);
 for(const claims of [
  {validator_count:5,online_peer_count:4},
  {roster_count:5,quorum_required:4},
  {online_peer_count:4,quorum_required:3},
  {cluster_count:2,cluster_id:0},
  {consensus:{roster_count:5,online_peer_count:4,quorum_available:true}},
 ]) assert.throws(()=>targetHealthObservation({...health,...claims}),/unsupported service health evidence/);
 for(const claims of [{validator_count:5},{online_peer_count:4},{quorum_available:true},{cluster_id:0}])
  assert.throws(()=>targetHealthObservation({...health,services:[{...network,...claims}]}),/unsupported service health evidence/);
 // An empty observation remains an empty service list, never a zero-member roster.
 assert.deepEqual(targetHealthObservation({schema_version:1,services:[]}),[]);
});
