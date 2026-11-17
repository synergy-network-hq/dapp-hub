import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fleetTargets,addFleetTarget} from '../src/fleet-readiness.js';
const target={kind:'remote',host:'approved.example',port:22,root:'/opt/synergy'};
test('saved fleet selections are bounded public targets, never readiness authority',()=>{
 const five=Array.from({length:5},(_,i)=>({...target,host:`host-${i}`}));
 assert.deepEqual(fleetTargets(five),five.map(({port,...t})=>t));assert.throws(()=>addFleetTarget(five,target),/at most five/);
 assert.throws(()=>fleetTargets([target,target]),/exactly once/);assert.throws(()=>fleetTargets({...target,ready:true}),/at most five/);
 assert.throws(()=>fleetTargets([{...target,root:'/tmp/escape'}]),/root/);
});
test('native fleet IPC forbids renderer observations, serializes, and never retries uncertain stages',async()=>{
 let calls=[],reply=null,finish;
 globalThis.__nnFleet={native:true,invoke:async(...args)=>{calls.push(args);if(reply instanceof Error)throw reply;return typeof reply==='function'?reply():reply;}};
 try{
 const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnFleet.native;const invoke=(...args)=>globalThis.__nnFleet.invoke(...args);');
 const {nodeNetworkFleetReadiness:invoke,nodeNetworkVpn}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const five=Array.from({length:5},(_,i)=>({...target,host:`host-${i}`}));
 assert.equal(await invoke(target,'collect',five),null);assert.deepEqual(calls[0],['portal_nodenetwork_fleet_readiness',{target,operation:'collect',targets:five,reviewSha256:null}]);
 await assert.rejects(invoke(target,'collect',five.slice(1)),/bounded/);await assert.rejects(invoke(target,'stage',five,'a'.repeat(64)),/bounded/);await assert.rejects(invoke(target,'reconcile',null,'a'.repeat(64)),/bounded/);assert.equal(calls.length,1);
 reply={schema:'nodenetwork-native-fleet-readiness-v1',review_sha256:'a'.repeat(64),runtime_participation_verified:false,finality_verified:true};await assert.rejects(invoke(target,'collect',five),/Unsupported native/);
 reply=()=>new Promise(resolve=>{finish=resolve;});const pending=invoke(target,'stage',null,'a'.repeat(64));await assert.rejects(nodeNetworkVpn(target,'enroll'),/still pending/);finish(null);await pending;
 reply=Error('uncertain original stage');const before=calls.length;await assert.rejects(invoke(target,'stage',null,'a'.repeat(64)),/uncertain/);assert.equal(calls.length,before+1);
 reply={schema:'nodenetwork-native-fleet-readiness-reconciled-v1',pending:false,original_stage_verified:true,review_sha256:'b'.repeat(64),freshness_verified:false,commissioned:false};assert.deepEqual(await invoke(target,'reconcile'),reply);
 reply={...reply,freshness_verified:true};await assert.rejects(invoke(target,'reconcile'),/Unsupported native/);
 globalThis.__nnFleet.native=false;await assert.rejects(invoke(target,'collect',five),/native Portal/);
 }finally{delete globalThis.__nnFleet;}
});
