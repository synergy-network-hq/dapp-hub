import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {legacyPeerPreflightView} from '../src/legacy-peer-preflight.js';
const fixture=()=>({schema:'nodenetwork-legacy-peer-retirement-preflight-v1',plan_sha256:'a'.repeat(64),provider_sha256:'b'.repeat(64),account_id:'da99e12f611ghl16dvjg',peer_id:'dboqb9if611ohpqo0e1g',ready:false,account_verified:true,peer_verified:true,public_key_verified:false,blocker:'independent_peer_key_binding_unavailable',mutation_performed:false,retirement_authorized:false});
test('exact account and peer reads remain blocked on independent key binding',()=>{const v=fixture();assert.deepEqual(legacyPeerPreflightView(v),v);});
test('malformed, foreign and authorization claims never project',()=>{for(const [key,value] of [['ready',true],['public_key_verified',true],['retirement_authorized',true],['mutation_performed',true],['account_verified',false],['peer_verified',false],['account_id','foreign'],['peer_id','foreign'],['plan_sha256','bad'],['provider_sha256','bad'],['schema','foreign'],['blocker',null],['extra','private']]){const v=fixture();v[key]=value;assert.throws(()=>legacyPeerPreflightView(v));}const missing=fixture();delete missing.plan_sha256;for(const v of [null,{},[],missing,{version:1,ok:false,error:{message:'private'}}])assert.throws(()=>legacyPeerPreflightView(v));});

test('actual controller service unwraps the authorized response before projection',async()=>{
 const result=fixture();let reply={version:1,ok:true,result};const calls=[];
 globalThis.__legacyPeerService={invoke:async(...args)=>{calls.push(args);return reply;}};
 try{
  let source=await readFile(new URL('../src/native-services.js',import.meta.url),'utf8');
  source=source.replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>true;const invoke=(...args)=>globalThis.__legacyPeerService.invoke(...args);');
  source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(`../src/${p.slice(2)}`,import.meta.url).href}${q}`);
  const {nodeNetworkController}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const target={kind:'remote',host:'167.86.83.83',port:22,root:'/opt/synergy'};
  const observed=await nodeNetworkController(target,'legacy_peer_preflight',{});
  assert.equal(observed,result);assert.deepEqual(legacyPeerPreflightView(observed),result);
  assert.deepEqual(calls,[['portal_nodenetwork_controller',{target,request:{version:1,operation:'legacy_peer_preflight',parameters:{}}}]]);
  assert.throws(()=>legacyPeerPreflightView(reply));
  reply={version:1,ok:false,error:{code:'legacy_peer_preflight_refused',message:'Read refused'}};
  await assert.rejects(nodeNetworkController(target,'legacy_peer_preflight',{}),/Read refused/);
  assert.equal(calls.length,2);
 }finally{delete globalThis.__legacyPeerService;}
});
