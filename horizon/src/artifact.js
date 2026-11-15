export const MAX_ARTIFACT_BYTES = 2_000_000;
const SHA256 = /^[0-9a-f]{64}$/;
const MODEL_DIGEST = /^[0-9a-f]{64}$/i;
const MODEL_LABEL = /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]{1,200}$/u;
const encoder = new TextEncoder();

export class HorizonArtifactError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRecord(text, message) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HorizonArtifactError(message);
  }
}

function sameContent(left, right, depth = 0) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (depth >= 64) throw new HorizonArtifactError('The run record is nested too deeply.');
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) && sameContent(left[key], right[key], depth + 1)
  );
}

async function sha256(text, signal) {
  signal?.throwIfAborted();
  if (!globalThis.crypto?.subtle) {
    throw new HorizonArtifactError('SHA-256 is unavailable in this window.');
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  signal?.throwIfAborted();
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function inspectReplay(record, signal) {
  const replay = record.localReplay;
  if (replay == null) return null;
  if (!isObject(replay) || replay.runs !== 2 || replay.temperature !== 0 || replay.seed !== 0
    || replay.inferenceVerified !== false || typeof replay.secondOutput !== 'string') {
    throw new HorizonArtifactError('The recorded replay uses an unsupported format.');
  }

  const exactOutputMatch = record.output === replay.secondOutput;
  const sameModelPromptAndRuntime = [
    [record.model, replay.secondModel],
    [record.prompt, replay.secondPrompt],
    [record.runtime, replay.secondRuntime],
  ].every(([first, second]) => typeof first === 'string' && first.length > 0 && first === second);
  const sameReportedModelDigest = typeof record.reportedModelDigest === 'string'
    && MODEL_DIGEST.test(record.reportedModelDigest)
    && record.reportedModelDigest === replay.secondReportedModelDigest;
  const repeatabilityMatched = exactOutputMatch && sameModelPromptAndRuntime && sameReportedModelDigest;
  const [firstOutputSha256, secondOutputSha256] = await Promise.all([
    sha256(record.output, signal),
    sha256(replay.secondOutput, signal),
  ]);

  if (replay.firstOutputSha256 !== firstOutputSha256 || replay.secondOutputSha256 !== secondOutputSha256
    || replay.exactOutputMatch !== exactOutputMatch || replay.sameModelPromptAndRuntime !== sameModelPromptAndRuntime
    || replay.sameReportedModelDigest !== sameReportedModelDigest || replay.repeatabilityMatched !== repeatabilityMatched) {
    throw new HorizonArtifactError('The replay summary disagrees with its recorded inputs or outputs.');
  }
  return {exactOutputMatch, sameModelPromptAndRuntime, sameReportedModelDigest};
}

export async function inspectHorizonRun(text, signal) {
  signal?.throwIfAborted();
  if (typeof text !== 'string' || text.length > MAX_ARTIFACT_BYTES || encoder.encode(text).length > MAX_ARTIFACT_BYTES) {
    throw new HorizonArtifactError('Choose a Horizon run artifact of 2 MB or less.');
  }
  const artifact = parseRecord(text, 'The file is not readable JSON.');
  const record = artifact?.record;
  if (!isObject(artifact) || !isObject(record) || record.schemaVersion !== 1
    || record.kind !== 'horizon-local-run' || record.verification !== 'unverified-local-inference'
    || typeof record.model !== 'string' || !MODEL_LABEL.test(record.model) || !record.model.trim()
    || typeof record.prompt !== 'string' || typeof record.output !== 'string'
    || typeof artifact.hashContent !== 'string' || typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) {
    throw new HorizonArtifactError('Choose a version 1 Horizon local run export with its hashed content.');
  }

  const hashedRecord = parseRecord(artifact.hashContent, 'The hashed content is not a readable run record.');
  if (!sameContent(record, hashedRecord)) {
    throw new HorizonArtifactError('The run record differs from its hashed content.');
  }
  if (await sha256(artifact.hashContent, signal) !== artifact.sha256) {
    throw new HorizonArtifactError('The run content does not match its SHA-256 digest.');
  }
  const replay = await inspectReplay(record, signal);
  signal?.throwIfAborted();
  let outputCharacters = 0;
  for (const character of record.output) outputCharacters++;
  return {
    model: record.model,
    outputCharacters,
    sha256: artifact.sha256,
    replay,
    receiptFieldPresent: artifact.receipt != null,
  };
}

export async function inspectHorizonFile(file, signal) {
  signal.throwIfAborted();
  if (file.size > MAX_ARTIFACT_BYTES) throw new HorizonArtifactError('Choose a Horizon run artifact of 2 MB or less.');
  const reader = new FileReader();
  const abortRead = () => reader.abort();
  signal.addEventListener('abort', abortRead, {once: true});
  let bytes;
  try {
    bytes = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new HorizonArtifactError('The file could not be read. Choose it again to retry.'));
      reader.onabort = () => reject(signal.reason);
      reader.readAsArrayBuffer(file.slice(0, MAX_ARTIFACT_BYTES + 1));
    });
  } finally {
    signal.removeEventListener('abort', abortRead);
  }
  signal.throwIfAborted();
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new HorizonArtifactError('Choose a Horizon run artifact of 2 MB or less.');
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new HorizonArtifactError('Choose a Horizon run export encoded as UTF-8.');
  }
  return inspectHorizonRun(text, signal);
}
