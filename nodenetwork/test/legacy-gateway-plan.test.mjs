import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {legacyGatewayPlanView,legacyGatewayPlanTarget,legacyGatewayServiceView} from '../src/legacy-gateway-plan.js';
const p='a'.repeat(64),target={kind:'remote',host:'167.86.83.83',port:22,root:'/opt/synergy'};
test('obsolete service status and stop are exact and require protected listeners',()=>{
 const relay='synergy-canary-rpc-relay.service';
 const active={schema:'nodenetwork-legacy-canary-service-view-v1',reviewed_sha256:p,
  services_stopped:false,active_units:[relay],stopped_units:[],chain1266_verified:true};
 assert.deepEqual(legacyGatewayServiceView(active,false),active);
 assert.throws(()=>legacyGatewayServiceView(active,true));
 for(const changed of [{chain1266_verified:false},{active_units:[relay,relay]},{active_units:['ssh.service']}]){
  assert.throws(()=>legacyGatewayServiceView({...active,...changed},false));
 }
 const stopped={...active,services_stopped:true,active_units:[],stopped_units:[relay]};
 assert.deepEqual(legacyGatewayServiceView(stopped,true),stopped);
 assert.throws(()=>legacyGatewayServiceView(stopped,false));
});
function fixture(){return {schema:'nodenetwork-legacy-gateway-handoff-plan-v1',challenge:p,target:{...target},machine_id_sha256:'8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d',plan_sha256:p,preserved:{files:Object.fromEntries(['nginx_rpc','nginx_origin_only','nginx_origin_aop','nginx_source_map','tls_public_certificate','tunnel_unit'].map(k=>[k,p])),tunnel_active:true,rpc_listener_owned:true,ws_listener_owned:true},metrics:{unit_sha256:p,service_active:true,listener_owned:true,consumer_ip:'209.145.50.9',resolution:'unresolved'},legacy:{...Object.fromEntries(['chain1266_executable_sha256','canary_executable_sha256','canary_unit_sha256','vpn_unit_sha256','lower_root_entries_sha256','upper_root_entries_sha256'].map(k=>[k,p])),canary_active:true,vpn_active:true},candidate_units:['synergy-chain1266-role@rpc-gateway.service','synergy-canary-rpc-relay.service','synergy-vpn.service'],blockers:['explicit_retirement_approval_required','legacy_inventory_requires_attribution','metrics_resolution_required'],mutation_performed:false,removal_authorized:false,automatic_retry:false};}
test('legacy scope stays read-only and retains unresolved public blockers',()=>{const v=fixture();assert.deepEqual(legacyGatewayPlanView(v,target),v);assert(legacyGatewayPlanTarget(target,'root'));assert(!legacyGatewayPlanTarget(target,'admin'));assert(!legacyGatewayPlanTarget({...target,host:'other.invalid'},'root'));const copy=legacyGatewayPlanView(v,target);copy.blockers.length=0;assert.equal(v.blockers.length,3);});
test('foreign scope and authorization claims never project',()=>{for(const [k,value] of [['removal_authorized',true],['mutation_performed',true],['automatic_retry',true],['extra','private'],['machine_id_sha256','b'.repeat(64)],['blockers',[]],['plan_sha256','not-a-pin']]){const v=fixture();v[k]=value;assert.throws(()=>legacyGatewayPlanView(v,target));}const v=fixture();v.target.host='other.invalid';assert.throws(()=>legacyGatewayPlanView(v,target));});
test('partial attribution must remain explicitly blocked; private or unbounded rows refuse',()=>{const v=fixture();v.preserved.rpc_listener_owned=false;assert.throws(()=>legacyGatewayPlanView(v,target));v.blockers.push('protected_attribution_failed');v.blockers.sort();assert.equal(legacyGatewayPlanView(v,target).preserved.rpc_listener_owned,false);for(const field of ['preserved','metrics','legacy']){const bad=fixture();bad[field].raw='private';assert.throws(()=>legacyGatewayPlanView(bad,target));}for(const blockers of [['foreign_resources'],[...fixture().blockers,'metrics_resolution_required'],['unknown',...fixture().blockers]]){const bad=fixture();bad.blockers=blockers;assert.throws(()=>legacyGatewayPlanView(bad,target));}});

test('inactive legacy process is an observation, never implicit attribution failure',()=>{const v=fixture();v.legacy.canary_active=false;v.legacy.vpn_active=false;assert.equal(legacyGatewayPlanView(v,target).legacy.canary_active,false);});
test('actual IPC wrapper is a single bounded read and never calls a mutation lease or retries',async()=>{
 const calls=[];let result=fixture();globalThis.__handoff={native:true,invoke:async(...args)=>{calls.push(args);if(result instanceof Error)throw result;return result;}};
 try{
  let source=await readFile(new URL('../src/native-services.js',import.meta.url),'utf8');
  source=source.replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__handoff.native;const invoke=(...args)=>globalThis.__handoff.invoke(...args);');
  source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(`../src/${p.slice(2)}`,import.meta.url).href}${q}`);
  const {nodeNetworkLegacyGatewayPlan}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(await nodeNetworkLegacyGatewayPlan(target,'root'),result);assert.deepEqual(calls,[['portal_nodenetwork_legacy_gateway_plan',{target,operator:'root'}]]);
  result={...fixture(),removal_authorized:true};await assert.rejects(nodeNetworkLegacyGatewayPlan(target,'root'),/Unsupported/);assert.equal(calls.length,2);
  result=Error('Fixed native refusal');await assert.rejects(nodeNetworkLegacyGatewayPlan(target,'root'),/Fixed native refusal/);assert.equal(calls.length,3);
  await assert.rejects(nodeNetworkLegacyGatewayPlan(target,'admin'),/existing root/);assert.equal(calls.length,3);
  globalThis.__handoff.native=false;await assert.rejects(nodeNetworkLegacyGatewayPlan(target,'root'),/native Portal/);assert.equal(calls.length,3);
 }finally{delete globalThis.__handoff;}
});

function retirementFixture(){
 const v=fixture();v.schema='nodenetwork-legacy-canary-retirement-plan-v1';v.candidate_units=v.candidate_units.slice(1);
 v.blockers=['explicit_retirement_approval_required','legacy_inventory_requires_attribution','legacy_peer_retirement_required'];
 delete v.legacy.chain1266_executable_sha256;v.preserved.files.canary_frontend=p;
 Object.assign(v.preserved,{rpc_tunnel_pid:10,metrics_pid:11});Object.assign(v.legacy,{canary_pid:12,vpn_pid:13,
 old_network:{network_id:'posy-apqe-canary-process-49028',chain_id:99999,genesis_sha256:'d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7',node_config_sha256:p,relay_config_sha256:p},
 vpn_binding:{enrollment_sha256:'f27a0e0031ba00f2a234e77e55449ca5f4b9a15dec7e2c8da3da5bde6ea37573',binding_sha256:'1629d857606c040ecbd7ed9d5dc692ac697dda3b129cc1f8b2bb9834e594d5f2',peer_id:'dboqb9if611ohpqo0e1g',peer_name:'synergy-canary-rpc-99999',hostname:'vmi3381382',ip:'10.69.51.205',wireguard_public_key:'EhHDd/L7fXX+c8x2nyJx8wWUwGRij3AmioVZKiH4/2M=',management_origin:'https://vpn-coordinator.synergy-network.io',retirement_verified:false}});
 return v;
}
test('old49028-only plan binds exact historical public identity and excludes1266 from removal candidates',()=>{
 const v=retirementFixture();assert.deepEqual(legacyGatewayPlanView(v,target),v);
 assert.equal(v.legacy.chain1266_executable_sha256,undefined);assert(!v.candidate_units.includes('synergy-chain1266-role@rpc-gateway.service'));
 for(const mutate of [x=>x.legacy.old_network.network_id='synergy-posy-canary-20261117',x=>x.legacy.old_network.chain_id=1266,x=>x.legacy.vpn_binding.peer_id='foreign',x=>x.legacy.vpn_binding.retirement_verified=true,x=>x.legacy.canary_pid=0,x=>x.preserved.metrics_pid=-1,x=>delete x.preserved.files.canary_frontend,x=>x.blockers.pop(),x=>x.legacy.secret='private']){const bad=retirementFixture();mutate(bad);assert.throws(()=>legacyGatewayPlanView(bad,target));}
});
