import {installPreflightObservation} from './install-preflight.js';
import {upgradePreflightObservation} from './upgrade-preflight.js';
import {removalPreflightObservation} from './removal-preflight.js';
import {controllerOperation,installParameters,provisioningChecks} from './nodeNetwork.js';

export const NODE_ROLES=Object.freeze([
 Object.freeze({id:'validator',label:'Validator',description:'Run PoSy consensus on an admitted host with its own APQE custody.'}),
 Object.freeze({id:'rpc_gateway',label:'RPC gateway',description:'Configure a PoSy RPC relay with its own APQE custody, signed admission and VPN enrollment.'}),
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
 try{
  if(operation==='install_preflight'){installPreflightObservation(response,parameters,target);return true;}
  if(operation==='upgrade_preflight'){upgradePreflightObservation(response,parameters);return true;}
  if(operation==='uninstall_preflight'){removalPreflightObservation(response);return response.root===target.root;}
 }catch{return false;}
 return false;
}


// Mirror the canonical controller operation kinds; declarations cannot reclassify a read as a mutation.
const READS=new Set(["gateway_vpn_preflight","upgrade_native_preflight","treasury_preflight", "treasury_status", "treasury_export", "commissioning_observation", "network_transport_status", "network_transport_export", "guest_resources", "guest_preflight", "guest_status", "target", "inventory", "health", "install_preflight", "upgrade_preflight", "recovery_preflight", "uninstall_preflight", "vpn_status", "vpn_diagnostics", "vpn_stop_status", "vpn_resume_status", "boot_policy_status", "diagnostics", "identity_preflight", "identity_status", "formation_preflight", "formation_status", "formation_export", "genesis_stage_preflight", "genesis_binding_preflight", "authorization_status", "network_formation_status", "network_formation_export"]);
const MUTATIONS=new Set(["treasury_send_prepare", "treasury_send_submit", "treasury_prepare", "network_transport_prepare", "network_transport_sign", "guest_create", "guest_stop", "guest_remove", "install", "commission", "register", "vpn_enroll", "vpn_bind", "vpn_retire", "vpn_stop", "vpn_resume", "boot_policy", "start", "stop", "restart", "upgrade", "uninstall", "identity_generate", "formation_prepare", "genesis_stage", "genesis_bind", "network_formation_prepare", "network_formation_sign"]);

export function workflowGate({target,state,permitted,operation,form,review,confirmation,vpnStatus,identityReview,formationReview,formationRecord,bindingReview,networkReview}){
 const unavailable=blocker=>({available:false,blocker});
 if(!permitted)return unavailable('Allow NodeNetwork inspection in Security & permissions.');
 if(!state)return unavailable('Inspect the selected target first.');
 const canonicalOperation=operation==='genesis_stage_existing'?'genesis_stage':operation;
 const capability=controllerOperation(state,canonicalOperation);
 if(!capability.available)return capability;
 const expectedKind=READS.has(canonicalOperation)?'read':MUTATIONS.has(canonicalOperation)?'mutation':null;
 const declarations=state.operations.filter(entry=>entry?.operation===canonicalOperation);
 if(!expectedKind||declarations.length!==1||declarations[0].kind!==expectedKind)return unavailable('The controller capability kind differs from the supported operation. Inspect the selected target again.');
 if((operation==='install'||operation==='install_preflight')&&state.installed)return unavailable('A node is already installed. Use Updates for a qualified replacement.');
 if(['commission','register','start','stop','restart','upgrade','upgrade_preflight','upgrade_native_preflight','uninstall','uninstall_preflight','health','recovery_preflight','vpn_status','vpn_diagnostics','vpn_stop_status','vpn_resume_status','boot_policy_status','boot_policy','vpn_stop','vpn_resume','vpn_enroll','identity_preflight','identity_status','identity_generate','formation_preflight','formation_prepare','formation_status','formation_export','genesis_stage','genesis_stage_existing','genesis_binding_preflight','genesis_bind'].includes(operation)&&!state.installed)return unavailable('This target has no installed node.');
 if(operation==='network_formation_prepare'&&(!state.installed||!formationRecord?.pending||networkReview?.pending))return unavailable('Read the prepared formation identity and reconcile any existing network before preparing another.');
 if(operation==='network_formation_sign'&&(!networkReview?.pending||networkReview.signed||networkReview.target!==JSON.stringify(target)))return unavailable('Read and review the exact unsigned Genesis on this target before signing.');
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
 if(operation==='genesis_stage_existing'){
  if(formationRecord?.pending)return unavailable('Prepared formation custody already exists on this target.');
  if(provisioningChecks(form).slice(2,4).some(check=>!check.valid))return unavailable('Select the existing network and chain before staging its signed Genesis.');
 }
 if(operation==='genesis_bind'&&(!formationRecord?.pending||bindingReview?.target!==JSON.stringify(target)||bindingReview?.bound!==false||bindingReview.address!==formationRecord.address))return unavailable('Verify the independently signed Genesis and review its exact identity binding before continuing.');
 if(operation==='commission'&&(!bindingReview?.bound||!vpnStatus?.connected||!vpnStatus?.server_bound))return unavailable('Verify the bound Genesis and read the connected, server-bound VPN status before commissioning.');
 let parameters={};
 if(operation==='network_formation_sign')parameters={review_sha256:networkReview.review_sha256};
 if(operation==='formation_prepare')parameters={formation_sha256:formationReview.formation_sha256};
 if(operation==='genesis_bind')parameters={genesis_sha256:bindingReview.genesis_sha256};
 if(operation==='identity_generate'){
  if(identityReview?.target!==JSON.stringify(target)||!identityReview?.genesis_sha256||
     (form?.network_id&&form.network_id!==identityReview.network_id)||(form?.chain_id&&form.chain_id!==identityReview.chain_id))return unavailable('Verify and review the target’s signed Genesis before generating custody.');
  parameters={genesis_sha256:identityReview.genesis_sha256};
 }
 try{
  if(operation==='install'||operation==='install_preflight')parameters=installParameters(form);
  if(['upgrade','upgrade_preflight','upgrade_native_preflight'].includes(operation))parameters=updateParameters(form);
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

export function unusedVpnCancellationView(value){
 const pin=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
 if(value?.schema!=='nodenetwork-vpn-unused-cancellation-v1'||value.cancelled!==true||
    value.retry_requires_new_confirmation!==true||!pin(value.attempt_sha256)||!pin(value.cancellation_sha256))
  throw Error('The target did not verify cancellation of the unused VPN attempt. Do not enroll again.');
 return {cancelled:true,retry_requires_new_confirmation:true,attempt_sha256:value.attempt_sha256,cancellation_sha256:value.cancellation_sha256};
}

// Diagnostics are observations only. Never expose raw logs or infer enrollment
// success from a live client, a provider-issued key or a reachable peer.
export function vpnDiagnosticsView(value){
 const fail=()=>{throw Error('The controller returned unsupported VPN diagnostics.');};
 const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
 const flag=v=>typeof v==='boolean';
 const literalIp=v=>{
  if(typeof v!=='string'||v.length>45)return false;
  if(!v.includes(':'))return /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(v)&&v.split('.').every(p=>Number(p)<=255);
  if(!/^[0-9a-fA-F:.]+$/.test(v))return false;
  try{return new URL(`https://[${v}]/`).hostname.startsWith('[');}catch{return false;}
 };
 const cidr=v=>{if(typeof v!=='string')return false;const parts=v.split('/');return parts.length===2&&literalIp(parts[0])&&/^(0|[1-9][0-9]{0,2})$/.test(parts[1])&&Number(parts[1])<=(parts[0].includes(':')?128:32);};
 const oneOf=(v,allowed)=>v===null||allowed.includes(v);
 if(value?.schema!=='nodenetwork-vpn-diagnostics-v1'||!time(value.observed_at_ms)||value.mutation_performed!==false)fail();
 const fields=['service_registered','enrollment_staged','enrollment_recorded','reconciliation_required','server_bound'];
 if(fields.some(k=>!flag(value.enrollment?.[k])))fail();
 const t=value.trust,c=value.client,l=value.log;
 if(!t||!oneOf(t.mode,['approved_private_ca','system'])||!oneOf(t.error_code,['approved_trust_scope_refused']))fail();
 if(!c||!flag(c.available)||!oneOf(c.management_connected,[true,false])||!oneOf(c.signal_connected,[true,false])||
   !(c.wireguard_public_key===null||typeof c.wireguard_public_key==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(c.wireguard_public_key))||
   !(c.overlay_address===null||cidr(c.overlay_address))||!oneOf(c.error_code,['client_status_timeout','client_status_unavailable']))fail();
 if(!Array.isArray(value.peers)||value.peers.length>5||new Set(value.peers.map(p=>p?.ip)).size!==value.peers.length||value.peers.some(p=>!literalIp(p?.ip)||!flag(p.route_via_wt0)||!flag(p.reachable)||!oneOf(p.error_code,['peer_unreachable','peer_route_unavailable'])))fail();
 let roster;
 if(Object.hasOwn(value,'roster')){
  const r=value.roster,exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const address=v=>typeof v==='string'&&/^synv1[0-9a-z]{10,90}$/.test(v);
  const publicKey=v=>typeof v==='string'&&/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(v);
  if(!exact(r,['available','error_code','source','peer_status_sample','local_address','peers'])||!flag(r.available)||r.source!=='approved_signed_transport'||r.peer_status_sample!=='before_probes'||!(r.local_address===null||address(r.local_address))||!Array.isArray(r.peers))fail();
  if(r.available){if(r.error_code!==null||!address(r.local_address)||r.peers.length!==4)fail();}
  else if(!['scope_unavailable','status_unavailable'].includes(r.error_code)||r.peers.length!==0||(r.error_code==='status_unavailable'&&!address(r.local_address)))fail();
  const seenAddresses=new Set(),seenIps=new Set();
  const peers=r.peers.map(p=>{
   if(!exact(p,['address','ip','match_count','matches','route_via_wt0','reachable','error_code'])||!address(p.address)||p.address===r.local_address||seenAddresses.has(p.address)||!literalIp(p.ip)||seenIps.has(p.ip)||!Number.isInteger(p.match_count)||p.match_count<0||p.match_count>1024||!Array.isArray(p.matches)||p.matches.length!==Math.min(p.match_count,5)||!flag(p.route_via_wt0)||!flag(p.reachable)||(p.reachable&&!p.route_via_wt0)||!oneOf(p.error_code,['peer_missing','peer_duplicate','peer_not_connected','peer_route_unavailable','peer_unreachable']))fail();
   seenAddresses.add(p.address);seenIps.add(p.ip);
   const matches=p.matches.map(m=>{if(!exact(m,['wireguard_public_key','public_key_format_valid','status'])||!flag(m.public_key_format_valid)||(m.public_key_format_valid?!publicKey(m.wireguard_public_key):m.wireguard_public_key!==null)||!['Connected','Connecting','Disconnected','Idle','unknown'].includes(m.status))fail();return {wireguard_public_key:m.wireguard_public_key,public_key_format_valid:m.public_key_format_valid,status:m.status};});
   return {address:p.address,ip:p.ip,match_count:p.match_count,matches,route_via_wt0:p.route_via_wt0,reachable:p.reachable,error_code:p.error_code};
  });
  roster={available:r.available,error_code:r.error_code,source:r.source,peer_status_sample:r.peer_status_sample,local_address:r.local_address,peers};
 }
 const codes=['launcher_import_failure','tls_untrusted','tls_expired','tls_name_mismatch','setup_key_rejected','transport_timeout','connection_refused','interface_permission'];
 if(!l||!flag(l.available)||!(l.modified_at_ms===null||time(l.modified_at_ms))||!Number.isSafeInteger(l.sampled_bytes)||l.sampled_bytes<0||l.sampled_bytes>65536||!Array.isArray(l.codes)||l.codes.some(x=>!codes.includes(x))||JSON.stringify(l.codes)!==JSON.stringify([...new Set(l.codes)].sort()))fail();
 return {observed_at_ms:value.observed_at_ms,enrollment:Object.fromEntries(fields.map(k=>[k,value.enrollment[k]])),
  trust:{mode:t.mode,error_code:t.error_code},client:{available:c.available,management_connected:c.management_connected,signal_connected:c.signal_connected,wireguard_public_key:c.wireguard_public_key,overlay_address:c.overlay_address,error_code:c.error_code},
  peers:value.peers.map(p=>({ip:p.ip,route_via_wt0:p.route_via_wt0,reachable:p.reachable,error_code:p.error_code})),
  log:{available:l.available,modified_at_ms:l.modified_at_ms,sampled_bytes:l.sampled_bytes,codes:[...l.codes]},...(roster?{roster}:{}),mutation_performed:false};
}

export function authorizationView(value){
 if(value?.schema==='nodenetwork-engineering-authorization-status-v1'&&value.authorization===null)return {approved:false};
 const receipt=value?.schema==='nodenetwork-engineering-authorization-status-v1'?value.authorization:
  value?.schema==='nodenetwork-engineering-authorization-v1'&&value.applied===true&&value.grants_recreated===false?value:null;
 if(!receipt||typeof receipt.sha256!=='string'||!/^[0-9a-f]{64}$/.test(receipt.sha256)||
  !Number.isSafeInteger(receipt.sequence)||receipt.sequence<1||!Number.isSafeInteger(receipt.expires_at)||receipt.expires_at<0)
  throw Error('The target did not confirm its exact engineering authorization receipt.');
 return {approved:true,sha256:receipt.sha256,sequence:receipt.sequence,expires_at:receipt.expires_at};
}

export function updateStageView(value){
 const pin=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
 if(value?.schema!=='nodenetwork-update-stage-v1'||typeof value.stagedRelease!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(value.stagedRelease)||!pin(value.manifestSha256)||!pin(value.initial_sha256)||!pin(value.parent_sha256)||value.controllerAdopted!==true||value.validatorUpgraded!==false)throw Error('The target did not confirm exact native-reviewed update staging.');
 return {release_id:value.stagedRelease,manifest_sha256:value.manifestSha256,controllerAdopted:true,validatorUpgraded:false};
}

export function vpnStopView(value){
 if(!value||Object.keys(value).sort().join(',')!=='attempt_preserved,provider_action,schema,stopped'||value.schema!=='nodenetwork-vpn-stop-v1'||value.stopped!==true||value.attempt_preserved!==true||value.provider_action!==false)throw Error('VPN stop outcome is uncertain; read diagnostics before another action.');
 return {schema:value.schema,stopped:true,attempt_preserved:true,provider_action:false};
}

export function vpnStopStatusView(value){
 const stopped=vpnStopView({schema:'nodenetwork-vpn-stop-v1',stopped:true,attempt_preserved:value?.attempt_preserved,provider_action:value?.provider_action});
 if(!value||Object.keys(value).sort().join(',')!=='attempt_preserved,provider_action,request_sha256,schema,stopped'||value.schema!=='nodenetwork-vpn-stop-status-v1'||!((value.stopped===false&&value.request_sha256===null)||(value.stopped===true&&/^[a-f0-9]{64}$/.test(value.request_sha256))))throw Error('Unsupported VPN stop reconciliation evidence.');
 return {...stopped,schema:value.schema,stopped:value.stopped,request_sha256:value.request_sha256};
}

// The stage response may adopt only its exact release/hash into the same draft.
// This token is local UI correlation, never a preflight or authorization grant.
export function controllerDraftScope(targetKey,permitted,form){
 return JSON.stringify([targetKey,permitted,form.release_id,form.manifest_sha256,form.network_id,form.chain_id,form.node_name]);
}
export function retainedUpdateStageReceipt(adoption,previousScope,currentScope){
 if(!adoption||adoption.fromScope!==previousScope||adoption.toScope!==currentScope||previousScope===currentScope||adoption.record?.operation!=='update_stage')return null;
 try{
  const before=JSON.parse(previousScope),after=JSON.parse(currentScope),response=adoption.record.response;
  if(before.length!==7||after.length!==7||[0,1,4,5,6].some(index=>before[index]!==after[index])||after[1]!==true||after[2]!==response.release_id||after[3]!==response.manifest_sha256||response.controllerAdopted!==true||response.validatorUpgraded!==false)return null;
  return adoption.record;
 }catch{return null;}
}

export function vpnResumeView(value){
 if(!value||Object.keys(value).sort().join(',')!=='enrollment_preserved,resumed,schema,validator_started'||value.schema!=='nodenetwork-vpn-resume-v1'||value.resumed!==true||value.validator_started!==false||value.enrollment_preserved!==true)throw Error('VPN resume outcome uncertain; read resume status before another action.');
 return {...value};
}
export function vpnResumeStatusView(value){
 if(!value||Object.keys(value).sort().join(',')!=='enrollment_preserved,request_sha256,resumed,schema,validator_started'||value.schema!=='nodenetwork-vpn-resume-status-v1'||value.validator_started!==false||value.enrollment_preserved!==true||!((value.resumed===false&&value.request_sha256===null)||(value.resumed===true&&/^[a-f0-9]{64}$/.test(value.request_sha256))))throw Error('Unsupported exact VPN resume reconciliation.');
 return {...value};
}

export function bootPolicyParameters(value,target){
 if(!value||Object.keys(value).sort().join(',')!=='enabled,service'||!['node','vpn'].includes(value.service)||typeof value.enabled!=='boolean')throw Error('Choose one service and an exact boot policy.');
 if(value.enabled&&target?.guest)throw Error('Managed guest boot enablement is unavailable.');
 return {service:value.service,enabled:value.enabled};
}
export function bootPolicyView(value,request){
 if(!value||Object.keys(value).sort().join(',')!=='enabled,runtime_changed,schema,service'||value.schema!=='nodenetwork-boot-policy-v1'||value.runtime_changed!==false||value.service!==request.service||value.enabled!==request.enabled)throw Error('Boot policy outcome uncertain; read boot policy status before another change.');
 return {...value};
}
export function bootPolicyStatusView(value){
 if(!value||Object.keys(value).sort().join(',')!=='applied,node_enabled,request_sha256,runtime_changed,schema,vpn_enabled'||value.schema!=='nodenetwork-boot-policy-status-v1'||typeof value.node_enabled!=='boolean'||typeof value.vpn_enabled!=='boolean'||value.runtime_changed!==false||!((value.applied===false&&value.request_sha256===null)||(value.applied===true&&typeof value.request_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.request_sha256))))throw Error('Unsupported observed boot policy.');
 return {...value};
}
