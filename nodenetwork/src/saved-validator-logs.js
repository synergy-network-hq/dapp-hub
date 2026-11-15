import {captureTime, exactObservationU64, parseExactNumbers} from './validator-operations-observation.js';

const schema = 'synergy.validator-operations.v1';
const unsupported = 'The file is not a supported saved Validator Operations log observation.';
export const savedValidatorLogLimit = 7 * 1024 * 1024;
export const savedLogSeverities = Object.freeze({
 TRACE:'Trace', DEBUG:'Debug', INFO:'Info', WARN:'Warning', ERROR:'Error', CRITICAL:'Critical', UNKNOWN:'Unknown',
});
export const savedLogSubsystems = Object.freeze({
 SERVICE:'Service', NETWORK:'Network', CONSENSUS:'Consensus', FINALITY:'Finality', POSY:'PoSy',
 PROTECTED_PIPELINE:'ProtectedPipeline', STORAGE:'Storage', UNKNOWN:'Unknown',
});

const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && Boolean(value.trim()) && !value.startsWith('\u0000');
const validSize = bytes => Number.isSafeInteger(bytes) && bytes > 0 && bytes <= savedValidatorLogLimit;

function utc(value) {
 if (typeof value !== 'string' || value.length > 40 || value !== value.trim()) throw Error(unsupported);
 captureTime(value);
 return value;
}

function projectLogs(value) {
 const snapshot = value && typeof value === 'object' && Object.hasOwn(value, 'logs');
 const logs = snapshot ? value.logs : value;
 let capturedAt = null;
 if (snapshot) {
  if (!fields(value, ['schema_version','snapshot_id','captured_at_utc','validator_id','status','preflight','logs'])
   || value.schema_version !== schema || typeof value.snapshot_id !== 'string'
   || value.snapshot_id.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.snapshot_id)
   || !identity(value.validator_id) || value.status?.schema_version !== schema || value.preflight?.schema_version !== schema
   || value.status?.discovery?.validator_id !== value.validator_id || value.preflight?.validator_id !== value.validator_id
   || logs?.validator_id !== value.validator_id) throw Error(unsupported);
  capturedAt = utc(value.captured_at_utc);
 }
 if (!fields(logs, ['schema_version','validator_id','generated_at_utc','entries','truncated'])
  || logs.schema_version !== schema || !identity(logs.validator_id) || typeof logs.truncated !== 'boolean'
  || !Array.isArray(logs.entries) || logs.entries.length > (snapshot ? 200 : 500)
  || (logs.truncated && logs.entries.length === 0)) throw Error(unsupported);
 const collectedAt = utc(logs.generated_at_utc);
 let previous = null;
 const rows = logs.entries.map(row => {
  if (!fields(row, ['sequence','observed_at_utc','severity','subsystem','message','redacted'])
   || row.observed_at_utc !== collectedAt || typeof row.severity !== 'string' || !Object.hasOwn(savedLogSeverities,row.severity)
   || typeof row.subsystem !== 'string' || !Object.hasOwn(savedLogSubsystems,row.subsystem)
   || typeof row.message !== 'string' || row.message.startsWith('\u0000') || typeof row.redacted !== 'boolean'
   || (row.redacted && row.message !== '[REDACTED SENSITIVE LOG LINE]')) throw Error(unsupported);
  const sequence = exactObservationU64(row.sequence);
  if (sequence === null) throw Error(unsupported);
  const current = BigInt(sequence);
  const firstPositionMatches = logs.truncated ? current > 0n : current === 0n;
  const inSequence = previous === null ? firstPositionMatches : current === previous + 1n;
  if (!inSequence) throw Error(unsupported);
  previous = current;
  return {sequence,severity:row.severity,subsystem:row.subsystem,ownerMarkedRedacted:row.redacted};
 });
 return {source:snapshot ? 'Saved diagnostic snapshot' : 'Saved structured log response', capturedAt,
  collectedAt, truncated:logs.truncated, rows};
}

export function parseSavedValidatorLogs(raw) {
 if (typeof raw !== 'string' || !validSize(raw.length) || !validSize(new TextEncoder().encode(raw).length)) throw Error(unsupported);
 try {
  return projectLogs(parseExactNumbers(raw));
 } catch {
  throw Error(unsupported);
 }
}

export async function readSavedValidatorLogs(file) {
 if (!validSize(file?.size)) throw Error('Choose a nonempty Validator Operations logs JSON file of at most 7 MiB.');
 let raw;
 try {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw Error();
  raw = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes);
 } catch {
  throw Error('The selected logs file could not be read as UTF-8.');
 }
 return parseSavedValidatorLogs(raw);
}

export function filterSavedValidatorLogs(rows, severity, subsystem) {
 return rows.filter(row => (severity === 'all' || row.severity === severity)
  && (subsystem === 'all' || row.subsystem === subsystem));
}

export function reviewSavedValidatorLogs(observation, sequences, now = Date.now()) {
 const staged = new Set(sequences);
 const rows = observation.rows.filter(row => staged.has(row.sequence));
 if (!staged.size || staged.size !== rows.length) throw Error('Select available log metadata before reviewing it.');
 return {schema:'nodenetwork-saved-log-review-v1', source:observation.source,
  capturedAt:observation.capturedAt, collectedAt:observation.collectedAt, sourceTruncated:observation.truncated,
  reviewedAt:new Date(now).toISOString(), rows:rows.map(({sequence,severity,subsystem,ownerMarkedRedacted}) =>
   ({sequence,severity,subsystem,ownerMarkedRedacted}))};
}
