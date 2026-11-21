import {validInstallNetworkId, validNetworkChainId} from './nodeNetwork.js';

const pin=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const purposeFields=['format','purpose','formation_sha256','transport_review_sha256','issuer_root_sha256','gateway_enrollment_sha256','genesis_sha256','authority_sha256','registry_sha256','valid_from_unix','expires_at_unix'];
const bounded=(value,limit)=>typeof value==='string'&&new TextEncoder().encode(value).length<=limit&&value.length>0&&!value.includes('\0');
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function gatewayPrepareParameters({enrollmentJson,purposeJson}){
 if(!bounded(enrollmentJson,128*1024)||!bounded(purposeJson,16384))throw Error('Select bounded public gateway enrollment and additional-purpose approval JSON.');
 let purpose,enrollment;try{purpose=JSON.parse(purposeJson);enrollment=JSON.parse(enrollmentJson);}catch{throw Error('Gateway public inputs must be valid JSON.');}
 if(!enrollment||typeof enrollment!=='object'||Array.isArray(enrollment)||!exact(purpose,purposeFields)||purpose.format!=='synergy-engineering-gateway-purpose-v1'||purpose.purpose!=='engineering-rpc-gateway-admission-v1'||!['formation_sha256','transport_review_sha256','issuer_root_sha256','gateway_enrollment_sha256','genesis_sha256','authority_sha256','registry_sha256'].every(k=>pin(purpose[k]))||!Number.isSafeInteger(purpose.valid_from_unix)||purpose.valid_from_unix<=0||!Number.isSafeInteger(purpose.expires_at_unix)||purpose.expires_at_unix<=purpose.valid_from_unix||purpose.expires_at_unix-purpose.valid_from_unix>604800)throw Error('Gateway purpose approval must bind the exact signed origin and a bounded engineering validity window.');
 if(purpose.gateway_enrollment_sha256!==await hash(enrollmentJson))throw Error('Gateway enrollment differs from its additional-purpose approval.');
 return {formation_sha256:purpose.formation_sha256,transport_review_sha256:purpose.transport_review_sha256,gateway_enrollment_json:enrollmentJson,purpose_approval_json:purposeJson,purpose_approval_sha256:await hash(purposeJson),valid_from_unix:purpose.valid_from_unix,expires_at_unix:purpose.expires_at_unix};
}

export function gatewaySignParameters(review){
 if(!review?.pending||review.signed!==false||!pin(review.review_sha256)||!pin(review.purpose_approval_sha256))throw Error('Read and review the exact unsigned gateway admission first.');
 return {review_sha256:review.review_sha256,purpose_approval_sha256:review.purpose_approval_sha256};
}

const reviewFields=['schema','pending','signed','request_sha256','review_sha256','purpose_approval_sha256','formation_sha256','network_id','chain_id','genesis_sha256','authority_sha256','registry_sha256','gateway_address','gateway_enrollment_sha256','valid_from_unix','expires_at_unix','admission_sha256','sign_request_sha256','gateway_commissioned','services_started','public_listener','production_qualified','automatic_retry','available','blocker'];
const address=v=>typeof v==='string'&&/^synv5[a-z0-9]+$/.test(v)&&v.length<=128;
export function gatewayAdmissionView(value,operation='gateway_admission_status',parameters={}){
 const exporting=operation==='gateway_admission_export',fields=exporting?[...reviewFields,'admission_json']:reviewFields;
 const fail=()=>{throw Error('Unsupported gateway admission observation; no service or outcome was inferred.');};
 if(!exact(value,fields)||value.schema!=='nodenetwork-gateway-admission-v1'||!['gateway_commissioned','services_started','public_listener','production_qualified','automatic_retry'].every(k=>value[k]===false))fail();
 if(value.pending===false){if(exporting||value.signed!==false||!(value.available===true&&value.blocker===null||value.available===false&&['gateway_runtime_or_origin_unavailable','gateway_purpose_approval_required'].includes(value.blocker))||reviewFields.slice(3,18).some(k=>value[k]!==null))fail();}
 else{
  if(value.pending!==true||typeof value.signed!=='boolean'||value.available!==true||value.blocker!==null
    ||!['request_sha256','review_sha256','purpose_approval_sha256','formation_sha256','genesis_sha256','authority_sha256','registry_sha256','gateway_enrollment_sha256'].every(k=>pin(value[k]))
    ||!address(value.gateway_address)||!validInstallNetworkId(value.network_id)
    ||!validNetworkChainId(value.chain_id)
    ||!Number.isSafeInteger(value.valid_from_unix)||value.valid_from_unix<=0
    ||!Number.isSafeInteger(value.expires_at_unix)||value.expires_at_unix<=value.valid_from_unix
    ||value.expires_at_unix-value.valid_from_unix>604800)fail();
  if(value.signed){if(!pin(value.admission_sha256)||!pin(value.sign_request_sha256))fail();}else if(value.admission_sha256!==null||value.sign_request_sha256!==null||exporting)fail();
 }
 if(operation==='gateway_admission_prepare'&&(!value.pending||value.signed||['formation_sha256','purpose_approval_sha256','valid_from_unix','expires_at_unix'].some(k=>value[k]!==parameters[k])))fail();
 if(operation==='gateway_admission_sign'&&(!value.signed||['review_sha256','purpose_approval_sha256'].some(k=>value[k]!==parameters[k])))fail();
 if(operation==='gateway_admission_reconcile'&&value.pending&&value.request_sha256!==parameters.request_sha256&&(!value.signed||value.sign_request_sha256!==parameters.request_sha256))fail();
 if(exporting&&!bounded(value.admission_json,128*1024))fail();
 return {...value};
}
export function gatewayCapability(state,operation){
 const kind=['gateway_admission_prepare','gateway_admission_sign'].includes(operation)?'mutation':'read';
 const rows=state?.operations?.filter(row=>row?.operation===operation)??[];
 return state?.installed===true&&rows.length===1&&rows[0].kind===kind&&(rows[0].available===true||state.engineeringContinuation===true&&rows[0].engineeringContinuation===true);
}
