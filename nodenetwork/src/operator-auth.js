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

export function operatorCredentialView(v){
 const keys=['schema','selected_identity_sha256','outcome','ready','lifetime_seconds','load_attempted','remote_contacted','credentials_created','automatic_retry'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||v.schema!=='nodenetwork-operator-credential-load-v1'||!/^[a-f0-9]{64}$/.test(v.selected_identity_sha256)||!['already_loaded','loaded','unavailable','changed'].includes(v.outcome)||v.ready!==['loaded','already_loaded'].includes(v.outcome)||v.lifetime_seconds!==(v.outcome==='loaded'?3600:null)||v.load_attempted!==(v.outcome!=='already_loaded')||v.remote_contacted!==false||v.credentials_created!==false||v.automatic_retry!==false)throw Error('Unsupported selected credential load result. Read local operator authentication before another action.');
 return {...v};
}
export function operatorCredentialMessage(v){
 if(v.outcome==='already_loaded')return 'The selected credential was already loaded. Its lifetime was not extended. No host was contacted.';
 if(v.outcome==='loaded')return 'The selected credential is now observed in this app’s OS agent with a maximum one-hour lifetime. No host was contacted; remote authentication remains unverified.';
 if(v.outcome==='changed')return 'Local credential metadata changed during activation. The result is unverified. Read local operator authentication; no automatic retry occurs.';
 return 'The OS did not confirm the selected credential load. An unavailable or locked existing Keychain item requires the normal OS credential workflow. No passphrase was collected and no automatic retry occurs.';
}

export function localOperatorResult(operation,value){
 if(operation==='operator_auth_status'){
  operatorAuthView(value);
  return {label:'Local operator authentication',source:'this app’s local OS agent'};
 }
 if(operation==='operator_auth_load'){
  operatorCredentialView(value);
  return {label:'Selected local credential activation',source:'this app’s local OS credential workflow'};
 }
 return null;
}
