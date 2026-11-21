import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('continuation recovery IPC exposes exact not-applied proof only and never retries',async()=>{
 const calls=[];let response=null;globalThis.__nnRecovery={native:true,invoke:async(...args)=>{calls.push(args);return response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnRecovery.native;const invoke=(...args)=>globalThis.__nnRecovery.invoke(...args);');
  const {nodeNetworkReconcileContinuation}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(`../src/${p.slice(2)}`,import.meta.url).href}${q}`)).toString('base64')}`);
  const target={kind:'remote',host:'pinned',port:22,root:'/opt/synergy'};
  assert.equal(await nodeNetworkReconcileContinuation(target),null);
  const good={schema:'nodenetwork-continuation-not-applied-v1',challenge:'a'.repeat(64),pending_sha256:'b'.repeat(64),request_sha256:'c'.repeat(64),parent_sha256:'d'.repeat(64),not_applied:true,mutation_performed:false};
  response=good;assert.deepEqual(await nodeNetworkReconcileContinuation(target),good);assert.deepEqual(calls[1],['portal_nodenetwork_reconcile_continuation',{target}]);
  for(const change of [{not_applied:false},{mutation_performed:true},{request_sha256:null},{success:true},{schema:'other'}]){response={...good,...change};const count=calls.length;await assert.rejects(nodeNetworkReconcileContinuation(target),/Unsupported/);assert.equal(calls.length,count+1);}
  globalThis.__nnRecovery.native=false;const count=calls.length;await assert.rejects(nodeNetworkReconcileContinuation(target),/native Portal/);assert.equal(calls.length,count);
 }finally{delete globalThis.__nnRecovery;}
});
