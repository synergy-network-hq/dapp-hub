import {test} from 'node:test';import assert from 'node:assert/strict';
import {operatorAuthView,operatorAuthMessage} from '../src/operator-auth.js';
const ready=()=>({schema:'nodenetwork-operator-auth-status-v1',selected_identity_sha256:'a'.repeat(64),agent_state:'available',agent_identity_count:1,selected_identity_present:true,ready:true,blocker:null,remote_contacted:false,mutation_performed:false});
test('operator readiness separates exact selected identity from empty or foreign agent',()=>{
 assert.match(operatorAuthMessage(operatorAuthView(ready())),/have not been checked/);
 const empty={...ready(),agent_state:'empty',agent_identity_count:0,selected_identity_present:false,ready:false,blocker:'agent_empty'};assert.match(operatorAuthMessage(operatorAuthView(empty)),/no identities/);
 assert.equal(operatorAuthView({...ready(),selected_identity_present:false,ready:false,blocker:'selected_identity_not_loaded'}).ready,false);
});
test('operator readiness rejects invented success, remote action, extra fields and malformed counts',()=>{
 for(const bad of [{...ready(),remote_contacted:true},{...ready(),mutation_performed:true},{...ready(),extra:'key'},{...ready(),selected_identity_present:false},{...ready(),agent_identity_count:129},{...ready(),agent_state:'empty'},{...ready(),selected_identity_sha256:null}])assert.throws(()=>operatorAuthView(bad));
 assert.equal(operatorAuthView({...ready(),agent_state:'unavailable',agent_identity_count:null,selected_identity_present:null,ready:false,blocker:'agent_unavailable'}).ready,false);
});
import {operatorCredentialView,operatorCredentialMessage} from '../src/operator-auth.js';
const loaded=()=>({schema:'nodenetwork-operator-credential-load-v1',selected_identity_sha256:'a'.repeat(64),outcome:'loaded',ready:true,lifetime_seconds:3600,load_attempted:true,remote_contacted:false,credentials_created:false,automatic_retry:false});
test('credential load distinguishes bounded load from unchanged already-loaded identity and failed verification',()=>{
 assert.match(operatorCredentialMessage(operatorCredentialView(loaded())),/maximum one-hour/);
 const noop={...loaded(),outcome:'already_loaded',load_attempted:false,lifetime_seconds:null};assert.match(operatorCredentialMessage(operatorCredentialView(noop)),/not extended/);
 for(const outcome of ['unavailable','changed'])assert.equal(operatorCredentialView({...loaded(),outcome,ready:false,lifetime_seconds:null}).ready,false);
});
test('credential load rejects invented readiness, unbounded TTL, credential creation, retry and arbitrary fields',()=>{
 for(const v of [{...loaded(),lifetime_seconds:0},{...loaded(),outcome:'unavailable'},{...loaded(),outcome:'already_loaded'},{...loaded(),remote_contacted:true},{...loaded(),credentials_created:true},{...loaded(),automatic_retry:true},{...loaded(),path:'private'},{...loaded(),selected_identity_sha256:null}])assert.throws(()=>operatorCredentialView(v));
});
