import {localSha256} from './local-sha256.js';

const digest=value=>typeof value==='string'&&value.length===64&&!/[^0-9a-f]/.test(value);
const common=['network_id','chain_id','genesis_sha256','genesis_authority_verified'];

// Public DTOs from the compatible legacy owner and optional c92/a984 contract.
// Permission, exact target and release qualification remain native boundaries.
export function identityEvidence(value,kind) {
 const invalid=()=>{throw Error('Unsupported identity request evidence.');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const required=kind==='preflight'?common:[...common,'address','possession_verified','membership_granted',...(kind==='status'?['pending']:[])];
 if(!['preflight','generation','status'].includes(kind)||required.some(key=>!Object.hasOwn(value,key)))return invalid();
 if(!Object.hasOwn(value,'schema')) {
  if(Object.keys(value).length!==required.length)return invalid();
  return null;
 }
 if(value.schema!=='nodenetwork-existing-identity-network-v1'||value.membership_granted!==false)return invalid();
 const staged=Object.hasOwn(value,'stage_request_sha256');
 const attributed=Object.hasOwn(value,'request_sha256');
 if(staged&&!digest(value.stage_request_sha256)||attributed&&!digest(value.request_sha256)
  ||kind==='preflight'&&attributed||kind==='generation'&&!attributed)return invalid();
 const expected=new Set([...required,'schema','membership_granted',...(staged?['stage_request_sha256']:[]),...(attributed?['request_sha256']:[])]);
 if(Object.keys(value).length!==expected.size||Object.keys(value).some(key=>!expected.has(key)))return invalid();
 return {existingNetworkScoped:true,stagingReceiptRecorded:staged,identityRequestRecorded:attributed};
}

export async function verifyIdentityRequest(value,kind) {
 const evidence=identityEvidence(value,kind);
 if(evidence?.identityRequestRecorded) {
  if(!digest(value.genesis_sha256))throw Error('Unsupported identity request evidence.');
  // Owner canonical() uses sorted compact ASCII JSON. Every parameter here is hex.
  const canonical=JSON.stringify({operation:'identity_generate',parameters:{genesis_sha256:value.genesis_sha256},version:1});
  if(await localSha256(new TextEncoder().encode(canonical))!==value.request_sha256) {
   throw Error('The controller identity request receipt differs from its verified Genesis input.');
  }
 }
}
