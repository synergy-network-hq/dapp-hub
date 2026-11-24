import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formationStatusView,formationView,genesisBindingView,publicExportView} from '../src/formation-workflow.js';
import {controllerDraftScope,workflowGate} from '../src/operator-workflow.js';

const formation={schema:'nodenetwork-formation-v1',network_id:'disposable-formation',chain_id:'999999',formation_sha256:'a'.repeat(64),formation_id:'b'.repeat(64)};
const address='synv11lrh6jcxaejkj4zv994j7qwn2rk6u3ar4emn';
const prepared={...formation,address,pending:true,possession_verified:true,membership_granted:false,request_sha256:'c'.repeat(64)};
const genesis={schema:'nodenetwork-genesis-binding-v1',network_id:formation.network_id,chain_id:formation.chain_id,address,genesis_sha256:'d'.repeat(64),genesis_authority_verified:true,membership_verified:true,bound:false};
const bound={...genesis,bound:true,request_sha256:'e'.repeat(64),enrollment_sha256:'f'.repeat(64)};
const target={kind:'remote',host:'disposable.example',root:'/opt/synergy'};
const operations=['formation_preflight','formation_prepare','formation_status','formation_export','genesis_binding_preflight','genesis_bind','commission'].map(operation=>({operation,kind:['formation_prepare','genesis_bind','commission'].includes(operation)?'mutation':'read',available:true}));
const gate=(operation,extra={})=>workflowGate({operation,target,state:{installed:true,operations},permitted:true,form:{network_id:formation.network_id,chain_id:formation.chain_id},...extra});

test('formation recovers verified identity without authorizing membership or a duplicate prepare',()=>{
 const verified=formationStatusView({...prepared,unexpected:'private values must not render'});
 assert.deepEqual(verified,formationView(prepared,true));
 assert.equal(verified.unexpected,undefined);
 assert.throws(()=>formationStatusView({...prepared,membership_granted:true}));
 assert.throws(()=>formationStatusView({...prepared,request_sha256:null}));
 assert.throws(()=>formationStatusView({pending:false,address}));
 const formationReview={...formation,target:JSON.stringify(target)};
 assert.equal(gate('formation_prepare',{formationReview}).available,false);
 assert.equal(gate('formation_prepare',{formationReview,formationRecord:verified}).available,false);
 assert.deepEqual(gate('formation_prepare',{formationReview,formationRecord:{pending:false}}).parameters,{formation_sha256:formation.formation_sha256});
 assert.equal(gate('formation_prepare',{formationReview,formationRecord:{pending:false},form:{network_id:'different'}}).available,false);
 assert.equal(gate('formation_export',{formationRecord:verified}).available,true);
});

test('signed membership, bound custody and connected VPN are independently checked',()=>{
 const formationRecord=formationStatusView(prepared);
 for(const bad of [{...genesis,network_id:'other'},{...genesis,address:'synv1otheraddress123'},{...genesis,genesis_authority_verified:false},{...genesis,membership_verified:false}])
  assert.throws(()=>genesisBindingView(bad,formationRecord));
 const reviewed=genesisBindingView(genesis,formationRecord);
 assert.equal(reviewed.bound,false);
 assert.throws(()=>genesisBindingView(genesis,formationRecord,genesis.genesis_sha256));
 assert.throws(()=>genesisBindingView(bound,formationRecord,'0'.repeat(64)));
 const bindingReview={...reviewed,target:JSON.stringify(target)};
 assert.equal(gate('genesis_bind',{formationRecord}).available,false);
 assert.deepEqual(gate('genesis_bind',{formationRecord,bindingReview}).parameters,{genesis_sha256:genesis.genesis_sha256});
 assert.equal(gate('commission',{formationRecord,bindingReview,vpnStatus:{connected:true,server_bound:true}}).available,false);
 const binding={...genesisBindingView(bound,formationRecord,genesis.genesis_sha256),target:JSON.stringify(target)};
 assert.equal(gate('genesis_bind',{formationRecord,bindingReview:binding}).available,false);
 assert.equal(gate('commission',{formationRecord,bindingReview:binding,vpnStatus:{connected:true,server_bound:false}}).available,false);
 assert.equal(gate('commission',{formationRecord,bindingReview:binding,vpnStatus:{connected:true,server_bound:true}}).available,true);
 assert.deepEqual(publicExportView({address,sha256:bound.enrollment_sha256,artifact:'not rendered'},address),{address,sha256:bound.enrollment_sha256});
 assert.throws(()=>publicExportView({address,sha256:bound.enrollment_sha256},'synv1differentaddress'));
});

test('selected validator origin rejects another signed Genesis even when network and chain match',()=>{
 const formationRecord=formationStatusView(prepared);
 const bindingReview={...genesisBindingView(genesis,formationRecord),target:JSON.stringify(target)};
 const validatorProfile={profile_id:'chosen',network_id:genesis.network_id,chain_id:Number(genesis.chain_id),
  genesis_hash:'1'.repeat(64),origin:{'genesis.json':genesis.genesis_sha256}};
 const selection={formationRecord,bindingReview,validatorProfile};
 assert.equal(gate('genesis_bind',selection).available,true);
 assert.match(gate('genesis_bind',{...selection,bindingReview:{...bindingReview,genesis_sha256:'2'.repeat(64)}}).blocker,
  /verified signed Genesis for the selected validator profile/);
 assert.match(gate('genesis_bind',{...selection,form:{chain_id:genesis.chain_id,network_id:'different'}}).blocker,
  /Apply the selected validator profile/);
 const reviewed={...bindingReview,bound:true};
 const ready={...selection,bindingReview:reviewed,vpnStatus:{connected:true,server_bound:true}};
 assert.equal(gate('commission',ready).available,true);
 const replaced={...validatorProfile,origin:{'genesis.json':'2'.repeat(64)}};
 assert.equal(gate('commission',{...ready,validatorProfile:replaced}).available,false);
 const form={network_id:genesis.network_id,chain_id:genesis.chain_id};
 const scope=controllerDraftScope(JSON.stringify(target),true,form,validatorProfile);
 assert.notEqual(controllerDraftScope(JSON.stringify(target),true,form,replaced),scope);
 assert.notEqual(controllerDraftScope(JSON.stringify(target),true,form,{...validatorProfile,genesis_hash:'3'.repeat(64)}),scope);
});
