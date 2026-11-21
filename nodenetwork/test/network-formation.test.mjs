import test from 'node:test';
import assert from 'node:assert/strict';
import {networkFormationView} from '../src/network-formation.js';
const p='a'.repeat(64);
const review={schema:'nodenetwork-network-formation-v1',pending:true,signed:false,network_id:'isolated-network',chain_id:'99999',formation_sha256:p,request_sha256:p,review_sha256:p,unsigned_genesis_sha256:p,unsigned_authority_sha256:p,authority_root_sha256:p,validator_addresses:[0,1,2,3,4].map(i=>'synv1'+String(i).repeat(30))};
test('preparation cannot claim signing and signed results must match exact reviewed context',()=>{
 assert.deepEqual(networkFormationView({pending:false}),{pending:false});
 assert.equal(networkFormationView({...review,private_key:'never expose'}).private_key,undefined);
 assert.throws(()=>networkFormationView({...review,signed:true}));
 const signed={...review,signed:true,genesis_sha256:p,authority_sha256:p,sign_request_sha256:p};
 assert.equal(networkFormationView(signed,review).signed,true);
 for(const bad of [{...signed,review_sha256:'b'.repeat(64)},{...signed,network_id:'another-network'},{...signed,chain_id:'099999'},{...signed,validator_addresses:Array(5).fill(review.validator_addresses[0])}])assert.throws(()=>networkFormationView(bad,review));
});

import {workflowGate} from '../src/operator-workflow.js';
test('signing requires the current target unsigned review and never retries a signed network',()=>{
 const target={kind:'remote',host:'disposable.example',root:'/opt/synergy'};
 const state={installed:true,operations:['network_formation_prepare','network_formation_sign'].map(operation=>({operation,kind:'mutation',available:true}))};
 const gate=extra=>workflowGate({target,state,permitted:true,operation:'network_formation_sign',...extra});
 assert.equal(gate({}).available,false);
 assert.equal(gate({networkReview:{...review,target:JSON.stringify(target)}}).parameters.review_sha256,p);
 assert.equal(gate({networkReview:{...review,target:'another-target'}}).available,false);
 assert.equal(gate({networkReview:{...review,target:JSON.stringify(target),signed:true}}).available,false);
});

test('engineering continuation capability needs both native target and exact declared operation',()=>{
 const target={kind:'remote',host:'disposable.example',root:'/opt/synergy'};
 const base={target,permitted:true,operation:'network_formation_sign',networkReview:{...review,target:JSON.stringify(target)}};
 const row={operation:'network_formation_sign',kind:'mutation',available:false,blocker:'Operation has not passed host qualification',engineeringContinuation:true};
 assert.equal(workflowGate({...base,state:{installed:true,operations:[row]}}).available,false);
 assert.equal(workflowGate({...base,state:{installed:true,engineeringContinuation:true,operations:[row]}}).available,true);
 assert.equal(workflowGate({...base,state:{installed:true,engineeringContinuation:true,operations:[{...row,engineeringContinuation:false}]}}).available,false);
 assert.equal(workflowGate({...base,state:{installed:true,engineeringContinuation:true,operations:[row,row]}}).available,false);
});
