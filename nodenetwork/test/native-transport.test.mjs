import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('dedicated transport IPC consumes bare native DTOs for every action, preserves cancel/refusal and releases mutation lease',async()=>{
 const calls=[];let value=null;
 globalThis.__transport={native:true,invoke:async(...args)=>{calls.push(args);if(value instanceof Error||typeof value==='string')throw value;return value;}};
 try{
  let source=await readFile(new URL('../src/native-services.js',import.meta.url),'utf8');
  source=source.replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__transport.native;const invoke=(...args)=>globalThis.__transport.invoke(...args);');
  source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(`../src/${p.slice(2)}`,import.meta.url).href}${q}`);
  const {nodeNetworkTransport,nodeNetworkFleetReadiness,nodeNetworkTreasurySend}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const target={kind:'remote',host:'pinned.example',port:22,root:'/opt/synergy'},pin='a'.repeat(64);
  const absent={schema:'nodenetwork-network-transport-v1',pending:false};
  const review={...absent,pending:true,signed:false,formation_sha256:pin,genesis_review_sha256:pin,target_provider_report_sha256:pin,network_id:'fresh',chain_id:'99999',request_sha256:pin,review_sha256:pin,genesis_sha256:pin,authority_sha256:pin,issuer_root_sha256:pin,valid_from_unix:1795035856,expires_at_unix:1795640656,validator_addresses:['synv11first','synv11second','synv11third','synv11fourth','synv11fifth'],runtime_admission:false,fleet_readiness_verified:false};
  const signed={...review,signed:true,registry_sha256:pin,sign_request_sha256:pin};
  const exported={review_sha256:pin,registry_sha256:pin,issuer_root_sha256:pin,node_count:5,fleet_readiness_verified:false,runtime_admission:false,exported_directory:'/public/nodenetwork-transport-a'};
  const notApplied={schema:'nodenetwork-native-transport-not-applied-v1',not_applied:true,staged:false,dispatch_sha256:pin,authorization_sha256:pin,automatic_retry:false};
  const staged={schema:'nodenetwork-native-transport-staged-v1',staged:true,address:'synv11ssfh8clfcxxa9zqalgm8zzwmu42nlhy7veg',review_sha256:pin,artifact_sha256:Object.fromEntries(['config/node.json','config/start-authorized.json','network/genesis.json','network/authority.json','network/authority-root.pub','network/network-manifest.json','network/transport-registry.json','network/transport-root.pub'].map(name=>[name,pin])),fleet_readiness_verified:false,commissioned:false,runtime_admission:false};
  for(const [operation,result]of [['status',absent],['prepare',review],['sign',signed],['export',exported],['stage',staged],['reconcile_stage',notApplied]]){value=result;assert.deepEqual(await nodeNetworkTransport(target,operation,pin),result);assert.deepEqual(calls.at(-1),['portal_nodenetwork_transport',{target,operation,reviewSha256:pin}]);value=null;assert.equal(await nodeNetworkTransport(target,operation,pin),null);value=Error('Exact native refusal; reconcile before retry');const before=calls.length;await assert.rejects(nodeNetworkTransport(target,operation,pin),/Exact native refusal/);assert.equal(calls.length,before+1);}
  for(const bad of [{version:1,ok:true,result:absent},{...review,runtime_admission:true},{...absent,private_key:'forbidden'},[],null]){value=bad;if(bad===null)continue;await assert.rejects(nodeNetworkTransport(target,'status'),/Invalid transport/);}
  value={...exported,unknown:'forbidden'};await assert.rejects(nodeNetworkTransport(target,'export'),/Invalid public transport/);
  for(const bad of [{...notApplied,staged:true},{...notApplied,automatic_retry:true},{...notApplied,not_applied:false},{...notApplied,unknown:true}]){value=bad;await assert.rejects(nodeNetworkTransport(target,'reconcile_stage'),/Invalid transport nonapplication/);}
  value={...staged,commissioned:true};await assert.rejects(nodeNetworkTransport(target,'stage'),/Invalid transport/);
  value=absent;assert.deepEqual(await nodeNetworkTransport(target,'status'),absent);
  const before=calls.length;await assert.rejects(nodeNetworkTransport(target,'unsupported'),/Unsupported/);assert.equal(calls.length,before);
  // Immediate next workflow commands already return bare DTOs; preserve that contract.
  const online_addresses=Array.from({length:5},(_,i)=>`validator-${i+1}`);
  const fleet={schema:'nodenetwork-native-fleet-readiness-v2',review_sha256:pin,
   observations:online_addresses.map(address=>({address,observation_kind:'prestart_vpn',online_addresses})),
   online_addresses,excluded_addresses:[],scope:'commissioning_and_prestart_vpn_only',
   finality_verified:false,runtime_participation_verified:false};value=fleet;
  assert.deepEqual(await nodeNetworkFleetReadiness(target,'collect',Array.from({length:5},(_,i)=>({...target,host:`host${i}`}))),fleet);
  const status={schema:'nodenetwork-treasury-send-status-v1',prepared:{},finalized_observation:null,account_observations:null,automatic_retry:false};value=status;
  assert.deepEqual(await nodeNetworkTreasurySend(target,'status',{nonce:0}),status);
  for(const call of [()=>nodeNetworkFleetReadiness(target,'reconcile'),()=>nodeNetworkTreasurySend(target,'status',{nonce:0})]){value=null;assert.equal(await call(),null);value=Error('visible refusal');const before=calls.length;await assert.rejects(call(),/visible refusal/);assert.equal(calls.length,before+1);}
  globalThis.__transport.native=false;await assert.rejects(nodeNetworkTransport(target,'status'),/native Portal/);
 }finally{delete globalThis.__transport;}
});
test('transport errors use the existing SDK error prop and remain visibly rendered',async()=>{
 for(const name of ['TransportFormation','FleetReadiness','TreasurySend']){const source=await readFile(new URL(`../src/${name}.jsx`,import.meta.url),'utf8');
 assert.match(source,/<ErrorMessage error=\{error\}/);assert.doesNotMatch(source,/<ErrorMessage message=/);}
});


test('transport UI preserves bounded native String refusals without object or diagnostic disclosure',async()=>{
 const {transportFailureMessage}=await import('../src/transport-workflow.js');
 const refusal='transport_reconcile_continuation_mismatch: Target does not confirm the original transport continuation. Do not restage';
 assert.equal(transportFailureMessage(refusal),refusal);
 assert.equal(transportFailureMessage(Error(refusal)),refusal);
 for(const failure of [null,undefined,{message:'private unexpected object',token:'not rendered'},'x'.repeat(513),'private\nraw log','private\u0000raw']){
  const message=transportFailureMessage(failure);
  assert.match(message,/Reconcile uncertain staging through the same staging action/);
  assert.doesNotMatch(message,/private|token/);
 }
 const source=await readFile(new URL('../src/TransportFormation.jsx',import.meta.url),'utf8');
 assert.match(source,/setError\(transportFailureMessage\(failure\)\)/);
});
test('readiness preserves bounded native String refusals with a readiness-specific safe fallback',async()=>{
 const {readinessFailureMessage}=await import('../src/fleet-readiness.js');
 const message='Fleet commissioning observation refused for Remote · approved.example · SSH port 22 (vpn_readiness_required). No readiness was collected.';
 assert.equal(readinessFailureMessage(message),message);assert.equal(readinessFailureMessage(Error(message)),message);
 for(const value of [null,{message:'private unexpected object',token:'private'},'x'.repeat(513),'private\nlog','private\u0000raw']){const result=readinessFailureMessage(value);assert.match(result,/Readiness outcome unavailable/);assert.doesNotMatch(result,/private|transport|staging action/);}
 const source=await readFile(new URL('../src/FleetReadiness.jsx',import.meta.url),'utf8');assert.match(source,/setError\(readinessFailureMessage\(e\)\)/);assert.match(source,/<ErrorMessage error=\{error\}/);
});
