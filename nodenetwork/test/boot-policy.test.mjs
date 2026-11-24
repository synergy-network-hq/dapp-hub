import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {bootPolicyParameters,bootPolicyView,bootPolicyStatusView,workflowGate} from '../src/operator-workflow.js';
test('boot policy is exact per service, observed only, and never guest enabled or runtime-changing',()=>{
 for(const service of ['node','vpn'])for(const enabled of [false,true]){
  const request={service,enabled};assert.deepEqual(bootPolicyParameters(request,{}),request);
  const ack={schema:'nodenetwork-boot-policy-v1',...request,runtime_changed:false};assert.deepEqual(bootPolicyView(ack,request),ack);
  for(const bad of [{...ack,enabled:!enabled},{...ack,runtime_changed:true},{...ack,extra:false}])assert.throws(()=>bootPolicyView(bad,request));
 }
 for(const p of [{},{service:'vpn',enabled:'false'},{service:'guest',enabled:true},{service:'node',enabled:false,start:true}])assert.throws(()=>bootPolicyParameters(p,{}));
 assert.throws(()=>bootPolicyParameters({service:'node',enabled:true},{guest:{guest_id:'guest'}}));assert.deepEqual(bootPolicyParameters({service:'vpn',enabled:false},{guest:{}}),{service:'vpn',enabled:false});
 const status={schema:'nodenetwork-boot-policy-status-v1',node_enabled:false,vpn_enabled:true,applied:false,request_sha256:null,runtime_changed:false};assert.deepEqual(bootPolicyStatusView(status),status);
 for(const bad of [{...status,node_enabled:null},{...status,applied:true},{...status,request_sha256:'a'.repeat(64)},{...status,runtime_changed:true},{...status,quorum:4}])assert.throws(()=>bootPolicyStatusView(bad));
 const state={installed:true,operations:[{operation:'boot_policy',kind:'mutation',available:true,qualified:true}]};
 assert.equal(workflowGate({target:{},state,permitted:false,operation:'boot_policy'}).available,false);
 assert.equal(workflowGate({target:{},state:{...state,installed:false},permitted:true,operation:'boot_policy'}).available,false);
 assert.equal(workflowGate({target:{},state:{...state,operations:[{operation:'boot_policy',kind:'read',available:true}]},permitted:true,operation:'boot_policy'}).available,false);
});
test('native boot route retains exact params/read status and lost responses are not retried',async()=>{
 const calls=[];let reply;globalThis.__bootPolicy={invoke:async(...args)=>{calls.push(args);if(reply instanceof Error)throw reply;return reply;}};
 try{
  let source=await readFile(new URL('../src/native-services.js',import.meta.url),'utf8');source=source.replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>true;const invoke=(...args)=>globalThis.__bootPolicy.invoke(...args);');source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(`../src/${p.slice(2)}`,import.meta.url).href}${q}`);
  const {nodeNetworkController}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);const target={kind:'remote',host:'approved.example',root:'/opt/synergy'};
  for(const service of ['node','vpn'])for(const enabled of [false,true]){reply={version:1,ok:true,result:{schema:'nodenetwork-boot-policy-v1',service,enabled,runtime_changed:false}};await nodeNetworkController(target,'boot_policy',{service,enabled});assert.deepEqual(calls.at(-1),['portal_nodenetwork_controller',{target,request:{version:1,operation:'boot_policy',parameters:{service,enabled}}}]);}
  reply=Error('lost reply');const count=calls.length;await assert.rejects(nodeNetworkController(target,'boot_policy',{service:'vpn',enabled:true}));assert.equal(calls.length,count+1);
  reply={version:1,ok:true,result:{schema:'nodenetwork-boot-policy-status-v1',node_enabled:false,vpn_enabled:true,applied:false,request_sha256:null,runtime_changed:false}};assert.equal((await nodeNetworkController(target,'boot_policy_status')).vpn_enabled,true);assert.deepEqual(calls.at(-1)[1].request.parameters,{});
  const ui=await readFile(new URL('../src/NodeController.jsx',import.meta.url),'utf8');assert.match(ui,/Read the boot policy to verify the current settings/);assert.match(ui,/starts its VPN dependency when enabled at boot/);assert.match(ui,/!target\.guest&&<button/);assert.match(ui,/row\.operation==='boot_policy_status'&&row\.kind==='read'/);
 }finally{delete globalThis.__bootPolicy;}
});
