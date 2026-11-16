import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {readReplacementRecoveryFile,replacementRecoveryLimit,replacementRecoveryPins} from '../src/replacement-recovery.js';
import {compareSavedReplacementIntent,readReplacementStageManifest,replacementIntentPins} from '../src/saved-replacement-intent.js';
import {readDraftPackageManifest} from '../src/saved-upgrade-intent.js';
import {commissioningDraftFixture} from './fixtures/commissioning-public-evidence.mjs';
import {digest,replacementIntentFixture,replacementRecoveryFixture,replacementRecoveryTar} from './fixtures/replacement-recovery.mjs';

const fixture = replacementRecoveryFixture();
const file = bytes => new Blob([bytes]);
const inspect = (bytes,pins={base:fixture.base,archive:digest(bytes)}) => readReplacementRecoveryFile(file(bytes),pins);
const unsupported = /not a supported finish-replacement tar/;
const intentUnsupported = /not a supported saved application replacement intent/;
const reviewedIntent={intentDigestChecked:true,candidateMatches:true,stageMatches:true,recordedProtectedFiles:5,
 protectedCandidate:{netbirdMatches:true,overlapCount:3,conflictCount:0}};

async function reviewedInputs(fixture) {
 const candidate=await readDraftPackageManifest(file(fixture.packageBytes),fixture.draft);
 const stage=await readReplacementStageManifest(file(fixture.stage.commissioning),fixture.stage.expected,fixture.draft);
 return {candidate,stage,intentPin:fixture.pin};
}

test('reports tool integrity, the exact archive digest and independently matched pins',async()=>{
 const actual = await inspect(fixture.bytes,{base:fixture.base.toUpperCase(),archive:fixture.archive.toUpperCase()});
 assert.deepEqual(actual,{archiveSha256:fixture.archive,basePackageSha256:fixture.base,verifiedToolFiles:3,archivePinMatches:true,basePinMatches:true});
 for (const [field,flag] of [['archive','archivePinMatches'],['base','basePinMatches']]) {
  const pins = {base:fixture.base,archive:fixture.archive,[field]:'b'.repeat(64)};
  const mismatch = await inspect(fixture.bytes,pins);
  assert.equal(mismatch[flag],false);
  assert.equal(mismatch[field==='base'?'archivePinMatches':'basePinMatches'],true);
  assert.equal(mismatch.verifiedToolFiles,3);
 }
 assert.equal(replacementRecoveryPins(fixture.base+'\n',fixture.archive),null);
});

test('refuses extra, missing, duplicate, linked, traversal and malformed tar members',async()=>{
 const [first,...rest] = fixture.entries;
 const broken = [
  replacementRecoveryTar([...fixture.entries,{...first,name:'extra.py'}]),
  replacementRecoveryTar(rest),
  replacementRecoveryTar([first,first,...rest]),
  replacementRecoveryTar([{...first,type:'2',link:'synergy_linux.py'},...rest]),
  replacementRecoveryTar([{...first,type:'1',link:'synergy_linux.py'},...rest]),
  replacementRecoveryTar([{...first,type:'x'},...rest]),
  replacementRecoveryTar([{...first,name:'../apqe_layout.py'},...rest]),
  replacementRecoveryTar([{...first,prefix:'elsewhere'},...rest]),
  replacementRecoveryTar([{...first,mode:'0000700\0'},...rest]),
  fixture.bytes.subarray(0,fixture.bytes.length-512),
 ];
 for (const index of [148,512+first.bytes.length,fixture.bytes.length-1]) {
  const changed = Buffer.from(fixture.bytes);
  changed[index] ^= 1;
  broken.push(changed);
 }
 for (const bytes of broken) await assert.rejects(inspect(bytes),unsupported);
});

test('refuses tampered tool bytes and invalid, duplicate or mismatched manifest fields',async()=>{
 const entries = fixture.entries.slice(0,-1);
 const manifestEntry = fixture.entries.at(-1);
 const {manifest} = fixture;
 async function checkManifest(raw,expected) {
  await assert.rejects(inspect(replacementRecoveryTar([...entries,{...manifestEntry,bytes:Buffer.from(raw)}])),expected);
 }
 const invalid = /invalid recovery manifest/;
 await checkManifest(JSON.stringify({...manifest,format:'unknown'}),invalid);
 await checkManifest(JSON.stringify({...manifest,base_package_sha256:fixture.base+'\n'}),invalid);
 await checkManifest(JSON.stringify({...manifest,files:{...manifest.files,'../other.py':'b'.repeat(64)}}),invalid);
 await checkManifest(JSON.stringify(manifest).replace('"files":','"files":{},"files":'),invalid);
 await checkManifest(JSON.stringify({...manifest,files:{...manifest.files,'apqe_layout.py':'b'.repeat(64)}}),/tool digest differs/);
 const [first,...rest] = fixture.entries;
 await assert.rejects(inspect(replacementRecoveryTar([{...first,bytes:Buffer.from('tampered')},...rest])),/tool digest differs/);
});

test('checks exact size and both pins before reading and retires a superseded file',async()=>{
 const neverRead = {size:replacementRecoveryLimit+1,arrayBuffer:()=>assert.fail('unexpected file read')};
 await assert.rejects(readReplacementRecoveryFile(neverRead,fixture),/at most 1 MiB/);
 await assert.rejects(readReplacementRecoveryFile(neverRead,{base:fixture.base}),/both expected SHA-256/);
 await assert.rejects(readReplacementRecoveryFile({size:fixture.bytes.length,arrayBuffer:async()=>new ArrayBuffer(1)},fixture),/could not be read in full/);
 const inactive = {size:fixture.bytes.length,arrayBuffer:()=>assert.fail('retired file was read')};
 assert.equal(await readReplacementRecoveryFile(inactive,fixture,()=>false),null);
 let current = true;
 const pending = {size:fixture.bytes.length,arrayBuffer:async()=>{current = false; return await file(fixture.bytes).arrayBuffer();}};
 assert.equal(await readReplacementRecoveryFile(pending,fixture,()=>current),null);
});

test('binds selected manifests independently and reports only the saved intent and protected comparisons',async()=>{
 const fixture=replacementIntentFixture();
 const inputs=await reviewedInputs(fixture);
 assert.deepEqual(replacementIntentPins(fixture.stage.expected.toUpperCase(),fixture.pin),{stagePin:fixture.stage.expected,intentPin:fixture.pin});
 assert.equal(replacementIntentPins(fixture.stage.expected,fixture.pin+'\n'),null);
 const observed=await compareSavedReplacementIntent(file(fixture.intentBytes),inputs);
 assert.deepEqual(observed,reviewedIntent);
 assert.doesNotMatch(JSON.stringify(observed),/fixture|netbird-client|[a-f0-9]{64}/);
 assert.deepEqual(await compareSavedReplacementIntent(file(fixture.intentBytes),{...inputs,intentPin:null}),
  {...reviewedIntent,intentDigestChecked:false});
 await assert.rejects(compareSavedReplacementIntent(file(fixture.intentBytes.trim()),inputs),/independently supplied digest/);
 await assert.rejects(readDraftPackageManifest(file(fixture.packageBytes.trim()),fixture.draft),/differs from the approved release references/);
 await assert.rejects(readReplacementStageManifest(file(fixture.stage.commissioning.trim()),fixture.stage.expected,fixture.draft),/independently supplied digest/);
 await assert.rejects(readReplacementStageManifest(file(fixture.stage.commissioning),fixture.stage.expected,{...fixture.draft,node_name:'changed-node'}),/current provisioning draft/);
});

test('requires both token halves before comparing protected candidate members',async()=>{
 for (const [index,flag] of [[0,'candidateMatches'],[1,'stageMatches']]) {
  const fixture=replacementIntentFixture({alterIntent:intent=>{
   const parts=intent.token.split(':');parts[index]='d'.repeat(64);intent.token=parts.join(':');
  }});
  const result=await compareSavedReplacementIntent(file(fixture.intentBytes),await reviewedInputs(fixture));
  assert.deepEqual(result,{...reviewedIntent,[flag]:false,protectedCandidate:null});
 }
 const changed=replacementIntentFixture({alterCandidate:manifest=>{
  manifest.files['bin/netbird']=digest('different netbird');
  manifest.files['tools/netbird-client']=digest('different wrapper');
 }});
 assert.deepEqual((await compareSavedReplacementIntent(file(changed.intentBytes),await reviewedInputs(changed))).protectedCandidate,
  {netbirdMatches:false,overlapCount:3,conflictCount:2});
 const missing=replacementIntentFixture({alterCandidate:manifest=>{delete manifest.files['bin/netbird'];}});
 assert.deepEqual((await compareSavedReplacementIntent(file(missing.intentBytes),await reviewedInputs(missing))).protectedCandidate,
  {netbirdMatches:false,overlapCount:2,conflictCount:0});
});

test('refuses invalid owner fields, receipt inventory and forbidden protected names before reporting evidence',async()=>{
 for (const alterIntent of [intent=>{intent.command='ignored';},intent=>{intent.root='/opt/synergy';},
  intent=>{intent.token=intent.token.replace(':','/');},intent=>{intent.token=intent.token.toUpperCase();},
  intent=>{intent.receipt.root='/other';},intent=>{intent.receipt.package_files['bin/../secret']=digest('fixture');},
  intent=>{delete intent.vpn_sha256['bin/netbird'];},
  ...['vpn/state.json','evidence/vpn-../secret.json','systemd/foreign.service','systemd/vpn.service\n'].map(path=>
   intent=>{intent.vpn_sha256[path]=digest('fixture');}),intent=>{intent.vpn_sha256['bin/netbird']='x'.repeat(64);},
 ]) {
  const fixture=replacementIntentFixture({alterIntent});
  await assert.rejects(compareSavedReplacementIntent(file(fixture.intentBytes),await reviewedInputs(fixture)),intentUnsupported);
 }
 const fixture=replacementIntentFixture();
 const inputs=await reviewedInputs(fixture);
 const raw=fixture.intentBytes.replace('"root":"/opt/Synergy"','"root":"/opt/Synergy","r\\u006fot":"/opt/Synergy"');
 await assert.rejects(compareSavedReplacementIntent(file(raw),{...inputs,intentPin:digest(raw)}),intentUnsupported);
 let current=true;
 const bytes=await file(fixture.intentBytes).arrayBuffer();
 const pending={size:bytes.byteLength,arrayBuffer:async()=>{current=false;return bytes;}};
 assert.equal(await compareSavedReplacementIntent(pending,inputs,()=>current),null);
 assert.ok(new Uint8Array(bytes).every(byte=>byte===0));
});

const ownerTarPath = process.env.SYNERGY_REPLACEMENT_RECOVERY_OWNER_TAR;
const ownerReceiptPath = process.env.SYNERGY_REPLACEMENT_RECOVERY_OWNER_RECEIPT;
test('accepts bytes and both digests generated by the pinned owner writer', {skip:!ownerTarPath || !ownerReceiptPath},async()=>{
 const {base_package_sha256:base,recovery_sha256:archive} = JSON.parse(readFileSync(ownerReceiptPath,'utf8'));
 const result = await inspect(readFileSync(ownerTarPath),{base,archive});
 assert.deepEqual(result,{archiveSha256:archive,basePackageSha256:base,verifiedToolFiles:3,archivePinMatches:true,basePinMatches:true});
});

const ownerIntentDir=process.env.SYNERGY_REPLACEMENT_INTENT_OWNER_DIR;
test('accepts the bound application replacement intent dictionary produced from the pinned owner writer', {skip:!ownerIntentDir},async()=>{
 const raw=name=>readFileSync(`${ownerIntentDir}/${name}`);
 const packageBytes=raw('package.json');
 const commissioning=raw('commissioning.json');
 const intentBytes=raw('application-replacement-intent.json');
 const draft={...commissioningDraftFixture,release_id:JSON.parse(packageBytes).release_id,manifest_sha256:digest(packageBytes)};
 const built={packageBytes,intentBytes,pin:digest(intentBytes),draft,stage:{commissioning,expected:digest(commissioning)}};
 assert.deepEqual(await compareSavedReplacementIntent(file(intentBytes),await reviewedInputs(built)),reviewedIntent);
});
