import assert from 'node:assert/strict';
import test from 'node:test';
import {installedControllerRead,targetControllerObservation} from '../src/target-observation.js';
import {vpnPrerequisiteStatus,vpnStatusObservation} from '../src/vpn-status.js';

const operation = {operation:'vpn_status',kind:'read',available:true};
const controller = {root:'/opt/Synergy',controllerVersion:1,installed:true,operations:[operation]};
const status = {
 schema:'nodenetwork-vpn-status-v1', service_registered:true, enrollment_staged:false, enrollment_recorded:true,
 reconciliation_required:false, server_bound:false, connected:true, overlay_address:'100.80.10.4/16',
};
const vpnStatusGate = controller => installedControllerRead(controller, 'vpn_status');

test('requires an explicit single supported read on an installed uppercase-root controller', () => {
 assert.equal(vpnStatusGate(targetControllerObservation(controller)).available,true);
 for (const value of [{...controller,installed:false}, {...controller,controllerVersion:2}, {...controller,operations:[]},
  {...controller,operations:[operation,operation]}, {...controller,operations:[{...operation,kind:'mutation'}]},
  {...controller,operations:[{...operation,available:false}]},
 ]) assert.equal(vpnStatusGate(targetControllerObservation(value)).available,false);
 assert.equal(vpnStatusGate(undefined).available,false);
 assert.throws(()=>targetControllerObservation({...controller,root:'/opt/synergy'}),/unsupported installation root/);
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
