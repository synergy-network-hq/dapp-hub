import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {commissioningDraftIdentity,commissioningPublicArtifacts,readCommissioningManifest,readCommissioningStartupPolicy,
 reviewCommissioningPublicArtifacts} from '../src/commissioning-public-evidence.js';
import {commissioningDraftFixture,commissioningFixture,commissioningPin} from './fixtures/commissioning-public-evidence.mjs';

const file = raw=>new Blob([raw]);
const named = (name,raw)=>Object.assign(file(raw),{name});
const selections = publicFiles=>Object.entries(publicFiles).map(([name,raw])=>named(name,raw));

async function ready(fixture) {
 const manifest=await readCommissioningManifest(file(fixture.commissioning),fixture.expected,fixture.draft);
 const policy=await readCommissioningStartupPolicy(file(fixture.startup),manifest);
 return {manifest,policy};
}

test('binds exact manifest, startup and six public digests and exposes only the compared roster counts',async()=>{
 const fixture=commissioningFixture();
 const {manifest,policy}=await ready(fixture);
 assert.deepEqual(Object.keys(manifest.publicPins).sort(),Object.keys(fixture.publicFiles).sort());
 assert.doesNotMatch(JSON.stringify(manifest),/keys\/apqe|custody|fixture-node/);
 const findings=await reviewCommissioningPublicArtifacts(selections(fixture.publicFiles).reverse(),manifest,policy);
 assert.deepEqual(findings,{status:'compared',allPublicDigestsMatch:true,policyCount:2,activeCount:2,rosterMatches:true});
 assert.doesNotMatch(JSON.stringify(findings),/fixture-validator|signer|private/);

 const change=await reviewCommissioningPublicArtifacts(selections({...fixture.publicFiles,'transport-root.pub':new Uint8Array([1,254,1])}),manifest,policy);
 assert.deepEqual(change,{status:'digest-mismatch',mismatches:['transport-root.pub']});
});

test('refuses renamed or conflicting drafts, malformed files and unsupported production flags',async()=>{
 const fixture=commissioningFixture();
 await assert.rejects(readCommissioningManifest(file(fixture.commissioning.trim()),fixture.expected,fixture.draft),/independently supplied digest/);
 await assert.rejects(readCommissioningManifest(file(fixture.commissioning),fixture.expected,{...fixture.draft,chain_id:'1266'}),/current provisioning draft/);
 assert.equal(commissioningDraftIdentity({...fixture.draft,node_name:'fixture\n'}),null);
 assert.equal(commissioningDraftIdentity({...fixture.draft,chain_id:'18446744073709551616'}),null);
 assert.equal(commissioningDraftIdentity({...fixture.draft,chain_id:'18446744073709551615'}).chain,'18446744073709551615');
 const large=fixture.commissioning.replace('"chain_id":99999','"chain_id":18446744073709551615');
 const exact=await readCommissioningManifest(file(large),commissioningPin(large),{...fixture.draft,chain_id:'18446744073709551615'});
 assert.equal(exact.chain,'18446744073709551615');
 const foreign=commissioningFixture({alterManifest:manifest=>{manifest.root='/opt/synergy';}});
 await assert.rejects(ready(foreign),/not a supported APQE commissioning manifest/);
 const missing=commissioningFixture({alterManifest:manifest=>{delete manifest.files['network/transport-root.pub'];}});
 await assert.rejects(ready(missing),/not a supported APQE commissioning manifest/);
 const invalid=fixture.commissioning.replace('"root":"/opt/Synergy"','"root":"/opt/Synergy","ro\\u006ft":"/opt/Synergy"');
 await assert.rejects(readCommissioningManifest(file(invalid),commissioningPin(invalid),fixture.draft),/not a supported APQE commissioning manifest/);
 const manifest=await readCommissioningManifest(file(fixture.commissioning),fixture.expected,fixture.draft);
 await assert.rejects(readCommissioningStartupPolicy(file(fixture.startup.trim()),manifest),/startup policy SHA-256 differs/);
 await assert.rejects(ready(commissioningFixture({alterPolicy:policy=>{policy.production_approved=true;}})),/not a supported engineering startup policy/);
 await assert.rejects(ready(commissioningFixture({alterPolicy:policy=>{policy.all_pairs_vpn_verified=false;}})),/not a supported engineering startup policy/);
 await assert.rejects(ready(commissioningFixture({alterPolicy:policy=>{policy.public_file_sha256['transport-root.pub']='a'.repeat(64);}})),/disagree on the public file digests/);
});

test('distinguishes different equal-sized rosters, duplicate IDs and foreign reported authority scope',async()=>{
 const fixture=commissioningFixture({alterPolicy:policy=>{policy.validator_addresses[0]='fixture-other-validator';}});
 const {manifest,policy}=await ready(fixture);
 assert.deepEqual(await reviewCommissioningPublicArtifacts(selections(fixture.publicFiles),manifest,policy),
  {status:'compared',allPublicDigestsMatch:true,policyCount:2,activeCount:2,rosterMatches:false});
 const duplicateStartup=commissioningFixture({alterPolicy:policy=>{policy.validator_addresses[0]=policy.validator_addresses[1];}});
 await assert.rejects(ready(duplicateStartup),/not a supported engineering startup policy/);
 const duplicate=commissioningFixture({alterAuthority:authority=>{authority.payload.validators[0].record.validator_id=authority.payload.validators[1].record.validator_id;}});
 const repeated=await ready(duplicate);
 await assert.rejects(reviewCommissioningPublicArtifacts(selections(duplicate.publicFiles),repeated.manifest,repeated.policy),/unsupported public roster/);
 const other=commissioningFixture({alterAuthority:authority=>{authority.payload.chain_id=1266;}});
 const mixed=await ready(other);
 await assert.rejects(reviewCommissioningPublicArtifacts(selections(other.publicFiles),mixed.manifest,mixed.policy),/authority file network or chain differs/);
});

test('rejects extra, missing and duplicate selections before reads and retires a pending file',async()=>{
 const fixture=commissioningFixture();
 const {manifest,policy}=await ready(fixture);
 const blocked=name=>({name,size:1,arrayBuffer:()=>assert.fail('unexpected file read')});
 const valid=commissioningPublicArtifacts.map(({name})=>blocked(name));
 for (const input of [valid.slice(1),[...valid,blocked('custody.json')],[...valid.slice(1),valid.at(-1)],
  [...valid.slice(1),blocked('unlock')]]) {
  await assert.rejects(reviewCommissioningPublicArtifacts(input,manifest,policy),/exactly the six named/);
 }
 const first=commissioningPublicArtifacts[0];
 await assert.rejects(reviewCommissioningPublicArtifacts([{...valid[0],size:first.maxBytes+1},...valid.slice(1)],manifest,policy),/at most/);
 assert.equal(await reviewCommissioningPublicArtifacts(valid,manifest,policy,()=>false),null);
 let active=true;
 const bytes=file(fixture.publicFiles[first.name]);
 const pending={name:first.name,size:bytes.size,arrayBuffer:()=>{active=false;return bytes.arrayBuffer();}};
 assert.equal(await reviewCommissioningPublicArtifacts([pending,...valid.slice(1)],manifest,policy,()=>active),null);
});

const ownerDir=process.env.SYNERGY_COMMISSIONING_OWNER_FIXTURES;
test('uses the pinned owner seal and active-roster decisions', {skip:!ownerDir}, async()=>{
 const commissioning=readFileSync(`${ownerDir}/commissioning.json`);
 const source={draft:commissioningDraftFixture,commissioning,expected:commissioningPin(commissioning),startup:readFileSync(`${ownerDir}/config/start-authorized.json`)};
 const {manifest,policy}=await ready(source);
 const publicFiles=commissioningPublicArtifacts.map(({name})=>named(name,readFileSync(`${ownerDir}/network/${name}`)));
 const verdict=await reviewCommissioningPublicArtifacts(publicFiles,manifest,policy);
 const {activeCount}=JSON.parse(readFileSync(`${ownerDir}/owner-verdict.json`,'utf8'));
 assert.deepEqual(verdict,{status:'compared',allPublicDigestsMatch:true,policyCount:activeCount,activeCount,rosterMatches:true});
});
