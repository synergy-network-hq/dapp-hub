import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('verified bootstrap absence is an observed non-success outcome only',async()=>{
 let response;const calls=[];
 globalThis.__nnHistory={native:true,invoke:async(...args)=>{calls.push(args);return response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnHistory.native;const invoke=(...args)=>globalThis.__nnHistory.invoke(...args);');
  const {nodeNetworkRequests}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(`../src/${path.slice(2)}`,import.meta.url).href}${quote}`)).toString('base64')}`);
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

test('VPN stop history remains visible and cannot become a verified bootstrap absence',async()=>{
 const {parseRequestHistory}=await import('../src/request-history.js');
 const record={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'vpn_stop',recorded_at_ms:1000,observed_at_ms:2000,state:'uncertain',response_ok:null};
 const envelope={schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,records:[record]};
 assert.deepEqual(parseRequestHistory(envelope),envelope);
 assert.doesNotThrow(()=>parseRequestHistory({...envelope,records:[{...record,state:'verified_target_outcome',response_ok:true}]}));
 assert.throws(()=>parseRequestHistory({...envelope,records:[{...record,state:'verified_bootstrap_absence'}]}));
});

test('a stopped guest resume stays a terminal non-success outcome',async()=>{
 const {parseRequestHistory,requestStatusLabel,filterRequests,reviewRequestSelection}=await import('../src/request-history.js');
 const record={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'guest_resume',recorded_at_ms:1000,observed_at_ms:2000,state:'verified_guest_resume_stopped',response_ok:false};
 const envelope=records=>({schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,records});
 const history=envelope([record]);
 assert.deepEqual(parseRequestHistory(history),history);
 assert.equal(requestStatusLabel(record),'Guest resume stopped · not completed');
 for(const status of ['all','responses','stopped']) assert.deepEqual(filterRequests([record],{status,operation:'all'}),[record]);
 for(const status of ['verified','reported-ok','unresolved']) assert.deepEqual(filterRequests([record],{status,operation:'all'}),[]);
 assert.equal(reviewRequestSelection(history,[record.id],3000).records[0].controllerReportedOk,false);
 for(const change of [{operation:'guest_create'},{operation:'guest_stop'},{operation:'bootstrap'},{response_ok:true},{response_ok:null},{observed_at_ms:null},{observed_at_ms:999}]){
  assert.throws(()=>parseRequestHistory(envelope([{...record,...change}])) ,/unsupported record/);
 }
});

test('verified upgrade not applied is terminal false and never successful',async()=>{
 const {parseRequestHistory,requestStatusLabel,filterRequests}=await import('../src/request-history.js');
 const record={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'upgrade',recorded_at_ms:1000,observed_at_ms:2000,state:'verified_upgrade_not_applied',response_ok:false};
 const envelope=records=>({schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,records});
 assert.deepEqual(parseRequestHistory(envelope([record])).records,[record]);
 assert.match(requestStatusLabel(record),/not applied/);
 for(const status of ['all','responses','not-applied']) assert.deepEqual(filterRequests([record],{status,operation:'all'}),[record]);
 for(const status of ['verified','reported-ok','unresolved']) assert.deepEqual(filterRequests([record],{status,operation:'all'}),[]);
 for(const change of [{operation:'install'},{operation:'bootstrap'},{response_ok:true},{response_ok:null},{observed_at_ms:999},{observed_at_ms:null}]) assert.throws(()=>parseRequestHistory(envelope([{...record,...change}])));
});

test('readiness nonapplication is a false outcome with fresh-confirmation wording',async()=>{
 const {parseRequestHistory,requestStatusLabel,filterRequests}=await import('../src/request-history.js');
 const record={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'authorization_stage',recorded_at_ms:1000,observed_at_ms:2000,state:'verified_readiness_not_applied',response_ok:false};
 const envelope=r=>({schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,records:[r]});
 assert.deepEqual(parseRequestHistory(envelope(record)),envelope(record));assert.match(requestStatusLabel(record),/not applied.*fresh collection and separate confirmation/);
 assert.equal(filterRequests([record],{status:'responses',operation:'all'}).length,1);assert.equal(filterRequests([record],{status:'verified',operation:'all'}).length,0);
 for(const bad of [{...record,response_ok:true},{...record,response_ok:null},{...record,operation:'commission'},{...record,observed_at_ms:999}])assert.throws(()=>parseRequestHistory(envelope(bad)));
});

test('commission nonapplication never reports commissioning or success',async()=>{
 const {parseRequestHistory,requestStatusLabel,filterRequests}=await import('../src/request-history.js');const record={version:1,id:'a'.repeat(64),target_digest:'b'.repeat(64),request_digest:'c'.repeat(64),operation:'commission',recorded_at_ms:1000,observed_at_ms:2000,state:'verified_commission_not_applied',response_ok:false};const envelope=r=>({schema:'nodenetwork-local-requests-v1',limit:256,remoteJobRecovery:false,automaticReplay:false,records:[r]});
 assert.deepEqual(parseRequestHistory(envelope(record)),envelope(record));assert.match(requestStatusLabel(record),/Commission not applied.*fresh readiness and separate confirmation/);assert.equal(filterRequests([record],{status:'responses',operation:'all'}).length,1);assert.equal(filterRequests([record],{status:'verified',operation:'all'}).length,0);
 for(const bad of [{...record,response_ok:true},{...record,response_ok:null},{...record,operation:'authorization_stage'},{...record,observed_at_ms:999}])assert.throws(()=>parseRequestHistory(envelope(bad)));
});
