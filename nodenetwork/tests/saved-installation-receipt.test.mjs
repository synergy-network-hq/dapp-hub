import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareSavedInstallationReceipt,readInstallationPackageManifest,savedInstallationReceiptLimit} from '../src/saved-installation-receipt.js';
import {installationReceiptFixture,manifestPin} from './fixtures/saved-installation-receipt.mjs';

const bytes = value => new Blob([typeof value==='string'?value:JSON.stringify(value)]);
const allMatch = {rootMatches:true,validatorRole:true,networkMatches:true,chainMatches:true,nodeNameMatches:true,
 digestMatches:true,inventoryMatches:true,declaredMembers:2};
const refusal = /not a supported saved NodeNetwork installation receipt/;

test('compares exact draft references and projects only fixed findings and inventory count',async()=>{
 const {draft,manifest,receipt} = installationReceiptFixture();
 const selected = await readInstallationPackageManifest(bytes(manifest),draft);
 receipt.package_files = Object.fromEntries(Object.entries(receipt.package_files).reverse());
 assert.deepEqual(await compareSavedInstallationReceipt(bytes(receipt),selected,draft),allMatch);
 await assert.rejects(readInstallationPackageManifest(bytes(manifest.trim()),draft),/references in the provisioning draft/);
 await assert.rejects(readInstallationPackageManifest(bytes(manifest),{...draft,release_id:'another'}),/references in the provisioning draft/);
 await assert.rejects(compareSavedInstallationReceipt(bytes(receipt),selected,{...draft,manifest_sha256:'d'.repeat(64)}),/current provisioning draft/);
});

test('reports root, role, identity, manifest and complete declaration drift independently',async()=>{
 const {draft,manifest,receipt} = installationReceiptFixture();
 const selected = await readInstallationPackageManifest(bytes(manifest),draft);
 for (const [field,value,verdict] of [
  ['root','/different/Synergy','rootMatches'],['role','rpc_gateway','validatorRole'],['network_id','different','networkMatches'],
  ['chain_id',99999,'chainMatches'],['node_name','different','nodeNameMatches'],['package_sha256','d'.repeat(64),'digestMatches'],
  ['package_files',{'bin/synergy-node':'a'.repeat(64),'assets/another.json':'b'.repeat(64)},'inventoryMatches'],
  ['package_files',{...receipt.package_files,'bin/synergy-node':'d'.repeat(64)},'inventoryMatches'],
 ]) {
  assert.deepEqual(await compareSavedInstallationReceipt(bytes({...receipt,[field]:value}),selected,draft),
   {...allMatch,[verdict]:false});
 }
 const exactU64 = JSON.stringify(receipt).replace('"chain_id":1266','"chain_id":18446744073709551615');
 assert.deepEqual(await compareSavedInstallationReceipt(bytes(exactU64),selected,draft),{...allMatch,chainMatches:false});
});

test('rejects malformed, ambiguous or oversized records and retires stale reads',async()=>{
 const {draft,manifest,receipt} = installationReceiptFixture();
 const selected = await readInstallationPackageManifest(bytes(manifest),draft);
 for (const change of [
  {format:'other'}, {root:null}, {role:'unqualified'}, {chain_id:'1266'}, {chain_id:0}, {network_id:'trailing\n'},
  {node_name:'trailing\n'}, {package_sha256:'d'.repeat(63)+'\n'}, {package_files:null},
  {package_files:{'roles/../keys/private':'f'.repeat(64)}},
  {package_files:{'bin/node':'a'.repeat(64),'bin/node/child':'f'.repeat(64)}},
 ]) await assert.rejects(compareSavedInstallationReceipt(bytes({...receipt,...change}),selected,draft),refusal);
 for (const raw of [JSON.stringify(receipt).replace('"chain_id":1266','"chain_id":18446744073709551616'),
  JSON.stringify(receipt).replace('"chain_id":1266','"chain_id":1266,"chain_\\u0069d":0')]) {
  await assert.rejects(compareSavedInstallationReceipt(bytes(raw),selected,draft),refusal);
 }
 for (const field of ['chain_id','network_id','node_name']) {
  await assert.rejects(compareSavedInstallationReceipt(bytes(receipt),selected,{...draft,[field]:draft[field]+'\n'}),/Enter/);
 }
 await assert.rejects(compareSavedInstallationReceipt({size:savedInstallationReceiptLimit+1,arrayBuffer:()=>assert.fail('unexpected read')},
  selected,draft),/at most/);
 await assert.rejects(compareSavedInstallationReceipt(new Blob([new Uint8Array([255])]),selected,draft),/as UTF-8/);
 const file = bytes(receipt);
 let current = true;
 assert.equal(await compareSavedInstallationReceipt({size:file.size,arrayBuffer:()=>{current=false;return file.arrayBuffer();}},
  selected,draft,()=>current),null);
});

const ownerDirectory = process.env.SYNERGY_INSTALLATION_RECEIPT_OWNER_FIXTURES;
test('accepts the exact pinned owner installation record writer and separately pinned manifest',{skip:!ownerDirectory},async()=>{
 const raw = readFileSync(`${ownerDirectory}/package.json`,'utf8');
 const draft = {...installationReceiptFixture().draft,manifest_sha256:manifestPin(raw)};
 const selected = await readInstallationPackageManifest(bytes(raw),draft);
 const receipt = readFileSync(`${ownerDirectory}/installation.json`,'utf8');
 assert.deepEqual(await compareSavedInstallationReceipt(bytes(receipt),selected,draft),allMatch);
});
