import test from 'node:test';
import assert from 'node:assert/strict';
import {r1ManagedKeyCreationRequest as create,r1ManagedKeyStatusRequest as status,
  correlateR1SealedKeyReceipt as sealed,correlateR1ManagedKeyStatus as observe}
  from '../../shared/data-view/src/r1-managed-key-contract.js';
// Public transport-only fixtures. The scope bytes deliberately confer no APQE approval.
const digest='ab'.repeat(32);
function params(algorithm='ML-DSA-87') {return {release_id:'PUBLIC-SYNTHETIC-RELEASE',
  manifest_sha256:'01'.repeat(32),slot_ref:'PUBLIC-ROOT-SLOT-1',role:'root',algorithm,
  key_generation:'18446744073709551615',operation_nonce_hex:'02'.repeat(32),
  creation_scope_frame_hex:'00',creation_scope_commitment_hex:'03'.repeat(64),
  provider_report_sha256:'04'.repeat(32),profile_catalog_commitment_hex:'05'.repeat(64)};}
const sizes={'ML-DSA-87':2592,'ML-DSA-65':1952,'ML-KEM-1024':1568};
function result(p=params()) {return {version:1,ok:true,result:{
  schema:'synergy-r1-managed-sealed-key-v1',stage:'sealed_pending',request_sha256:digest,
  slot_ref:p.slot_ref,key_generation:p.key_generation,public_key_record:{
    role:p.role,algorithm:p.algorithm,key_generation:p.key_generation,
    full_public_key_hex:'ab'.repeat(sizes[p.algorithm])},
  envelope_commitment_hex:'cd'.repeat(64),runtime_authority_granted:false}};}
test('current creation DTO preserves exact native fields, full u64 and immutable input',()=>{
  const p=params();const r=create(p);
  assert.equal(r.operation,'r1_identity_generate');assert.equal(r.version,1);
  assert.equal(r.parameters.key_generation,'18446744073709551615');
  p.role='changed';assert.equal(r.parameters.role,'root');
  assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.parameters));
});
test('unknown fields, private material and numeric generations are rejected',()=>{
  for(const patch of [{secret_key:'private'},{key_generation:1},{key_generation:'01'},
    {key_generation:'0'},{key_generation:'18446744073709551616'},{algorithm:'Ed25519'}])
    assert.throws(()=>create({...params(),...patch}));
});
test('scope and original public pin widths cannot be mixed or normalized',()=>{
  for(const patch of [{manifest_sha256:'01'.repeat(64)},{provider_report_sha256:'04'.repeat(64)},
    {operation_nonce_hex:'00'.repeat(32)},{creation_scope_commitment_hex:'03'.repeat(32)},
    {profile_catalog_commitment_hex:'00'.repeat(64)},{creation_scope_frame_hex:'0'},
    {creation_scope_frame_hex:'aa'.repeat(4097)},{slot_ref:' space '},
    {creation_scope_frame_hex:'AB'},{manifest_sha256:'AB'.repeat(32)}])
    assert.throws(()=>create({...params(),...patch}));
});
for(const [algorithm,size] of Object.entries(sizes)) {
  test('sealed '+algorithm+' public key retains full selected size without authority',()=>{
    const p=params(algorithm);const r=sealed(result(p),p,digest);
    assert.equal(r.public_key_record.full_public_key_hex.length,size*2);
    assert.equal(r.runtime_authority_granted,false);assert.equal(r.stage,'sealed_pending');
    assert.ok(Object.isFrozen(r.public_key_record));
  });
  test(algorithm+' truncated key is not accepted as another algorithm',()=>{
    const p=params(algorithm);const r=result(p);r.result.public_key_record.full_public_key_hex=r.result.public_key_record.full_public_key_hex.slice(2);
    assert.throws(()=>sealed(r,p,digest));
  });
}
test('sealed reply must match original independently retained native request',()=>{
  for(const change of [
    r=>r.result.request_sha256='01'.repeat(32),
    r=>r.result.slot_ref='another-slot',
    r=>r.result.key_generation='1',
    r=>r.result.public_key_record.role='other',
    r=>r.result.public_key_record.key_generation='1',
    r=>r.result.runtime_authority_granted=true,
    r=>r.result.stage='active',
    r=>r.result.private_key='secret',
    r=>r.result.public_key_record.secret='secret',
    r=>r.extra=true,
  ]) {const r=result();change(r);assert.throws(()=>sealed(r,params(),digest));}
});
test('status request observes exact original slot and SHA256 without mutation fields',()=>{
  const r=status('PUBLIC-ROOT-SLOT-1',digest);
  assert.deepEqual(r,{version:1,operation:'r1_identity_status',
    parameters:{slot_ref:'PUBLIC-ROOT-SLOT-1',original_request_sha256:digest}});
  assert.throws(()=>status('slot',digest.toUpperCase()));
});
test('absent and ambiguous status stay distinct and grant no runtime authority',()=>{
  for(const stage of ['absent','generating_requires_reconciliation']) {
    const reply={version:1,ok:true,result:{schema:'synergy-r1-managed-key-status-v1',
      stage,slot_ref:'PUBLIC-ROOT-SLOT-1',original_request_sha256:digest,runtime_authority_granted:false}};
    assert.equal(observe(reply,'PUBLIC-ROOT-SLOT-1',digest).stage,stage);
    reply.result.key_generation='1';assert.throws(()=>observe(reply,'PUBLIC-ROOT-SLOT-1',digest));
  }
});
test('sealed status must bind public generation, original request and scope state',()=>{
  const r=result();delete r.result.request_sha256;
  r.result.schema='synergy-r1-managed-key-status-v1';r.result.original_request_sha256=digest;
  assert.equal(observe(r,params().slot_ref,digest).public_key_record.algorithm,'ML-DSA-87');
  r.result.public_key_record.key_generation='1';assert.throws(()=>observe(r,params().slot_ref,digest));
});
