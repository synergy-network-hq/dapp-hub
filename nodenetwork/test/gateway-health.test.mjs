import {test} from 'node:test';import assert from 'node:assert/strict';
import {gatewayHealthObservation,targetHealthObservation,nodeServiceRegistrationObservation,serviceActionLabel} from '../src/target-health.js';
const health=()=>({schema:'nodenetwork-gateway-health-v1',observed_at_ms:1795070000000,role:'rpc_gateway',relay:{unit:'synergy-canary-rpc-relay.service',state:'inactive',pid:0},vpn:{registered:true,enrollment_recorded:true,server_bound:true,connected:false},admission_custody_verified:true,consensus_participant:false,configured_loopback:true,production_qualified:false});
test('gateway health preserves actual relay/VPN observations without consensus or listener claims',()=>{
 const v=health();assert.deepEqual(targetHealthObservation(v),v);assert.equal(gatewayHealthObservation({...v,vpn:{...v.vpn,connected:true,server_bound:false}}).vpn.server_bound,false);assert.equal(gatewayHealthObservation({...v,relay:{...v.relay,state:'unregistered',pid:null}}).relay.state,'unregistered');
 for(const bad of [{...v,role:'validator'},{...v,extra:true},{...v,consensus_participant:true},{...v,production_qualified:true},{...v,configured_loopback:false},{...v,observed_at_ms:Number.MAX_SAFE_INTEGER+1},{...v,relay:{...v.relay,unit:'synergy-node.service'}},{...v,relay:{...v.relay,pid:-1}},{...v,vpn:{...v.vpn,connected:'true'}}])assert.throws(()=>gatewayHealthObservation(bad));
});
test('native registration projection and legacy validator reports remain exact without activation inference',()=>{
 for(const services of [['node','vpn'],['node','vpn','canary-rpc-relay']])assert.deepEqual(nodeServiceRegistrationObservation({schema:'nodenetwork-service-registration-v1',services,services_started:false,boot_enabled:false}),{services});
 assert.deepEqual(nodeServiceRegistrationObservation({registered:['/etc/systemd/system/synergy-node.service','/etc/systemd/system/synergy-vpn.service'],services_started:false,boot_enabled:false}),{services:['node','vpn']});
 for(const bad of [{schema:'nodenetwork-service-registration-v1',services:['relay'],services_started:false,boot_enabled:false},{schema:'nodenetwork-service-registration-v1',services:['node','vpn'],services_started:true,boot_enabled:false}])assert.throws(()=>nodeServiceRegistrationObservation(bad));
 assert.deepEqual(targetHealthObservation({schema_version:1,services:[{id:'network',state:'running',health:'healthy',readiness:'ready'}]}),[{id:'network',state:'running',health:'healthy',readiness:'ready'}]);
});
test('service labels use authenticated observed role and unknown older controllers stay generic',()=>{
 assert.equal(serviceActionLabel('start',{installed_role:'rpc_gateway'}),'Start gateway relay');assert.equal(serviceActionLabel('stop',{installed_role:'validator'}),'Stop validator');assert.equal(serviceActionLabel('restart',{}),'Restart selected service');assert.equal(serviceActionLabel('start',{role:'rpc_gateway'}),'Start selected service');
});
