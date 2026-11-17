import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('ordinary treasury native route has exact actions, real errors and no retry',async()=>{
 let response=null;const calls=[];
 globalThis.__nnTreasury={native:true,invoke:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnTreasury.native;const invoke=(...args)=>globalThis.__nnTreasury.invoke(...args);');
  const {nodeNetworkTreasury}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const target={kind:'remote',host:'approved.example',port:22,root:'/opt/synergy'};
  assert.equal(await nodeNetworkTreasury(target,'prepare'),null);assert.deepEqual(calls[0],['portal_nodenetwork_treasury',{target,operation:'prepare'}]);
  await assert.rejects(nodeNetworkTreasury(target,'spend'),/Unsupported/);assert.equal(calls.length,1);
  response={pending:false};assert.deepEqual(await nodeNetworkTreasury(target,'status'),response);
  response={schema:'nodenetwork-formation-treasury-v1',pending:true,possession_verified:true,allocation_nwei:'5000000000000000',address:'syna1public'};
  assert.deepEqual(await nodeNetworkTreasury(target,'prepare'),response);
  response={...response,address:'synw000000'};await assert.rejects(nodeNetworkTreasury(target,'status'),/Unsupported/);
  response=Error('uncertain; reconcile');let before=calls.length;await assert.rejects(nodeNetworkTreasury(target,'prepare'),/uncertain/);assert.equal(calls.length,before+1);
  globalThis.__nnTreasury.native=false;await assert.rejects(nodeNetworkTreasury(target,'status'),/native Portal/);
 }finally{delete globalThis.__nnTreasury;}
});
