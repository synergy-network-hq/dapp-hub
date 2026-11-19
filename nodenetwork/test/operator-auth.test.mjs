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
