import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {authorityRecoveryScope,compareAuthorityRecoveryPublicFile,readAuthorityRecoveryCompletion,readAuthorityRecoveryPlan} from '../src/authority-recovery-evidence.js';
import {authorityRecoveryFixture,authorityRecoveryHash} from './fixtures/authority-recovery.mjs';

const file=raw=>new Blob([raw]);
const inspect=fixture=>readAuthorityRecoveryPlan(file(fixture.planBytes),fixture.planPin,authorityRecoveryScope(fixture.draft));
const defaultFindings={role:'validator',plannedFiles:6,preservedNetworkPins:4,changedFiles:6,priorCertificateRecorded:false};
const unsupported=/not a supported Canary authority-recovery plan/;

test('supports exactly the owner validator, relay and gateway plan scopes with a separate certificate pin',async()=>{
 const normal=authorityRecoveryFixture();
 assert.deepEqual((await inspect(normal)).findings,defaultFindings);
 const relay=await inspect(authorityRecoveryFixture({relay:true,priorCertificate:true}));
 assert.deepEqual(relay.findings,{...defaultFindings,plannedFiles:7,changedFiles:7,priorCertificateRecorded:true});
 const gateway=await inspect(authorityRecoveryFixture({role:'rpc_gateway'}));
 assert.deepEqual(gateway.findings,{...defaultFindings,role:'rpc_gateway'});
 assert.doesNotMatch(JSON.stringify(gateway.findings),/[a-f0-9]{64}|fixture|\.json/);
 const scope=authorityRecoveryScope(normal.draft);
 await assert.rejects(readAuthorityRecoveryPlan(file(normal.planBytes.trim()),normal.planPin,scope),/independently supplied digest/);
 await assert.rejects(readAuthorityRecoveryPlan(file(normal.planBytes),normal.planPin,{...scope,packagePin:'f'.repeat(64)}),/does not match the current Canary/);
 assert.equal(authorityRecoveryScope({...normal.draft,chain_id:'1266'}),null);
});

test('refuses independently pinned but malformed, unbounded, foreign or ambiguous plan records',async()=>{
 for (const alterPlan of [p=>{p.root='/opt/synergy';},p=>{p.chain_id=1266;},p=>{p.chain_id='99999';},
  p=>{p.immutable_network['authority.json']='c'.repeat(64);},p=>{p.before['config/node.json']=null;},
  p=>{p.after['network/authority-recovery-certificate.json']=null;},p=>{p.after['./network/authority.json']='c'.repeat(64);},
  p=>{delete p.before['network/authority.json'];},p=>{p.before['config/node.json']+='\n';},
  p=>{p.role='rpc_gateway';delete p.before['config/start-authorized.json'];delete p.after['config/start-authorized.json'];},
 ]) await assert.rejects(inspect(authorityRecoveryFixture({alterPlan})),unsupported);
 const fixture=authorityRecoveryFixture();
 const duplicate=fixture.planBytes.replace('"role":"validator"','"role":"validator","r\\u006fle":"validator"');
 await assert.rejects(readAuthorityRecoveryPlan(file(duplicate),authorityRecoveryHash(duplicate),authorityRecoveryScope(fixture.draft)),unsupported);
 const oversized={size:32*1024+1,arrayBuffer:()=>assert.fail('unexpected plan read')};
 await assert.rejects(readAuthorityRecoveryPlan(oversized,fixture.planPin,authorityRecoveryScope(fixture.draft)),/at most/);
});

test('correlates the reported native acceptance only to the exact reviewed plan and its four scope pins',async()=>{
 const fixture=authorityRecoveryFixture();
 const plan=await inspect(fixture);
 assert.deepEqual(await readAuthorityRecoveryCompletion(file(fixture.completionBytes),plan),{nativePreflightReported:true});
 for (const key of ['plan_sha256','certificate_sha256','authority_sha256','package_sha256']) {
  await assert.rejects(readAuthorityRecoveryCompletion(file(JSON.stringify({...fixture.completion,[key]:'b'.repeat(64)})),plan),/does not match the reviewed plan/);
 }
 for (const changed of [{...fixture.completion,native_preflight_passed:false},{...fixture.completion,services_started:false},{...fixture.completion,root:'/other'}]) {
  await assert.rejects(readAuthorityRecoveryCompletion(file(JSON.stringify(changed)),plan),/not a supported authority-recovery completion receipt/);
 }
});

test('matches exact public evidence and both certificate bindings without accepting malformed arrays or late reads',async()=>{
 const fixture=authorityRecoveryFixture();
 const plan=await inspect(fixture);
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(fixture.certificateBytes),'certificate',plan),{matches:true,bindings:'matches'});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(fixture.certificateBytes+'\n'),'certificate',plan),{matches:false});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(fixture.successorAuthority),'authority',plan),{matches:true});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(fixture.successorAuthority.trim()),'authority',plan),{matches:false});
 const conflict=authorityRecoveryFixture({alterCertificate:c=>{c.previous_authority_binding[0]=0;}});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(conflict.certificateBytes),'certificate',await inspect(conflict)),{matches:true,bindings:'differs'});
 const wrongBytes=authorityRecoveryFixture({alterCertificate:c=>{c.successor_authority_binding[0]=256;}});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(wrongBytes.certificateBytes),'certificate',await inspect(wrongBytes)),{matches:true,bindings:'unsupported'});
 let current=true;
 const bytes=await file(fixture.certificateBytes).arrayBuffer();
 assert.equal(await compareAuthorityRecoveryPublicFile({size:bytes.byteLength,arrayBuffer:async()=>{current=false;return bytes;}},
  'certificate',plan,()=>current),null);
 assert.ok(new Uint8Array(bytes).every(byte=>byte===0));
});

const ownerFixture=process.env.SYNERGY_AUTHORITY_RECOVERY_OWNER_DIR;
test('matches the pinned owner prepare and load_plan artifacts, completion and public binding bytes', {skip:!ownerFixture},async()=>{
 const raw=name=>readFileSync(`${ownerFixture}/${name}`);
 const planBytes=raw('authority-recovery-plan.json');
 const {network_id:network,package_sha256:packagePin}=JSON.parse(planBytes);
 const reviewed=await readAuthorityRecoveryPlan(file(planBytes),authorityRecoveryHash(planBytes),{network,packagePin});
 assert.deepEqual(reviewed.findings,defaultFindings);
 assert.deepEqual(await readAuthorityRecoveryCompletion(file(raw('authority-recovery-completed.json')),reviewed),{nativePreflightReported:true});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(raw('authority-recovery-certificate.json')),'certificate',reviewed),{matches:true,bindings:'matches'});
 assert.deepEqual(await compareAuthorityRecoveryPublicFile(file(raw('authority.json')),'authority',reviewed),{matches:true});
});
