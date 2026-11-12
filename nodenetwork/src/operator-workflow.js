import {controllerOperation,installParameters,provisioningChecks} from './nodeNetwork.js';

export const NODE_ROLES=Object.freeze([
 Object.freeze({id:'validator',label:'Validator',description:'Run PoSy consensus on an admitted host with its own APQE custody.'}),
 Object.freeze({id:'rpc_gateway',label:'RPC gateway',description:'A public RPC entry point. Provisioning is unavailable through this controller.'}),
 Object.freeze({id:'observer_light',label:'Light observer',description:'A non-voting node. Provisioning is unavailable through this controller.'}),
]);

export function nodeRoleCatalog(declared) {
 if(!Array.isArray(declared)||declared.length>64||!declared.includes('validator')||
    new Set(declared).size!==declared.length||declared.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(id)))return NODE_ROLES;
 return [NODE_ROLES[0],...declared.filter(id=>id!=='validator').map(id=>
  NODE_ROLES.find(role=>role.id===id)??{id,label:id.replace(/(^|[_-])([a-z])/g,(_,gap,ch)=>(gap?' ':'')+ch.toUpperCase()),
   description:'Declared by the inspected master. Provisioning is unavailable through this controller.'})];
}

export function updateParameters(form){
 const failed=provisioningChecks(form).slice(0,2).find(check=>!check.valid);
 if(failed)throw Error(failed.message);
 return {release_id:form.release_id,manifest_sha256:form.manifest_sha256};
}
export function approvedReviewScope(operation,parameters={}){
 if(operation==='install'||operation==='install_preflight')return JSON.stringify(['install',parameters.release_id,parameters.manifest_sha256,parameters.network_id,parameters.chain_id,parameters.node_name]);
 if(operation==='upgrade'||operation==='upgrade_preflight')return JSON.stringify(['upgrade',parameters.release_id,parameters.manifest_sha256]);
 if(operation==='uninstall'||operation==='uninstall_preflight')return 'uninstall';
 return null;
}

export function checkedTarget(value,target){
 if(value?.controllerVersion!==1||value.root!==target.root||typeof value.installed!=='boolean'||!Array.isArray(value.operations)||value.operations.length>100)throw Error('The selected target did not return supported controller capabilities. No node operation is available.');
 return value;
}

// These checks bind a UI review to this target and the exact current inputs. The
// native engine separately authenticates the request, policy and one-time grant.
export function acceptedReview(operation,parameters,response,target){
 if(operation==='install_preflight')return response?.packageVerified===true&&response.networkSelectionApproved===true&&response.release===parameters.release_id&&response.root===target.root;
 if(operation==='upgrade_preflight')return response?.packageVerified===true&&response.release===parameters.release_id&&response.automaticRestart===false;
 if(operation==='uninstall_preflight')return response?.destructive===true&&response.root===target.root&&response.inventory?.root===target.root&&Array.isArray(response.inventory?.members);
 return false;
}

export function workflowGate({target,state,permitted,operation,form,review,confirmation,vpnStatus,identityReview,formationReview,formationRecord,bindingReview}){
 const unavailable=blocker=>({available:false,blocker});
 if(!permitted)return unavailable('Allow NodeNetwork inspection in Security & permissions.');
 if(!state)return unavailable('Inspect the selected target first.');
 const capability=controllerOperation(state,operation);
 if(!capability.available)return capability;
 if((operation==='install'||operation==='install_preflight')&&state.installed)return unavailable('A node is already installed. Use Updates for a qualified replacement.');
 if(['commission','register','start','stop','restart','upgrade','upgrade_preflight','uninstall','uninstall_preflight','health','recovery_preflight','vpn_status','vpn_enroll','identity_preflight','identity_status','identity_generate','formation_preflight','formation_prepare','formation_status','formation_export','genesis_stage','genesis_binding_preflight','genesis_bind'].includes(operation)&&!state.installed)return unavailable('This target has no installed node.');
 if(operation==='vpn_enroll'){
  if(!vpnStatus)return unavailable('Read VPN status before enrolling.');
  if(vpnStatus.reconciliation_required)return unavailable('Reconcile the prior enrollment with the VPN control plane before retrying.');
  if(vpnStatus.enrollment_recorded)return unavailable('The target already has a recorded VPN enrollment.');
  if(!vpnStatus.service_registered||!vpnStatus.enrollment_staged)return unavailable('Register the node VPN service and wait for an approved one-use request.');
 }
 if(operation==='formation_preflight'&&formationRecord?.pending)return unavailable('This host already has verified prepared custody. Recover or export the same public registration.');
 if(operation==='formation_prepare'&&(
   formationRecord?.pending!==false||formationReview?.target!==JSON.stringify(target)||
   (form?.network_id&&formationReview.network_id!==form.network_id)||
   (form?.chain_id&&formationReview.chain_id!==form.chain_id)
 ))return unavailable('Read formation status and review the exact formation for this target and network.');
 if(['formation_export','genesis_stage','genesis_binding_preflight'].includes(operation)&&!formationRecord?.pending)return unavailable('Recover the verified prepared identity on this target first.');
 if(operation==='genesis_bind'&&(!formationRecord?.pending||bindingReview?.target!==JSON.stringify(target)||bindingReview?.bound!==false||bindingReview.address!==formationRecord.address))return unavailable('Verify the independently signed Genesis and review its exact identity binding before continuing.');
 if(operation==='commission'&&(!bindingReview?.bound||!vpnStatus?.connected||!vpnStatus?.server_bound))return unavailable('Verify the bound Genesis and read the connected, server-bound VPN status before commissioning.');
 let parameters={};
 if(operation==='formation_prepare')parameters={formation_sha256:formationReview.formation_sha256};
 if(operation==='genesis_bind')parameters={genesis_sha256:bindingReview.genesis_sha256};
 if(operation==='identity_generate'){
  if(identityReview?.target!==JSON.stringify(target)||!identityReview?.genesis_sha256)return unavailable('Verify and review the target’s signed Genesis before generating custody.');
  parameters={genesis_sha256:identityReview.genesis_sha256};
 }
 try{
  if(operation==='install'||operation==='install_preflight')parameters=installParameters(form);
  if(operation==='upgrade'||operation==='upgrade_preflight')parameters=updateParameters(form);
 }catch(error){return unavailable(error.message);}
 if(['install','upgrade','uninstall'].includes(operation)&&
   (review?.target!==JSON.stringify(target)||review?.scope!==approvedReviewScope(operation,parameters)))return unavailable('Run and review the matching preflight on this target first.');
 if(operation==='uninstall'){
  if(confirmation!==target.root)return unavailable(`Type ${target.root} to confirm removal.`);
  parameters={confirmation};
 }
 return {available:true,parameters};
}

export function identityView(value,generated){
 if(value?.genesis_authority_verified!==true||typeof value.network_id!=='string'||
    !/^[a-z0-9][a-z0-9_-]{1,127}$/.test(value.network_id)||typeof value.chain_id!=='string'||
    !/^[1-9][0-9]{0,19}$/.test(value.chain_id)||BigInt(value.chain_id)>18446744073709551615n||
    typeof value.genesis_sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.genesis_sha256)||
    generated&&(typeof value.address!=='string'||!/^synv1[0-9a-z]{10,90}$/.test(value.address)||
      value.possession_verified!==true||value.membership_granted!==false))throw Error('The controller did not confirm the authenticated identity operation.');
 return {network_id:value.network_id,chain_id:value.chain_id,genesis_sha256:value.genesis_sha256,
  genesis_authority_verified:true,...(generated?{address:value.address,possession_verified:true,membership_granted:false}:{})};
}

export function identityStatusView(value){
 if(value?.pending===false)return {pending:false};
 if(value?.pending===true)return {pending:true,...identityView(value,true)};
 throw Error('The controller did not confirm the pending custody state.');
}

export function diagnosticsView(value){
 if(value?.schema!=='nodenetwork-diagnostics-v1'||!Number.isSafeInteger(value.observed_at_ms)||value.observed_at_ms<0||value.observed_at_ms>8640000000000000)throw Error('The controller returned an unsupported diagnostics sample.');
 const nonnegative=n=>Number.isSafeInteger(n)&&n>=0?n:null;
 const label=v=>typeof v==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(v)?v:null;
 const fields=(object,names,read)=>Object.fromEntries(names.map(name=>[name,read(object?.[name])]));
 const service=v=>({state:label(v?.state),...fields(v,['pid','restarts','memory_bytes','cpu_usage_ns'],nonnegative)});
 const chain=value.installation?.chain_id;
 const chainId=typeof chain==='string'&&/^[1-9][0-9]{0,19}$/.test(chain)&&BigInt(chain)<=18446744073709551615n?chain:null;
 return {observedAt:value.observed_at_ms,installation:{...fields(value.installation,['role','network_id','node_name'],label),chain_id:chainId,package_sha256:/^[0-9a-f]{64}$/.test(value.installation?.package_sha256??'')?value.installation.package_sha256:null},services:{node:service(value.services?.node),vpn:service(value.services?.vpn)},storage:fields(value.storage,['capacity_bytes','available_bytes'],nonnegative),log:value.log?.available===true?{...fields(value.log,['size_bytes','window_bytes','complete_lines'],nonnegative),severity:fields(value.log.severity,['error','warn','info','debug','trace','unclassified'],nonnegative)}:null};
}

export function vpnView(value){
 const fields=['service_registered','enrollment_staged','enrollment_recorded','reconciliation_required','server_bound','connected'];
 if(value?.schema!=='nodenetwork-vpn-status-v1'||fields.some(key=>typeof value[key]!=='boolean')||(value.overlay_address!==null&&(typeof value.overlay_address!=='string'||!/^[0-9a-fA-F:.]{1,45}(?:\/[0-9]{1,3})?$/.test(value.overlay_address))))throw Error('The controller returned an unsupported VPN status.');
 return {...Object.fromEntries(fields.map(key=>[key,value[key]])),overlay_address:value.overlay_address};
}
