import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {readUpgradeConfigurationManifest,readUpgradeConfigurationSchema,reviewUpgradeConfiguration} from '../src/upgrade-configuration.js';
import {configurationDigest,nodeConfigurationFixture,upgradeManifestFixture,upgradeSchemaFixture} from './fixtures/upgrade-configuration.mjs';

const file = raw=>new Blob([typeof raw==='string'?raw:JSON.stringify(raw)]);
const schemaRaw = JSON.stringify(upgradeSchemaFixture());
const fixture = upgradeManifestFixture(schemaRaw);

async function read(schema = schemaRaw) {
 const selections = upgradeManifestFixture(schema);
 const manifest = await readUpgradeConfigurationManifest(file(selections.manifest),selections.references);
 return readUpgradeConfigurationSchema(file(schema),manifest);
}

test('requires the exact draft release and both raw byte digests before review',async()=>{
 const manifest = await readUpgradeConfigurationManifest(file(fixture.manifest),fixture.references);
 assert.deepEqual(manifest,{schemaPin:configurationDigest(schemaRaw)});
 await assert.rejects(readUpgradeConfigurationManifest(file(fixture.manifest.trim()),fixture.references),/references in the update draft/);
 await assert.rejects(readUpgradeConfigurationManifest(file(fixture.manifest),{...fixture.references,release_id:'different'}),/references in the update draft/);
 const missing=upgradeManifestFixture(schemaRaw,{'bin/synergy-node':'0'.repeat(64)});
 await assert.rejects(readUpgradeConfigurationManifest(file(missing.manifest),missing.references),/does not declare/);
 await assert.rejects(readUpgradeConfigurationSchema(file(schemaRaw+'\n'),manifest),/schema SHA-256 differs/);
 const duplicate=schemaRaw.replace('"type":"object"','"type":"object","ty\\u0070e":"object"');
 await assert.rejects(read(duplicate),/outside the supported/);
 await assert.rejects(read(JSON.stringify({...upgradeSchemaFixture(),'$ref':'https://unsupported.example.invalid/schema'})),/outside the supported/);
});

test('applies the owner type, constant, required, closed-field and array item checks without returning field names or values',async()=>{
 const schema=await read();
 const valid=nodeConfigurationFixture();
 assert.deepEqual(await reviewUpgradeConfiguration(file(valid),schema),{status:'matched'});
 const {node_name,...missing}=valid;
 for (const [value,status] of [[missing,'missing'],[{...valid,schema_version:2},'constant'],
  [{...valid,storage:null},'type'],[{...valid,network:{listen_addresses:[123]}},'type'],
  [{...valid,storage:{...valid.storage,'fixture-private-unknown-field':'fixture-private-data'}},'extra'],
  [JSON.stringify(valid).replace('"minimum_free_bytes":0','"minimum_free_bytes":18446744073709551615'),'matched'],
  [JSON.stringify(valid).replace('"minimum_free_bytes":0','"minimum_free_bytes":1e0'),'type']]) {
  assert.deepEqual(await reviewUpgradeConfiguration(file(value),schema),{status});
 }
 const duplicate=JSON.stringify(valid).replace('"chain_id":1266','"chain_id":1266,"chain_i\\u0064":1266');
 await assert.rejects(reviewUpgradeConfiguration(file(duplicate),schema),/unambiguous JSON/);
});

test('bounds file reads and retires raw configuration when scope changes during the pending selection',async()=>{
 const schema=await read();
 const tooLarge={size:128*1024+1,arrayBuffer:()=>assert.fail('oversize input opened')};
 await assert.rejects(reviewUpgradeConfiguration(tooLarge,schema),/at most 131,072 bytes/);
 await assert.rejects(readUpgradeConfigurationSchema(tooLarge,{}),/at most 131,072 bytes/);
 await assert.rejects(reviewUpgradeConfiguration({size:5,arrayBuffer:async()=>new ArrayBuffer(0)},schema),/as UTF-8/);
 assert.equal(await reviewUpgradeConfiguration({size:1,arrayBuffer:()=>assert.fail('retired input opened')},schema,()=>false),null);
 let current=true;
 const config=file(nodeConfigurationFixture());
 const pending={size:config.size,arrayBuffer:()=>{current=false;return config.arrayBuffer();}};
 assert.equal(await reviewUpgradeConfiguration(pending,schema,()=>current),null);
});

const ownerDir = process.env.SYNERGY_UPGRADE_CONFIG_OWNER_FIXTURES;
test('matches the pinned owner-generated schema and Python validator on shared cases',{skip:!ownerDir},async()=>{
 const schema=await read(readFileSync(`${ownerDir}/candidate-schema.json`,'utf8'));
 const cases=JSON.parse(readFileSync(`${ownerDir}/owner-verdicts.json`,'utf8'));
 assert.ok(cases.length>=6);
 for (const {name,status} of cases) {
  const config=readFileSync(`${ownerDir}/${name}.json`,'utf8');
  assert.deepEqual(await reviewUpgradeConfiguration(file(config),schema),{status},name);
 }
});
