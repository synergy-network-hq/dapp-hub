import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {readSavedControllerPolicy,savedControllerPolicyLimit} from '../src/saved-controller-policy.js';
import {draftPolicyFixture as draft,policyFixture,policyPin} from './fixtures/saved-controller-policy.mjs';

const unsupported = /not a supported saved NodeNetwork controller policy/;
const read = (value,form=draft) => {
 const raw = typeof value === 'string' ? value : JSON.stringify(value);
 return readSavedControllerPolicy(new Blob([raw]),policyPin(raw),form);
};

test('distinguishes initial bootstrap from an owner disposable qualification with identical release references',async()=>{
 for (const qualified of [false,true]) {
  const value=policyFixture(qualified);
  const report=await read(value);
  assert.deepEqual(report,{status:'compared',policySha256:policyPin(JSON.stringify(value)),scope:qualified?'disposable':'unlabelled',
   releaseListed:true,manifestMatches:true,inventoryAuthenticated:true,networkListed:true,reportedChain:'1266',chainMatches:true,installListed:qualified});
  assert.doesNotMatch(JSON.stringify(report),/private account|fixture-network|controller\.py|authorized_keys|\/opt\/Synergy/);
 }
});

test('reports release, digest, inventory, network and exact chain clauses independently',async()=>{
 const value=policyFixture(true);
 const release = value.releases[draft.release_id];
 const missing=await read(value,{...draft,release_id:'missing-release'});
 assert.equal(missing.releaseListed,false);
 assert.equal(missing.manifestMatches,null);
 assert.equal(missing.inventoryAuthenticated,null);
 assert.equal(missing.networkListed,null);
 assert.equal(missing.chainMatches,null);
 assert.equal(missing.installListed,true);

 release.manifest_sha256='d'.repeat(64);
 release.inventory_authenticated=false;
 const differentlyPinned=await read(value);
 assert.equal(differentlyPinned.manifestMatches,false);
 assert.equal(differentlyPinned.inventoryAuthenticated,false);
 assert.equal(differentlyPinned.chainMatches,true);

 const unlisted=await read(value,{...draft,network_id:'missing-network'});
 assert.equal(unlisted.networkListed,false);
 assert.equal(unlisted.reportedChain,null);
 assert.equal(unlisted.chainMatches,null);
 const high=JSON.stringify(value).replace('"fixture-network":1266','"fixture-network":18446744073709551615');
 const different=await read(high);
 assert.equal(different.networkListed,true);
 assert.equal(different.reportedChain,'18446744073709551615');
 assert.equal(different.chainMatches,false);
 delete release.networks;
 assert.equal((await read(value)).networkListed,false);
});

test('rejects mismatched bytes, ambiguous records, malformed policy scopes and unreadable input',async()=>{
 const value=policyFixture();
 const raw=JSON.stringify(value);
 assert.deepEqual(await readSavedControllerPolicy(new Blob([raw+'\n']),policyPin(raw),draft),{status:'pin-mismatch'});
 const fixtureScope = policyFixture(true);
 assert.equal((await read({...fixtureScope,qualification_scope:'fixture private URI'})).scope,'other');
 for (const bad of [
  {...value,root:'/opt/synergy'},{...value,community_enrollment:true},
  {...value,qualified_operations:['shell']},{...value,qualified_operations:['install','install']},
  {...value,engine_files:{}},{...value,releases:[]},
  raw.replace('"fixture-network":1266','"fixture-network":"1266"'),
  raw.replace('"fixture-network":1266','"fixture-network":18446744073709551616'),
  raw.replace('"fixture-network":1266','"fixture-network":1266,"fixture-networ\\u006b":1266'),
 ]) await assert.rejects(read(bad),unsupported);
 await assert.rejects(readSavedControllerPolicy({size:savedControllerPolicyLimit+1,arrayBuffer:()=>assert.fail('oversize read')},policyPin(raw),draft),/128 KiB/);
 await assert.rejects(readSavedControllerPolicy({size:1,arrayBuffer:async()=>new ArrayBuffer(0)},policyPin(raw),draft),/in full/);
 await assert.rejects(readSavedControllerPolicy(new Blob([new Uint8Array([255])]),policyPin(new Uint8Array([255])),draft),unsupported);
});

test('requires valid draft and pin and retires an in-flight policy read',async()=>{
 const raw=JSON.stringify(policyFixture());
 const file=new Blob([raw]);
 const unexpected={size:file.size,arrayBuffer:()=>assert.fail('must not open file')};
 await assert.rejects(readSavedControllerPolicy(unexpected,policyPin(raw),{...draft,node_name:''}),/node name/);
 await assert.rejects(readSavedControllerPolicy(unexpected,'invalid',draft),/independently supplied/);
 assert.equal(await readSavedControllerPolicy(unexpected,policyPin(raw),draft,()=>false),null);
 let allowed=true;
 assert.equal(await readSavedControllerPolicy({size:file.size,arrayBuffer:()=>{allowed=false;return file.arrayBuffer();}},
  policyPin(raw),draft,()=>allowed),null);
});

const ownerDirectory=process.env.SYNERGY_CONTROLLER_POLICY_OWNER_FIXTURES;
test('checks policies serialized by the pinned owner bootstrap and disposable writer',{skip:!ownerDirectory},async()=>{
 for (const qualified of [false,true]) {
  const raw=readFileSync(`${ownerDirectory}/${qualified?'disposable':'bootstrap'}.json`,'utf8');
  const report=await read(raw);
  assert.equal(report.installListed,qualified);
  assert.equal(report.scope,qualified?'disposable':'unlabelled');
  assert.equal(report.releaseListed,true);
  assert.equal(report.manifestMatches,true);
  assert.equal(report.inventoryAuthenticated,true);
  assert.equal(report.chainMatches,true);
 }
});
