// Local agent readiness is not remote authentication or node health.
export function operatorAuthView(v){
 const keys=['schema','selected_identity_sha256','agent_state','agent_identity_count','selected_identity_present','ready','blocker','remote_contacted','mutation_performed'];
 const pin=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const fail=()=>{throw Error('Unsupported local operator authentication observation. No host was contacted.');};
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||v.schema!=='nodenetwork-operator-auth-status-v1'||v.remote_contacted!==false||v.mutation_performed!==false||typeof v.ready!=='boolean'||!(v.selected_identity_sha256===null||pin(v.selected_identity_sha256)))fail();
 if(v.agent_state==='unavailable'){if(v.agent_identity_count!==null||v.selected_identity_present!==null)fail();}
 else if(!['empty','available'].includes(v.agent_state)||!Number.isSafeInteger(v.agent_identity_count)||v.agent_identity_count<0||v.agent_identity_count>128||typeof v.selected_identity_present!=='boolean'||(v.agent_state==='empty')!==(v.agent_identity_count===0)||(v.agent_state==='empty'&&v.selected_identity_present))fail();
 const expected=v.selected_identity_sha256===null?'selected_identity_unavailable':v.agent_state==='unavailable'?'agent_unavailable':v.agent_state==='empty'?'agent_empty':v.selected_identity_present!==true?'selected_identity_not_loaded':null;
 if(v.blocker!==expected||v.ready!==(expected===null))fail();
 return {...v};
}
export function operatorAuthMessage(v){
 if(v.ready)return 'The selected public identity is loaded in this app’s SSH agent. Remote authentication and node health have not been checked.';
 if(v.blocker==='agent_empty')return 'This app’s SSH agent has no identities. Unlock and load the existing selected operator credential through the OS credential workflow, then read readiness again. No host was contacted.';
 if(v.blocker==='selected_identity_not_loaded')return 'The selected operator identity is not loaded in this app’s SSH agent. No host was contacted.';
 if(v.blocker==='selected_identity_unavailable')return 'Select the existing public operator identity for this physical target first. No host was contacted.';
 return 'This app’s SSH agent is unavailable. No host was contacted.';
}
