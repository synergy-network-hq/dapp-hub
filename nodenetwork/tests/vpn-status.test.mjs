import assert from 'node:assert/strict';
import test from 'node:test';
import {installedControllerRead,targetControllerObservation} from '../src/target-observation.js';
import {vpnEnrollmentBlocker,vpnEnrollmentObservation,vpnEnrollmentSupported,vpnPrerequisiteStatus,vpnStatusObservation} from '../src/vpn-status.js';
import {parseRequestHistory,requestStatusLabel} from '../src/request-history.js';

const operation = {operation:'vpn_status',kind:'read',available:true};
const controller = {root:'/opt/synergy',controllerVersion:1,installed:true,operations:[operation]};
const status = {
 schema:'nodenetwork-vpn-status-v1', service_registered:true, enrollment_staged:false, enrollment_recorded:true,
 reconciliation_required:false, server_bound:false, connected:true, overlay_address:'100.80.10.4/16',
};
const vpnStatusGate = controller => installedControllerRead(controller, 'vpn_status');

test('requires an explicit single supported read on an installed lowercase-root controller', () => {
 assert.equal(vpnStatusGate(targetControllerObservation(controller)).available,true);
 for (const value of [{...controller,installed:false}, {...controller,controllerVersion:2}, {...controller,operations:[]},
  {...controller,operations:[operation,operation]}, {...controller,operations:[{...operation,kind:'mutation'}]},
  {...controller,operations:[{...operation,available:false}]},
 ]) assert.equal(vpnStatusGate(targetControllerObservation(value)).available,false);
 assert.equal(vpnStatusGate(undefined).available,false);
 assert.throws(()=>targetControllerObservation({...controller,root:'/opt/Synergy'}),/unsupported installation root/);
});

test('keeps reported connection, enrollment and binding independent and removes overlay metadata', () => {
 const projected = vpnStatusObservation({...status,raw:'unused fixture'});
 assert.deepEqual(projected, {
  service_registered:true,enrollment_staged:false,enrollment_recorded:true,reconciliation_required:false,server_bound:false,connected:true,
 });
 assert.equal(vpnStatusObservation({...status,enrollment_recorded:false,reconciliation_required:true,connected:false,overlay_address:null}).reconciliation_required,true);
 for (const value of [null, {...status,schema:'nodenetwork-vpn-status-v2'}, {...status,server_bound:undefined}, {...status,connected:1},
  {...status,reconciliation_required:true}, {...status,service_registered:false},
  {...status,enrollment_recorded:false}, {...status,enrollment_recorded:false,connected:false,server_bound:true}]) {
  assert.throws(()=>vpnStatusObservation(value),/unsupported VPN status/);
 }
});

test('derives the owner prerequisite and the first safe review step from each supported status', () => {
 const unrecorded = {...status,enrollment_recorded:false,connected:false,overlay_address:null};
 const review = value => vpnPrerequisiteStatus(vpnStatusObservation(value));
 assert.match(review({...unrecorded,service_registered:false,reconciliation_required:true}), /reconcile the prior attempt/);
 assert.match(review({...unrecorded,service_registered:false}), /registration of the contained VPN service/);
 assert.match(review(unrecorded), /stage an approved one-use enrollment input/);
 assert.match(review({...unrecorded,enrollment_staged:true}), /exact one-use host grant/);
 assert.match(review(status), /verify the recorded validator peer/);
 assert.match(review({...status,server_bound:true,connected:false}), /investigate connectivity for the bound validator peer/);
 assert.match(review({...status,server_bound:true}), /VPN prerequisites for validator start and restart are met/);
});

test('admits enrolled Linux controller mutation with independently reviewed staged status', () => {
 const enrollment = {operation:'vpn_enroll',kind:'mutation',available:true};
 const supported = {...controller,platform:'linux',architecture:'x86_64',localValidatorSupported:true,operations:[operation,enrollment]};
 assert.equal(vpnEnrollmentSupported(targetControllerObservation(supported)),true);
 for (const invalid of [{installed:false},{platform:'darwin'},{architecture:'aarch64'},{localValidatorSupported:false},
  {operations:[operation,enrollment,enrollment]},{operations:[operation,{...enrollment,kind:'read'}]},
  {operations:[operation,{...enrollment,available:false}]}, {controllerVersion:2}]) {
  assert.equal(vpnEnrollmentSupported(targetControllerObservation({...supported,...invalid})),false);
 }
 const staged = {...status,enrollment_staged:true,enrollment_recorded:false,connected:false,overlay_address:null};
 assert.equal(vpnEnrollmentBlocker(vpnStatusObservation(staged)),null);
 assert.match(vpnEnrollmentBlocker(undefined),/Read VPN status/);
 assert.match(vpnEnrollmentBlocker(vpnStatusObservation({...staged,reconciliation_required:true})),/Reconcile the previous/);
 assert.match(vpnEnrollmentBlocker(vpnStatusObservation(status)),/already reports a recorded/);
 assert.match(vpnEnrollmentBlocker(vpnStatusObservation({...staged,enrollment_staged:false})),/staged enrollment input/);
 assert.throws(()=>vpnEnrollmentObservation(staged),/outcome is uncertain/);
 assert.throws(()=>vpnEnrollmentObservation({...status,enrollment_staged:true}),/outcome is uncertain/);
 assert.equal(vpnEnrollmentObservation(status).server_bound,false);
});

test('reads VPN enrollment dispatches as uncertain local records without inferring a remote job', () => {
 const history = parseRequestHistory({schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,
  records:[{version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'vpn_enroll',
   recorded_at_ms:1,observed_at_ms:2,state:'uncertain',response_ok:null}]});
 assert.equal(requestStatusLabel(history.records[0]),'Outcome uncertain');
});
