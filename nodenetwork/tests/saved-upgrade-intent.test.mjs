import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareSavedUpgradeCompletion,compareSavedUpgradeManifest,readSavedUpgradeIntent,savedUpgradeLimits} from '../src/saved-upgrade-intent.js';
import {savedUpgradeCompletionFixture,savedUpgradeFixture} from './fixtures/saved-upgrade-intent.mjs';

const bytes = value => new Blob([typeof value==='string'?value:JSON.stringify(value)]);
const badIntent = /not a supported saved software upgrade intent/;

test('reviews exact software inventory changes and projects only approved references and fixed service findings',async()=>{
 for (const options of [{registered:false},{registered:true,relay:false},{registered:true,relay:true}]) {
  const fixture = savedUpgradeFixture(options);
  const intent = await readSavedUpgradeIntent(bytes(fixture.intent));
  const result = await compareSavedUpgradeManifest(bytes(fixture.candidate),intent,fixture.references);
  assert.deepEqual(result,{priorRelease:'prior-release',priorPin:fixture.intent.old_receipt.package_sha256,
   candidateRelease:'candidate-release',candidatePin:fixture.references.manifest_sha256,stage:'commissioned',
   registered:options.registered,relay:Boolean(options.relay),counts:{added:1,changed:1,removed:1,unchanged:1}});
  assert.doesNotMatch(JSON.stringify(result),/private|systemd|fixture-only|\/opt\/Synergy/i);
 }
});

test('checks duplicate keys, receipt bindings, safe inventory and recorded unit bytes',async()=>{
 for (const corrupt of [
  value=>{value.root='/other/Synergy';},value=>{value.stage='unknown';},
  value=>{value.old_manifest_json=value.old_manifest_json.trim();},
  value=>{value.old_receipt.package_files['bin/synergy-node']='f'.repeat(64);},
  value=>{value.new_files['keys/private']='f'.repeat(64);},
  value=>{value.new_files['bin/../data/private']='f'.repeat(64);},
  value=>{value.new_files['bin/synergy-node/child']='f'.repeat(64);},
  value=>{value.new_units['synergy-node.service']+='different';},
  value=>{value.new_integration.paths.reverse();},
  value=>{value.registered=false;},
 ]) {
  const {intent} = savedUpgradeFixture();
  corrupt(intent);
  await assert.rejects(readSavedUpgradeIntent(bytes(intent)),badIntent);
 }
 const {intent} = savedUpgradeFixture();
 await assert.rejects(readSavedUpgradeIntent(bytes(JSON.stringify(intent).replace('"registered":true','"registered":true,"regis\\u0074ered":true'))),badIntent);
});

test('separates draft and recorded candidate mismatch and retires pending or oversized evidence',async()=>{
 const fixture=savedUpgradeFixture();
 const intent=await readSavedUpgradeIntent(bytes(fixture.intent));
 await assert.rejects(compareSavedUpgradeManifest(bytes(fixture.candidate.trim()),intent,fixture.references),/in the update draft/);
 await assert.rejects(compareSavedUpgradeManifest(bytes(fixture.candidate),intent,{...fixture.references,release_id:'another'}),/in the update draft/);
 fixture.intent.new_files['bin/synergy-node']='f'.repeat(64);
 const different=await readSavedUpgradeIntent(bytes(fixture.intent));
 await assert.rejects(compareSavedUpgradeManifest(bytes(fixture.candidate),different,fixture.references),/in the saved intent/);
 await assert.rejects(readSavedUpgradeIntent({size:savedUpgradeLimits.intent+1,arrayBuffer:()=>assert.fail('unexpected read')}),/at most/);
 await assert.rejects(readSavedUpgradeIntent(new Blob([new Uint8Array([255])])),/as UTF-8/);
 assert.equal(await readSavedUpgradeIntent({size:1,arrayBuffer:()=>assert.fail('expired read')},()=>false),null);
 let live=true;
 const file=bytes(fixture.candidate);
 assert.equal(await compareSavedUpgradeManifest({size:file.size,arrayBuffer:()=>{live=false;return file.arrayBuffer();}},intent,fixture.references,()=>live),null);
});

test('compares a completion receipt independently of an intent and reports distinct package mismatches',async()=>{
 for (const resumed of [false,true]) {
  const {receipt,pins} = savedUpgradeCompletionFixture(resumed);
  const summary = await compareSavedUpgradeCompletion(bytes(receipt),pins);
  assert.deepEqual(summary,{...pins,priorMatches:true,candidateMatches:true,resumed,consensusStarted:false,automaticRestart:false});
  assert.doesNotMatch(JSON.stringify(summary),/\/opt\/Synergy/);
  assert.equal((await compareSavedUpgradeCompletion(bytes(receipt),{...pins,priorPin:'9'.repeat(64)})).priorMatches,false);
  assert.equal((await compareSavedUpgradeCompletion(bytes(receipt),{...pins,candidatePin:'9'.repeat(64)})).candidateMatches,false);
 }
});

test('refuses transient responses, contradictory flags, wrong root, duplicate keys and expired completion reads',async()=>{
 const {receipt,pins} = savedUpgradeCompletionFixture();
 for (const value of [{...receipt,package_sha256:pins.candidatePin},{already_current:true,package_sha256:pins.candidatePin},
  {...receipt,automatic_restart:true},{...receipt,consensus_started:true},{...receipt,resumed:'true'},
  {...receipt,root:'/other/Synergy'},{...receipt,old_package_sha256:receipt.new_package_sha256},
  JSON.stringify(receipt).replace('"resumed":true','"resumed":true,"resu\\u006ded":false')]) {
  await assert.rejects(compareSavedUpgradeCompletion(bytes(value),pins),/not a supported saved software upgrade completion receipt/);
 }
 await assert.rejects(compareSavedUpgradeCompletion({size:savedUpgradeLimits.completion+1,arrayBuffer:()=>assert.fail('oversize read')},pins),/at most/);
 await assert.rejects(compareSavedUpgradeCompletion(bytes(receipt),{...pins,candidatePin:pins.priorPin}),/distinct/);
 const file=bytes(receipt);
 let live=true;
 assert.equal(await compareSavedUpgradeCompletion({size:file.size,arrayBuffer:()=>{live=false;return file.arrayBuffer();}},pins,()=>live),null);
});

const ownerDirectory=process.env.SYNERGY_SAVED_UPGRADE_OWNER_FIXTURES;
test('compares the pinned owner upgrade writer with the fixture candidate',{skip:!ownerDirectory},async()=>{
 const intent=await readSavedUpgradeIntent(bytes(readFileSync(`${ownerDirectory}/upgrade-intent.json`,'utf8')));
 const fixture=savedUpgradeFixture();
 const result=await compareSavedUpgradeManifest(bytes(readFileSync(`${ownerDirectory}/candidate-package.json`,'utf8')),intent,fixture.references);
 assert.deepEqual(result.counts,{added:1,changed:1,removed:1,unchanged:1});
 assert.equal(result.registered,true);
});

const ownerCompletion = process.env.SYNERGY_SAVED_UPGRADE_COMPLETION_OWNER_FIXTURE;
test('compares the pinned owner completion writer',{skip:!ownerCompletion},async()=>{
 const {pins} = savedUpgradeCompletionFixture();
 const receipt = bytes(readFileSync(ownerCompletion,'utf8'));
 assert.deepEqual(await compareSavedUpgradeCompletion(receipt,pins),
  {...pins,priorMatches:true,candidateMatches:true,resumed:true,consensusStarted:false,automaticRestart:false});
});
