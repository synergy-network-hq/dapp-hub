import {test} from 'node:test';
import assert from 'node:assert/strict';
import {treasuryPhase,treasurySendError} from '../src/treasury-send.js';
const fixture=()=>({schema:'nodenetwork-treasury-send-phase-v1',request_sha256:'a'.repeat(64),nonce:0,authorization_sha256:'b'.repeat(64),grant_state:'exact',audit_state:'not_consumed',reservation:'absent',files:{request:null,prepared:null,admission:null,dispatch:null},request_matches:null,mutation_performed:false});
test('phase remains read-only unverified inventory including interrupted empty reservations',()=>{
 const v=fixture();assert.equal(treasuryPhase(v),v);
 v.reservation='partial';assert.equal(treasuryPhase(v),v);
 v.files.request='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';v.request_matches=false;assert.equal(treasuryPhase(v),v);
 for(const [k,x] of [['mutation_performed',true],['request_matches',null],['request_matches',true],['reservation','complete_inventory_unverified'],['extra','private']]){const bad=structuredClone(v);bad[k]=x;assert.throws(()=>treasuryPhase(bad));}
 const done=fixture();done.reservation='complete_inventory_unverified';done.files={request:'a'.repeat(64),prepared:'b'.repeat(64),admission:'c'.repeat(64),dispatch:null};done.request_matches=true;assert.equal(treasuryPhase(done),done);done.files.raw='private';assert.throws(()=>treasuryPhase(done));
});
test('native printable errors are visible without arbitrary serialization',()=>{
 assert.equal(treasurySendError('Treasury controller refused; inspect the immutable intent before another action'),'Treasury controller refused; inspect the immutable intent before another action');assert.equal(treasurySendError(Error('Fixed refusal')),'Fixed refusal');
 for(const v of [{message:'private'},'x'.repeat(513),'private\nvalue','private\x00value',''])assert.match(treasurySendError(v),/^Outcome unavailable/);
});
test('actual native wrapper uses existing phase command once and never retries a refusal',async()=>{
 const {readFile}=await import('node:fs/promises');let value=null;const calls=[];
 globalThis.__treasuryPhase={native:true,invoke:async(...args)=>{calls.push(args);if(typeof value==='string')throw value;return value;}};
 try{
  let source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__treasuryPhase.native;const invoke=(...args)=>globalThis.__treasuryPhase.invoke(...args);');
  source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(`../src/${p.slice(2)}`,import.meta.url).href}${q}`);
  const {nodeNetworkTreasurySend}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);const target={kind:'remote',host:'pinned',root:'/opt/synergy'};
  assert.equal(await nodeNetworkTreasurySend(target,'phase',{nonce:0}),null);assert.deepEqual(calls[0],['portal_nodenetwork_treasury_send',{target,operation:'phase',parameters:{nonce:0}}]);
  value=fixture();assert.deepEqual(await nodeNetworkTreasurySend(target,'phase',{nonce:0}),value);
  value={schema:'nodenetwork-native-treasury-not-applied-v1',record_id:'a'.repeat(64),request_sha256:'b'.repeat(64),nonce:0,not_applied:true,prepared:false,automatic_retry:false};assert.deepEqual(await nodeNetworkTreasurySend(target,'verify_not_applied',{nonce:0}),value);assert.equal(calls[2][1].operation,'verify_not_applied');
  value='Fixed phase refusal';await assert.rejects(nodeNetworkTreasurySend(target,'phase',{nonce:0}),e=>e===value);assert.equal(calls.length,4);
  await assert.rejects(nodeNetworkTreasurySend(target,'retry',{nonce:0}),/Unsupported/);assert.equal(calls.length,4);globalThis.__treasuryPhase.native=false;await assert.rejects(nodeNetworkTreasurySend(target,'phase',{nonce:0}),/native Portal/);
 }finally{delete globalThis.__treasuryPhase;}
});
test('negative receipt closes only original preparation as false and requires a new quote',async()=>{
 const {treasuryNotApplied}=await import('../src/treasury-send.js');
 const v={schema:'nodenetwork-native-treasury-not-applied-v1',record_id:'a'.repeat(64),request_sha256:'b'.repeat(64),nonce:0,not_applied:true,prepared:false,automatic_retry:false};assert.equal(treasuryNotApplied(v),v);
 for(const [key,value] of [['prepared',true],['automatic_retry',true],['not_applied',false],['nonce',-1],['extra','private']]){const bad={...v,[key]:value};assert.throws(()=>treasuryNotApplied(bad));}
});
test('history accepts treasury negative only for exact operation, never verified success',async()=>{
 const {parseRequestHistory,filterRequests,requestStatusLabel}=await import('../src/request-history.js');
 const r={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'treasury_send_prepare',recorded_at_ms:100,observed_at_ms:101,state:'verified_treasury_prepare_not_applied',response_ok:false};
 const envelope=record=>({schema:'nodenetwork-local-requests-v1',records:[record],limit:256,remoteJobRecovery:false,automaticReplay:false});
 assert.equal(parseRequestHistory(envelope(r)).records[0].response_ok,false);assert.match(requestStatusLabel(r),/not applied/);assert.equal(filterRequests([r],{status:'verified',operation:'all',target:'all'}).length,0);
 for(const bad of [{...r,operation:'treasury_send_submit'},{...r,response_ok:true},{...r,observed_at_ms:99}])assert.throws(()=>parseRequestHistory(envelope(bad)));
});
