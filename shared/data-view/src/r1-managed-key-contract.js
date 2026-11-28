// Public wire formatting only. Native APQE owns scope parsing, authorization,
// generation, sealing and current authority. A correlated receipt is not proof.
const MAX_U64 = 18446744073709551615n;
const PARAMS = ['release_id','manifest_sha256','slot_ref','role','algorithm',
  'key_generation','operation_nonce_hex','creation_scope_frame_hex',
  'creation_scope_commitment_hex','provider_report_sha256','profile_catalog_commitment_hex'];
const SIZES = Object.freeze({'ML-DSA-87':2592,'ML-DSA-65':1952,'ML-KEM-1024':1568});
function fail() { throw new TypeError('Unsupported current managed key contract'); }
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const keys=Object.keys(value);
  if (keys.length!==fields.length || !fields.every(k=>Object.hasOwn(value,k))) fail();
}
function text(value) {
  if (typeof value!=='string' || !/^[!-~]{1,120}$/.test(value)) fail();
  return value;
}
function hex(value, width, nonzero=false) {
  if (typeof value!=='string' || value.length!==width || !/^[a-f0-9]+$/.test(value)
      || (nonzero && !/[1-9a-f]/.test(value))) fail();
  return value;
}
function generation(value) {
  if (typeof value!=='string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value)>MAX_U64) fail();
  return value;
}
export function r1ManagedKeyCreationRequest(parameters) {
  exact(parameters,PARAMS);
  text(parameters.release_id);text(parameters.slot_ref);text(parameters.role);
  if (!Object.hasOwn(SIZES,parameters.algorithm)) fail();
  generation(parameters.key_generation);
  for (const key of ['manifest_sha256','operation_nonce_hex','provider_report_sha256'])
    hex(parameters[key],64,true);
  for (const key of ['creation_scope_commitment_hex','profile_catalog_commitment_hex'])
    hex(parameters[key],128,true);
  const frame=parameters.creation_scope_frame_hex;
  if (typeof frame!=='string' || frame.length<2 || frame.length>8192 || frame.length%2) fail();
  hex(frame,frame.length);
  const copy=Object.freeze(Object.fromEntries(PARAMS.map(k=>[k,parameters[k]])));
  return Object.freeze({version:1,operation:'r1_identity_generate',parameters:copy});
}
export function r1ManagedKeyStatusRequest(slot_ref, original_request_sha256) {
  text(slot_ref);hex(original_request_sha256,64);
  return Object.freeze({version:1,operation:'r1_identity_status',
    parameters:Object.freeze({slot_ref,original_request_sha256})});
}
function replyResult(reply) {
  exact(reply,['version','ok','result']);
  if (reply.version!==1 || reply.ok!==true) fail();
  return reply.result;
}
function publicKey(value, expected) {
  exact(value,['role','algorithm','key_generation','full_public_key_hex']);
  if (!Object.hasOwn(SIZES,value.algorithm)) fail();
  text(value.role);generation(value.key_generation);
  hex(value.full_public_key_hex,SIZES[value.algorithm]*2);
  if (expected && ['role','algorithm','key_generation'].some(k=>value[k]!==expected[k])) fail();
  return Object.freeze({...value});
}
// expectedRequestSha256 must come from the independently retained native
// dispatch. This never calculates or authorizes that dispatch in JavaScript.
export function correlateR1SealedKeyReceipt(reply, parameters, expectedRequestSha256) {
  const request=r1ManagedKeyCreationRequest(parameters);
  hex(expectedRequestSha256,64);
  const r=replyResult(reply);
  exact(r,['schema','stage','request_sha256','slot_ref','key_generation',
    'public_key_record','envelope_commitment_hex','runtime_authority_granted']);
  if (r.schema!=='synergy-r1-managed-sealed-key-v1' || r.stage!=='sealed_pending'
      || r.runtime_authority_granted!==false || r.request_sha256!==expectedRequestSha256
      || r.slot_ref!==request.parameters.slot_ref || r.key_generation!==request.parameters.key_generation) fail();
  hex(r.envelope_commitment_hex,128);
  return Object.freeze({...r,public_key_record:publicKey(r.public_key_record,request.parameters)});
}
export function correlateR1ManagedKeyStatus(reply, slot_ref, original_request_sha256) {
  const request=r1ManagedKeyStatusRequest(slot_ref,original_request_sha256);
  const r=replyResult(reply);
  const sealed=r.stage==='sealed_pending';
  exact(r,['schema','slot_ref','original_request_sha256','runtime_authority_granted','stage',
    ...(sealed?['key_generation','public_key_record','envelope_commitment_hex']:[])]);
  if (r.schema!=='synergy-r1-managed-key-status-v1' || r.slot_ref!==request.parameters.slot_ref
      || r.original_request_sha256!==request.parameters.original_request_sha256
      || r.runtime_authority_granted!==false
      || !['absent','generating_requires_reconciliation','sealed_pending'].includes(r.stage)) fail();
  if (!sealed) return Object.freeze({...r});
  generation(r.key_generation);hex(r.envelope_commitment_hex,128);
  const key=publicKey(r.public_key_record);
  if (key.key_generation!==r.key_generation) fail();
  return Object.freeze({...r,public_key_record:key});
}
