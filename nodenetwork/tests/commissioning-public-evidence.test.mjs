import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {commissioningDraftIdentity,commissioningPublicArtifacts,compareCommissioningProviderReport,readCommissioningConfiguration,readCommissioningManifest,readCommissioningStartupPolicy,
 reviewCommissioningPublicArtifacts} from '../src/commissioning-public-evidence.js';
import {commissioningDraftFixture,commissioningFixture,commissioningPin} from './fixtures/commissioning-public-evidence.mjs';

const file = raw=>new Blob([raw]);
const named = (name,raw)=>Object.assign(file(raw),{name});
const selections = publicFiles=>Object.entries(publicFiles).map(([name,raw])=>named(name,raw));
const configurationMatches={identity:true,profile:true,transportPaths:true,runtimePaths:true,networkPaths:true,
 directKeyOverrides:true,publicTrustAnchors:true,providerReference:true};
const releaseDraft={release_id:'fixture-master',manifest_sha256:'a'.repeat(64)};
const inspectedMaster=reportSha256=>({release:releaseDraft.release_id,manifestSha256:releaseDraft.manifest_sha256,
 architecture:'Linux x86_64',fileCount:12,releaseTrustVerified:false,installAuthorized:false,
 inventory:{status:'matched',verifiedFiles:12,verifiedBytes:400,apqeProvider:{status:'matched',libraryCount:8,reportSha256}}});

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

test('checks byte identity, exact u64 scope and owner configuration clauses without exposing raw values',async()=>{
 const fixture=commissioningFixture();
 const {manifest}=await ready(fixture);
 const status=await readCommissioningConfiguration(file(fixture.configuration),manifest,fixture.draft);
 assert.deepEqual(status.checks,configurationMatches);
 assert.doesNotMatch(JSON.stringify(status.checks),/fixture|\/opt\/|[a-f0-9]{64}/);
 await assert.rejects(readCommissioningConfiguration(file(fixture.configuration.trim()),manifest,fixture.draft),/configuration SHA-256 differs/);
 const chain='18446744073709551615';
 const exactConfiguration=fixture.configuration.replace('"chain_id":99999',`"chain_id":${chain}`);
 const exactManifest=fixture.commissioning.replace('"chain_id":99999',`"chain_id":${chain}`)
  .replace(manifest.configurationPin,commissioningPin(exactConfiguration));
 const draft={...fixture.draft,chain_id:chain};
 const scoped=await readCommissioningManifest(file(exactManifest),commissioningPin(exactManifest),draft);
 assert.deepEqual((await readCommissioningConfiguration(file(exactConfiguration),scoped,draft)).checks,configurationMatches);
});

test('compares only a current draft-matching native master report with a valid configuration report pin',async()=>{
 const fixture=commissioningFixture();
 const {manifest}=await ready(fixture);
 const configuration=await readCommissioningConfiguration(file(fixture.configuration),manifest,fixture.draft);
 const master=inspectedMaster('b'.repeat(64));
 assert.equal(compareCommissioningProviderReport(configuration,master,releaseDraft),'matches');
 assert.equal(compareCommissioningProviderReport(configuration,inspectedMaster('d'.repeat(64)),releaseDraft),'differs');
 assert.equal(compareCommissioningProviderReport(configuration,null,releaseDraft),'master-required');
 assert.equal(compareCommissioningProviderReport(configuration,master,fixture.draft),'draft-incomplete');
 assert.equal(compareCommissioningProviderReport(configuration,master,{...releaseDraft,manifest_sha256:'c'.repeat(64)}),'master-differs');
 assert.equal(compareCommissioningProviderReport(configuration,{...master,release:'different'},releaseDraft),'master-differs');
 for (const invalid of [inspectedMaster(undefined),inspectedMaster('B'.repeat(64)),inspectedMaster('b'.repeat(64)+'\n'),
  {...master,releaseTrustVerified:true},{...master,installAuthorized:true},{...master,architecture:'arm64'},
  {...master,inventory:{...master.inventory,verifiedFiles:1}},
  {...master,inventory:{...master.inventory,apqeProvider:{...master.inventory.apqeProvider,libraryCount:7}}}]) {
  assert.equal(compareCommissioningProviderReport(configuration,invalid,releaseDraft),'report-unavailable');
 }
 const invalidPath=commissioningFixture({alterConfiguration:config=>{config.aegis_provider.report_path='/fixture/never-read.json';}});
 const changed=await readCommissioningConfiguration(file(invalidPath.configuration),(await ready(invalidPath)).manifest,invalidPath.draft);
 assert.equal(changed.providerPin,null);
 assert.equal(compareCommissioningProviderReport(changed,master,releaseDraft),'configuration-unavailable');
 assert.equal(compareCommissioningProviderReport({...configuration,checks:{...configuration.checks,profile:false}},master,releaseDraft),
  'configuration-unavailable');
});

test('reports each configuration discrepancy even when the bytes are correctly pinned',async()=>{
 const bad=commissioningFixture({alterConfiguration:config=>{
  config.node_name='private-fixture-different-node';
  config.apqe_transport.profile='non-owner-profile';
  config.apqe_transport.custody_unlock_path='/private/foreign-fixture/never-read';
  config.apqe_transport.genesis_trust_key_sha256='f'.repeat(64);
  config.consensus.authority_binding='/private/foreign-fixture/authority.json';
  config.storage.data_directory='/private/foreign-fixture/data';
  config.etdag={ingress_kem_secret_key_path:'/private/foreign-fixture/secret'};
  config.aegis_provider.authenticated_report_sha256='bad-reference';
 }});
 const {manifest}=await ready(bad);
 const verdict=await readCommissioningConfiguration(file(bad.configuration),manifest,bad.draft);
 assert.deepEqual(verdict.checks,Object.fromEntries(Object.keys(configurationMatches).map(key=>[key,false])));
 assert.equal(verdict.providerPin,null);
 assert.doesNotMatch(JSON.stringify(verdict),/foreign-fixture|non-owner|secret|bad-reference/);
 for (const change of [
  config=>{config.aegis_signing_key_path='/fixture/private';},config=>{config.aegis_key_bindings_path='/fixture/private';},
  config=>{config.consensus.signing_key_path='/fixture/private';},
 ]) {
  const scoped=commissioningFixture({alterConfiguration:change});
  assert.equal((await readCommissioningConfiguration(file(scoped.configuration),(await ready(scoped)).manifest,scoped.draft)).checks.directKeyOverrides,false);
 }
});

test('refuses oversized and malformed selected configs and clears retired buffers',async()=>{
 const fixture=commissioningFixture();
 const {manifest}=await ready(fixture);
 const oversized={size:4*1024*1024+1,arrayBuffer:()=>assert.fail('unexpected file read')};
 await assert.rejects(readCommissioningConfiguration(oversized,manifest,fixture.draft),/at most 4,194,304 bytes/);
 const duplicate=fixture.configuration.replace('"chain_id":99999','"chain_id":99999,"cha\\u0069n_id":99999');
 await assert.rejects(readCommissioningConfiguration(file(duplicate),{...manifest,configurationPin:commissioningPin(duplicate)},fixture.draft),/not a supported commissioning configuration JSON object/);
 let current=true;
 const bytes=await file(fixture.configuration).arrayBuffer();
 const pending={size:bytes.byteLength,arrayBuffer:async()=>{current=false;return bytes;}};
 assert.equal(await readCommissioningConfiguration(pending,manifest,fixture.draft,()=>current),null);
 assert.ok(new Uint8Array(bytes).every(value=>value===0));
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

const ownerLayoutDir=process.env.SYNERGY_COMMISSIONING_LAYOUT_OWNER_FIXTURES;
test('matches pinned owner validate_stage configuration findings', {skip:!ownerLayoutDir}, async()=>{
 for (const [name,expected] of [ ['valid',configurationMatches], ['noncanonical-path',{...configurationMatches,transportPaths:false}],
  ['different-anchor',{...configurationMatches,publicTrustAnchors:false}] ]) {
  const folder=`${ownerLayoutDir}/${name}`;
  const raw=readFileSync(`${folder}/commissioning.json`);
  const manifest=await readCommissioningManifest(file(raw),commissioningPin(raw),commissioningDraftFixture);
  const configuration=readFileSync(`${folder}/config/node.json`);
  assert.deepEqual((await readCommissioningConfiguration(file(configuration),manifest,commissioningDraftFixture)).checks,expected,name);
 }
});

test('compares the pinned owner layout configuration against the verified report bytes', {skip:!ownerLayoutDir}, async()=>{
 const stage=`${ownerLayoutDir}/valid`;
 const raw=readFileSync(`${stage}/commissioning.json`);
 const manifest=await readCommissioningManifest(file(raw),commissioningPin(raw),commissioningDraftFixture);
 const config=await readCommissioningConfiguration(file(readFileSync(`${stage}/config/node.json`)),manifest,commissioningDraftFixture);
 const report=readFileSync(`${ownerLayoutDir}/software/lib/apqe/build-report.json`);
 assert.equal(compareCommissioningProviderReport(config,inspectedMaster(commissioningPin(report)),releaseDraft),'matches');
 assert.equal(compareCommissioningProviderReport(config,inspectedMaster(commissioningPin(Buffer.concat([report,Buffer.from('\n')]))),releaseDraft),'differs');
});
