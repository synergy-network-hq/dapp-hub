import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('guest IPC rejects arbitrary routing/resources and serializes mutations without retry',async()=>{
 const calls=[];let response=null,finish;
 globalThis.__nnGuestTest={native:true,invoke:async(...args)=>{calls.push(args);return typeof response==='function'?response():response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";', 'const isTauri=()=>globalThis.__nnGuestTest.native;const invoke=(...args)=>globalThis.__nnGuestTest.invoke(...args);');
  const {nodeNetworkGuest,nodeNetworkVpn}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(`../src/${path.slice(2)}`,import.meta.url).href}${quote}`)).toString('base64')}`);
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

test('bare rollback IPC preserves old release reference and never retries a canceled or uncertain native review',async()=>{
 let calls=0,reply=null;
 globalThis.__nnRollbackTest={native:true,invoke:async(command,args)=>{calls++;assert.equal(command,'portal_nodenetwork_bare_rollback');assert.equal(args.releaseId,'synergy-linux-277269106d979097');assert.equal(args.operator,'root');return reply;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";', 'const isTauri=()=>globalThis.__nnRollbackTest.native;const invoke=(...args)=>globalThis.__nnRollbackTest.invoke(...args);');
  const {rollbackBareNodeBootstrap}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(`../src/${path.slice(2)}`,import.meta.url).href}${quote}`)).toString('base64')}`);
  const target={kind:'remote',host:'127.0.0.1',port:22280,root:'/opt/synergy'};
  assert.equal(await rollbackBareNodeBootstrap(target,'root','synergy-linux-277269106d979097'),null);assert.equal(calls,1);
  globalThis.__nnRollbackTest.invoke=async()=>{calls++;throw Error('uncertain');};
  await assert.rejects(rollbackBareNodeBootstrap(target,'root','synergy-linux-277269106d979097'),/uncertain/);assert.equal(calls,2);
  globalThis.__nnRollbackTest.native=false;await assert.rejects(rollbackBareNodeBootstrap(target,'root','synergy-linux-277269106d979097'),/native Portal/);assert.equal(calls,2);
 }finally{delete globalThis.__nnRollbackTest;}
});

test('guest configuration IPC accepts only native selection and never retries an uncertain grant',async()=>{
 let calls=0,reply=null;
 const target={kind:'remote',host:'approved-host',root:'/opt/synergy'};
 globalThis.__nnConfig={native:true,invoke:async(command,args)=>{calls++;assert.equal(command,'portal_nodenetwork_configure_guest');assert.deepEqual(args,{target});if(reply instanceof Error)throw reply;return reply;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnConfig.native;const invoke=(...args)=>globalThis.__nnConfig.invoke(...args);');
  const {nodeNetworkConfigureGuest}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(`../src/${path.slice(2)}`,import.meta.url).href}${quote}`)).toString('base64')}`);
  assert.equal(await nodeNetworkConfigureGuest(target),null);assert.equal(calls,1);
  await assert.rejects(nodeNetworkConfigureGuest({...target,guest:{guest_id:'x'}}),/physical hosting/);assert.equal(calls,1);
  reply={schema:'nodenetwork-guest-configuration-v1',configured:true,guest_created:false,guest_id:'validator-guest'};assert.deepEqual(await nodeNetworkConfigureGuest(target),reply);
  reply={...reply,guest_created:true};await assert.rejects(nodeNetworkConfigureGuest(target),/Invalid native/);
  reply=Error('uncertain');const before=calls;await assert.rejects(nodeNetworkConfigureGuest(target),/uncertain/);assert.equal(calls,before+1);
  globalThis.__nnConfig.native=false;await assert.rejects(nodeNetworkConfigureGuest(target),/native Portal/);
 }finally{delete globalThis.__nnConfig;}
});
