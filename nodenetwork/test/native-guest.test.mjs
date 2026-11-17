import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('guest IPC rejects arbitrary routing/resources and serializes mutations without retry',async()=>{
 const calls=[];let response=null,finish;
 globalThis.__nnGuestTest={native:true,invoke:async(...args)=>{calls.push(args);return typeof response==='function'?response():response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";', 'const isTauri=()=>globalThis.__nnGuestTest.native;const invoke=(...args)=>globalThis.__nnGuestTest.invoke(...args);');
  const {nodeNetworkGuest,nodeNetworkVpn}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const target={kind:'remote',host:'approved.example',port:22,root:'/opt/synergy'};
  assert.equal(await nodeNetworkGuest(target,'create','validator-a'),null);
  assert.deepEqual(calls,[['portal_nodenetwork_guest',{target,operation:'create',guestId:'validator-a'}]]);
  await assert.rejects(nodeNetworkGuest(target,'connect','validator-a'),/Unsupported/);
  await assert.rejects(nodeNetworkGuest(target,'create','../a'),/Unsupported/);
  assert.equal(calls.length,1);
  response={schema:'nodenetwork-guest-status-v1',guest_id:'other'};
  await assert.rejects(nodeNetworkGuest(target,'status','validator-a'),/Invalid native/);
  response=()=>new Promise(resolve=>{finish=resolve;});
  const pending=nodeNetworkGuest(target,'stop','validator-a');
  await assert.rejects(nodeNetworkVpn(target,'enroll'),/still pending/);
  finish({schema:'nodenetwork-guest-status-v1',guest_id:'validator-a'});await pending;
  response=()=>{throw Error('uncertain native operation');};
  const before=calls.length;await assert.rejects(nodeNetworkGuest(target,'remove','validator-a'),/uncertain/);assert.equal(calls.length,before+1);
  globalThis.__nnGuestTest.native=false;await assert.rejects(nodeNetworkGuest(target,'status','validator-a'),/native Portal/);
 }finally{delete globalThis.__nnGuestTest;}
});
