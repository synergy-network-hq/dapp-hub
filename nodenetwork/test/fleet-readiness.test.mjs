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
 const {nodeNetworkFleetReadiness:invoke,nodeNetworkVpn}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(`../src/${path.slice(2)}`,import.meta.url).href}${quote}`)).toString('base64')}`);
 const five=Array.from({length:5},(_,i)=>({...target,host:`host-${i}`}));
 assert.equal(await invoke(target,'collect',five),null);assert.deepEqual(calls[0],['portal_nodenetwork_fleet_readiness',{target,operation:'collect',targets:five,reviewSha256:null}]);
 await assert.rejects(invoke(target,'collect',five.slice(2)),/bounded/);await assert.rejects(invoke(target,'stage',five,'a'.repeat(64)),/bounded/);await assert.rejects(invoke(target,'reconcile',null,'a'.repeat(64)),/bounded/);assert.equal(calls.length,1);
 reply={schema:'nodenetwork-native-fleet-readiness-v2',review_sha256:'a'.repeat(64),runtime_participation_verified:false,finality_verified:true};await assert.rejects(invoke(target,'collect',five),/Unsupported native/);
 const online=['a','b','c','d'];const valid={schema:'nodenetwork-native-fleet-readiness-v2',review_sha256:'a'.repeat(64),online_addresses:online,excluded_addresses:['e'],observations:online.map(address=>({address,online_addresses:online,observation_kind:'prestart_vpn'})),scope:'commissioning_and_prestart_vpn_only',runtime_participation_verified:false,finality_verified:false};reply=valid;assert.deepEqual(await invoke(target,'collect',five.slice(1)),valid);
 for(const altered of [{...valid,excluded_addresses:[]},{...valid,excluded_addresses:['a']},{...valid,online_addresses:['a','b','c','e']},{...valid,observations:valid.observations.map(v=>({...v,observation_kind:'metadata_only'}))},{...valid,finality_verified:true}]){reply=altered;await assert.rejects(invoke(target,'collect',five.slice(1)),/Unsupported native/);}
 reply=()=>new Promise(resolve=>{finish=resolve;});const pending=invoke(target,'stage',null,'a'.repeat(64));await assert.rejects(nodeNetworkVpn(target,'enroll'),/still pending/);finish(null);await pending;
 reply=Error('uncertain original stage');const before=calls.length;await assert.rejects(invoke(target,'stage',null,'a'.repeat(64)),/uncertain/);assert.equal(calls.length,before+1);
 reply={schema:'nodenetwork-native-fleet-readiness-reconciled-v1',pending:false,original_stage_verified:true,review_sha256:'b'.repeat(64),freshness_verified:false,commissioned:false};assert.deepEqual(await invoke(target,'reconcile'),reply);
 reply={...reply,freshness_verified:true};await assert.rejects(invoke(target,'reconcile'),/Unsupported native/);
 const notApplied={schema:'nodenetwork-native-readiness-not-applied-v1',not_applied:true,readiness_staged:false,dispatch_sha256:'c'.repeat(64),authorization_sha256:'d'.repeat(64),automatic_retry:false};reply=notApplied;assert.deepEqual(await invoke(target,'verify_not_applied'),notApplied);
 for(const changed of [{...notApplied,readiness_staged:true},{...notApplied,automatic_retry:true},{...notApplied,not_applied:false},{...notApplied,authorization_sha256:'foreign'},{...notApplied,private_key:'secret'}]){reply=changed;await assert.rejects(invoke(target,'verify_not_applied'),/Unsupported readiness nonapplication/);}
 await assert.rejects(invoke(target,'verify_not_applied',five),/bounded/);await assert.rejects(invoke(target,'verify_not_applied',null,'a'.repeat(64)),/bounded/);
 reply=null;assert.equal(await invoke(target,'verify_not_applied'),null);
 const commissionNotApplied={schema:'nodenetwork-native-commission-not-applied-v1',not_applied:true,commissioned:false,record_id:'e'.repeat(64),request_sha256:'f'.repeat(64),readiness_sha256:'a'.repeat(64),automatic_retry:false};reply=commissionNotApplied;assert.deepEqual(await invoke(target,'verify_commission_not_applied'),commissionNotApplied);
 for(const changed of [{...commissionNotApplied,commissioned:true},{...commissionNotApplied,automatic_retry:true},{...commissionNotApplied,not_applied:false},{...commissionNotApplied,record_id:'foreign'},{...commissionNotApplied,private_key:'secret'}]){reply=changed;await assert.rejects(invoke(target,'verify_commission_not_applied'),/Unsupported commission nonapplication/);}
 await assert.rejects(invoke(target,'verify_commission_not_applied',five),/bounded/);await assert.rejects(invoke(target,'verify_commission_not_applied',null,'a'.repeat(64)),/bounded/);reply=null;assert.equal(await invoke(target,'verify_commission_not_applied'),null);
 globalThis.__nnFleet.native=false;await assert.rejects(invoke(target,'collect',five),/native Portal/);
 }finally{delete globalThis.__nnFleet;}
});

test('selection UI allows explicit exclusion without membership removal or consensus claims',async()=>{const source=await readFile(new URL('../src/FleetReadiness.jsx',import.meta.url),'utf8');assert.match(source,/targets.length<4/);assert.match(source,/targets.filter/);assert.match(source,/Excluded roster members remain unobserved/);assert.doesNotMatch(source,/all twenty|exact five controllers/);});
