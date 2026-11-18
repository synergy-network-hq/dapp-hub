import {digest, tokenConstructor} from './model.js';

export const executionReportLimit = 2_000_000;
const scope = 'isolated-local-constructor';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function parseJson(text, message) {
 try {return JSON.parse(text);}
 catch {throw Error(message);}
}

function equalJson(first, second) {
 // Compare reordered Rust/JavaScript objects without recursing into untrusted JSON.
 const pending = [[first, second]];
 while (pending.length) {
  const [left, right] = pending.pop();
  if (left === right) continue;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
   || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
   if (!Object.hasOwn(right, key)) return false;
   pending.push([left[key], right[key]]);
  }
 }
 return true;
}

async function checkBinding(value, content, hash, label) {
 const message = `${label} content or digest does not match.`;
 if (typeof content !== 'string' || !sha256(hash)
  || !equalJson(parseJson(content, message), value) || await digest(content) !== hash) {
  throw Error(message);
 }
}

export async function inspectSparkExecution(text) {
 if (typeof text !== 'string' || text.length > executionReportLimit
  || new TextEncoder().encode(text).length > executionReportLimit) {
  throw Error('Execution report exceeds 2 MB.');
 }
 const file = parseJson(text, 'Execution report is unreadable JSON.');
 const record = file?.record;
 const binding = record?.binding;
 const result = record?.result;
 if (record?.schemaVersion !== 1 || record.kind !== 'spark-local-execution-report'
  || record.scope !== scope || record.signature !== 'unsigned-local-observation'
  || record.networkSubmitted !== false || record.walletAuthenticated !== false
  || !object(binding) || typeof binding.source !== 'string' || !object(binding.artifact)
  || !Array.isArray(binding.constructorArgs) || typeof binding.testCaller !== 'string'
  || !binding.testCaller.length || binding.testCaller.length > 128 || /[\x00-\x1f\x7f]/.test(binding.testCaller)) {
  throw Error('Unsupported isolated execution report.');
 }
 if (!object(result) || result.scope !== scope || result.networkSubmitted !== false || result.walletAuthenticated !== false
  || result.callValueNwei !== '0' || result.gasLimit !== 1_000_000
  || !['Succeeded', 'Reverted', 'Failed'].includes(result.status) || !sha256(record.workerSha256)) {
  throw Error('Unsupported local runtime result.');
 }

 await Promise.all([
  checkBinding(record, file.hashContent, file.sha256, 'Report'),
  checkBinding(binding, record.bindingContent, record.bindingSha256, 'Input binding'),
  checkBinding(binding.artifact, record.artifactContent, record.artifactSha256, 'Artifact binding'),
 ]);
 if (!sha256(record.sourceSha256) || await digest(binding.source) !== record.sourceSha256
  || binding.artifact.hashes?.source !== record.sourceSha256) {
  throw Error('Source and compiled artifact binding do not match.');
 }
 const planBound = binding.plan != null;
 if (planBound) {
  await checkBinding(binding.plan, record.planContent, record.planSha256, 'Plan binding');
  const review = tokenConstructor(binding.plan, binding.constructorArgs[2], binding.constructorArgs[4]);
  if (!['PQCToken', 'SparkLaunchToken'].includes(binding.artifact.abi?.contract)
   || !equalJson(review.arguments, binding.constructorArgs)) {
   throw Error('Plan does not match token constructor arguments.');
  }
 } else if (record.planSha256 !== null) {
  throw Error('Unexpected plan digest.');
 }

 return {
  contentMatches: true,
  status: result.status,
  testCaller: binding.testCaller,
  sourceSha256: record.sourceSha256,
  planBound,
  originAuthenticated: false,
  networkSubmitted: false,
 };
}
