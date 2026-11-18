import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import init, {compileSynq} from '../../forge-projects/src/lib/ide/generated/synq_compiler.js';
import {digest, tokenConstructor} from '../src/model.js';
import {executionReportLimit, inspectSparkExecution} from '../src/execution-report.js';

await init({module_or_path: await readFile(new URL('../../forge-projects/assets/compiler/synq_compiler_bg.wasm', import.meta.url))});
const scope = 'isolated-local-constructor';
const plan = {totalSupply: '1000', symbol: 'FIX', name: 'Fixture', chainId: 1266, kind: 'spark-launch-plan'};

async function fixture(boundPlan = null) {
 const contract = boundPlan ? 'SparkLaunchToken' : 'SparkLaunchRegistry';
 const source = await readFile(new URL(`../contracts/${contract}.synq`, import.meta.url), 'utf8');
 const compiled = compileSynq(source);
 assert.equal(compiled.ok, true);
 const artifact = compiled.artifacts;
 const args = boundPlan ? tokenConstructor(boundPlan, 9, '01'.repeat(2592)).arguments : [];
 const binding = {source, artifact, constructorArgs: args, testCaller: 'synw1pqwglyfjynrxt7ms9nvggntav6x3lx9c2l4r', plan: boundPlan};
 const bindingContent = JSON.stringify(binding);
 const artifactContent = JSON.stringify(artifact);
 const planContent = boundPlan ? JSON.stringify(boundPlan) : null;
 return {
  schemaVersion: 1, kind: 'spark-local-execution-report', scope, signature: 'unsigned-local-observation',
  networkSubmitted: false, walletAuthenticated: false,
  binding, bindingContent, bindingSha256: await digest(bindingContent),
  artifactContent, artifactSha256: await digest(artifactContent), sourceSha256: await digest(source),
  planContent, planSha256: planContent ? await digest(planContent) : null, workerSha256: 'a'.repeat(64),
  result: {scope, status: 'Succeeded', networkSubmitted: false, walletAuthenticated: false, callValueNwei: '0', gasLimit: 1_000_000},
 };
}

async function serialize(record) {
 const reordered = Object.fromEntries(Object.entries(record).reverse());
 const hashContent = JSON.stringify(reordered);
 return JSON.stringify({record, hashContent, sha256: await digest(hashContent)});
}

test('accepts the preserved unsigned report format with real compiled registry artifacts', async () => {
 const record = await fixture();
 const reviewed = await inspectSparkExecution(await serialize(record));
 assert.deepEqual(reviewed, {
  contentMatches: true, status: 'Succeeded', testCaller: record.binding.testCaller,
  sourceSha256: record.sourceSha256, planBound: false, originAuthenticated: false, networkSubmitted: false,
 });
});

test('binds reordered v1 plan objects to the exact token constructor arguments', async () => {
 const record = await fixture(plan);
 record.binding.plan = Object.fromEntries(Object.entries(plan).reverse());
 assert.equal((await inspectSparkExecution(await serialize(record))).planBound, true);
 record.binding.constructorArgs[3] = '1000';
 record.bindingContent = JSON.stringify(record.binding);
 record.bindingSha256 = await digest(record.bindingContent);
 await assert.rejects(() => serialize(record).then(inspectSparkExecution), /constructor arguments/);
});

test('rejects rehashed outer records with altered digests, scope, or execution flags', async () => {
 const record = await fixture();
 for (const change of [
  {bindingContent: '{}'}, {artifactContent: '{}'}, {sourceSha256: '0'.repeat(64)}, {networkSubmitted: true},
  {walletAuthenticated: true}, {planSha256: '0'.repeat(64)}, {result: {...record.result, callValueNwei: '1'}},
 ]) await assert.rejects(() => serialize({...record, ...change}).then(inspectSparkExecution));
 await assert.rejects(() => inspectSparkExecution('{invalid'), /unreadable JSON/);
 await assert.rejects(() => inspectSparkExecution('é'.repeat(executionReportLimit / 2 + 1)), /exceeds 2 MB/);
});
