import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('verified bootstrap absence is an observed non-success outcome only',async()=>{
 let response;const calls=[];
 globalThis.__nnHistory={native:true,invoke:async(...args)=>{calls.push(args);return response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnHistory.native;const invoke=(...args)=>globalThis.__nnHistory.invoke(...args);');
  const {nodeNetworkRequests}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const record={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'bootstrap',recorded_at_ms:1000,observed_at_ms:2000,state:'verified_bootstrap_absence',response_ok:null};
  const envelope=records=>({schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,records});
  response=envelope([record]);assert.deepEqual(await nodeNetworkRequests(),response);
  assert.deepEqual(calls,[['portal_nodenetwork_requests']]);
  for(const change of [{operation:'install'},{operation:'identity_generate'},{response_ok:true},{response_ok:false},{observed_at_ms:null},{observed_at_ms:999},{observed_at_ms:Infinity},{state:'absence_claimed'}]){
   response=envelope([{...record,...change}]);await assert.rejects(nodeNetworkRequests(),/unsupported record/);
  }
  response=envelope([record,record]);await assert.rejects(nodeNetworkRequests(),/unsupported record/);
  response={...envelope([record]),automaticReplay:true};await assert.rejects(nodeNetworkRequests(),/unsupported record/);
  globalThis.__nnHistory.native=false;const count=calls.length;await assert.rejects(nodeNetworkRequests(),/native Portal/);assert.equal(calls.length,count);
 }finally{delete globalThis.__nnHistory;}
});
