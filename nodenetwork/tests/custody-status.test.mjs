import assert from 'node:assert/strict';
import test from 'node:test';
import {custodyStatusObservation} from '../src/custody-status.js';
import {installedControllerRead, targetControllerObservation} from '../src/target-observation.js';

const address='synv1'+'a'.repeat(36);
const format={pending:true,network_id:'fixture-network',chain_id:'18446744073709551615',address,
 possession_verified:true,membership_granted:false};
const identity={...format,genesis_sha256:'a'.repeat(64),genesis_authority_verified:true};
const formation={...format,schema:'nodenetwork-formation-v1',formation_sha256:'b'.repeat(64),formation_id:'c'.repeat(64),request_sha256:'d'.repeat(64)};

test('projects independent pending custody types and preserves exact decimal chain ID', () => {
 assert.deepEqual(custodyStatusObservation('identity_status',identity),{
  kind:'Existing-network custody',pending:true,networkId:'fixture-network',chainId:'18446744073709551615',validatorAddress:address,genesisSha256:'a'.repeat(64),
 });
 assert.deepEqual(custodyStatusObservation('formation_status',formation),{
  kind:'Formation custody',pending:true,networkId:'fixture-network',chainId:'18446744073709551615',validatorAddress:address,formationSha256:'b'.repeat(64),
 });
 assert.deepEqual(custodyStatusObservation('formation_status',{pending:false}),{kind:'Formation custody',pending:false});
});

test('rejects ambiguous, off-format and configured-identity claims', () => {
 for(const outcome of [null,{pending:false,address},formation,{...identity,membership_granted:true},
  {...identity,genesis_authority_verified:false},{...identity,possession_verified:false},{...identity,chain_id:'18446744073709551616'},
  {...identity,chain_id:1266},{...identity,chain_id:'01266'},{...identity,address:'synw1'+'a'.repeat(36)},
 ]) assert.throws(()=>custodyStatusObservation('identity_status',outcome),/unsupported pending custody evidence/);
 for (const outcome of [identity,{...formation,formation_id:'0'.repeat(64)},{...formation,request_sha256:undefined}]) {
  assert.throws(()=>custodyStatusObservation('formation_status',outcome),/unsupported pending custody evidence/);
 }
});

test('capabilities are independent and require a matching installed controller read', () => {
 const read={operation:'identity_status',kind:'read',available:true};
 const installed={root:'/opt/Synergy',controllerVersion:1,installed:true,operations:[read]};
 assert.equal(installedControllerRead(targetControllerObservation(installed),'identity_status').available,true);
 assert.equal(installedControllerRead(targetControllerObservation(installed),'formation_status').available,false);
 assert.equal(installedControllerRead(targetControllerObservation({...installed,installed:false}),'identity_status').available,false);
 assert.equal(installedControllerRead(targetControllerObservation({...installed,operations:[read,read]}),'identity_status').available,false);
 assert.throws(()=>targetControllerObservation({...installed,root:'/opt/synergy'}),/unsupported installation root/);
});
