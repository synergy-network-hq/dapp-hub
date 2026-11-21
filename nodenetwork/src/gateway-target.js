// Target custody stays on its own host. These engineering observations do not
// authorize issuance, service activation, a public listener or Wallet trust.
import {installParameters, validInstallNetworkId, validNetworkChainId} from './nodeNetwork.js';
import {sameNetworkProfile, validateNetworkProfile} from './network-provisioning.js';

const pin=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const bounded=(value,limit)=>typeof value==='string'&&value.length>0
 &&!value.includes('\0')&&new TextEncoder().encode(value).length<=limit;
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
const scopeFields=['network_id','chain_id','genesis_sha256'];
const identityFields=['generation_request_sha256','gateway_address','enrollment_sha256'];
const commissionFields=['commission_request_sha256','admission_sha256','configuration_sha256'];
const noActivation=['services_started','public_listener','production_qualified','automatic_retry'];
const fields=['schema','available','blocker','state',...scopeFields,...identityFields,...commissionFields,'transport_custody_verified',...noActivation];
const reads=new Set(['gateway_install_preflight','gateway_install_status','gateway_target_preflight','gateway_target_status','gateway_target_export','gateway_target_configuration','gateway_target_reconcile']);
const mutations=new Set(['gateway_install','gateway_target_generate','gateway_target_commission']);
const address=value=>typeof value==='string'&&/^synv5[a-z0-9]+$/.test(value)&&value.length<=128;

export function gatewayTargetCapability(target,operation){
 const kind=reads.has(operation)?'read':mutations.has(operation)?'mutation':null;
 if(!kind||!target||typeof target.installed!=='boolean'||!Array.isArray(target.operations)||target.operations.length>100)return false;
 if((operation==='gateway_install'||operation==='gateway_install_preflight')?target.installed:!target.installed)return false;
 const rows=target.operations.filter(row=>row?.operation===operation);
 return rows.length===1&&rows[0].kind===kind&&(rows[0].available===true
  ||target.engineeringContinuation===true&&rows[0].engineeringContinuation===true);
}

export function gatewayInstallParameters(form, profile){
 const parameters = installParameters(form);
 if (profile && (profile.role !== 'rpc_gateway' || profile.network_id !== parameters.network_id
   || profile.chain_id !== parameters.chain_id || profile.node_name !== parameters.node_name)) {
  throw Error('The selected network profile differs from the gateway installation draft.');
 }
 return parameters;
}

export function gatewayGenerateParameters(review){
 if(review?.state!=='ready'||review.available!==true||!pin(review.genesis_sha256))throw Error('Read the native verified gateway origin before generating custody.');
 return {genesis_sha256:review.genesis_sha256};
}

export function gatewayProfileConfiguration(value, selectedProfile) {
 if (!exact(value, ['schema','profile','profile_sha256','configuration_json','installed'])
   || value.schema !== 'nodenetwork-gateway-profile-configuration-v1'
   || !pin(value.profile_sha256) || !bounded(value.configuration_json, 64 * 1024)
   || typeof value.installed !== 'boolean'
   || !sameNetworkProfile(validateNetworkProfile(value.profile), selectedProfile)) {
  throw Error('Authenticated configuration differs from the selected network profile.');
 }
 return value;
}

export function gatewayInstallView(value,operation,parameters){
 const preflight=operation==='gateway_install_preflight';
 const keys=preflight?['release','root','packageVerified','networkSelectionApproved','genesisAuthorityVerified','activationAuthorized']
  :['schema','root','role','release_id','manifest_sha256','network_id','chain_id','node_name','declared_members','host_integrations_registered','consensus_started'];
 if(!exact(value,keys)||value.root!=='/opt/synergy'||(preflight
  ?value.release!==parameters.release_id||value.packageVerified!==true||value.networkSelectionApproved!==true||value.genesisAuthorityVerified!==false||value.activationAuthorized!==false
  :value.schema!=='nodenetwork-installed-gateway-v1'||value.role!=='rpc_gateway'
   ||['release_id','manifest_sha256','network_id','node_name'].some(key=>value[key]!==parameters[key])||value.chain_id!==String(parameters.chain_id)
   ||!Number.isSafeInteger(value.declared_members)||value.declared_members<=0||value.declared_members>4096||value.host_integrations_registered!==false||value.consensus_started!==false)){
  throw Error('Gateway software installation was not verified for this exact release and network.');
 }
 return {...value};
}

export async function gatewayCommissionParameters({admissionJson,configurationJson}){
 if(!bounded(admissionJson,128*1024)||!bounded(configurationJson,64*1024))throw Error('Select bounded public admission and configuration JSON. Private custody, unlocks and file paths are not accepted.');
 let admission,configuration;try{admission=JSON.parse(admissionJson);configuration=JSON.parse(configurationJson);}catch{throw Error('Gateway admission and configuration must be valid public JSON.');}
 if(!admission||typeof admission!=='object'||Array.isArray(admission)
  ||!exact(configuration,['node_configuration','relay_specification'])
  ||!configuration.node_configuration||typeof configuration.node_configuration!=='object'||Array.isArray(configuration.node_configuration)
  ||!exact(configuration.relay_specification,['listen_address','role']))throw Error('Use the reviewed gateway node configuration and canonical relay specification.');
 return {admission_json:admissionJson,admission_sha256:await sha(admissionJson),configuration_json:configurationJson,configuration_sha256:await sha(configurationJson)};
}

export async function gatewayTargetView(value,operation='gateway_target_status',parameters={}){
 const exporting=operation==='gateway_target_export';
 const fail=()=>{throw Error('Unsupported gateway target observation. No custody, service or request outcome was inferred.');};
 if(!exact(value,exporting?[...fields,'enrollment_json']:fields)||value.schema!=='nodenetwork-gateway-target-v1'
  ||typeof value.available!=='boolean'||typeof value.transport_custody_verified!=='boolean'
  ||!noActivation.every(key=>value[key]===false)
  ||!['absent','ready','identity_ready','commissioned','uncertain'].includes(value.state))fail();
 if(value.available){if(value.blocker!==null||!['ready','identity_ready','commissioned'].includes(value.state))fail();}
 else if(!['owner_unavailable','origin_required','reconciliation_required'].includes(value.blocker)||!['absent','uncertain'].includes(value.state))fail();
 if(['ready','identity_ready','commissioned'].includes(value.state)){
  if(!validInstallNetworkId(value.network_id)||!validNetworkChainId(value.chain_id)||!pin(value.genesis_sha256))fail();
 }else if(!scopeFields.every(key=>value[key]===null))fail();
 if(['identity_ready','commissioned'].includes(value.state)){
  if(!pin(value.generation_request_sha256)||!address(value.gateway_address)||!pin(value.enrollment_sha256))fail();
 }else if(!identityFields.every(key=>value[key]===null))fail();
 if(value.state==='commissioned'){
  if(!commissionFields.every(key=>pin(value[key]))||value.transport_custody_verified!==true)fail();
 }else if(!commissionFields.every(key=>value[key]===null)||value.transport_custody_verified!==false)fail();
 if(exporting){if(!['identity_ready','commissioned'].includes(value.state)||!bounded(value.enrollment_json,128*1024)||await sha(value.enrollment_json)!==value.enrollment_sha256)fail();}
 if(operation==='gateway_target_generate'&&(value.state!=='identity_ready'||value.genesis_sha256!==parameters.genesis_sha256))fail();
 if(operation==='gateway_target_commission'&&(value.state!=='commissioned'||value.admission_sha256!==parameters.admission_sha256||value.configuration_sha256!==parameters.configuration_sha256))fail();
 if(operation==='gateway_target_reconcile'){
  const generated=['identity_ready','commissioned'].includes(value.state)&&value.generation_request_sha256===parameters.request_sha256;
  const commissioned=value.state==='commissioned'&&value.commission_request_sha256===parameters.request_sha256;
  if(!generated&&!commissioned)fail();
 }
 return {...value};
}

export function gatewayInstallStatusView(value,parameters){
 const keys=['schema','request_sha256','request','installation','origin_verified','install_audit_verified','grant_absent','services_started'];
 if(!exact(value,keys)||value.schema!=='nodenetwork-gateway-install-status-v1'||value.request_sha256!==parameters.request_sha256
  ||!pin(value.request_sha256)||value.origin_verified!==true||value.install_audit_verified!==true||value.grant_absent!==true||value.services_started!==false
  ||!exact(value.request,['version','operation','parameters'])||value.request.version!==1||value.request.operation!=='gateway_install'
  ||!exact(value.request.parameters,['release_id','manifest_sha256','network_id','chain_id','node_name']))throw Error('Gateway installation did not verify the exact original request. Its fence remains.');
 const original=value.request.parameters;
 gatewayInstallParameters({...original,chain_id:String(original.chain_id)});
 gatewayInstallView(value.installation,'gateway_install',original);
 return {...value};
}
