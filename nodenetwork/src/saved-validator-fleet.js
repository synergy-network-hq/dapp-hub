import {expectedSavedValidatorHealth,savedReleaseDifferences} from './saved-validator-diagnostics.js';
import {captureTime,exactObservationU64,parseExactNumbers,projectSavedValidatorStatus} from './validator-operations-observation.js';

const schema = 'synergy.validator-operations.v1';
const unsupported = 'The file is not a supported saved Validator Operations cluster status.';
export const savedFleetLimit = 4 * 1024 * 1024;
const maxValidators = 64;
const encoder = new TextEncoder();
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const captureLabel = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128
 && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value);
const exactSet = (value,expected) => Array.isArray(value) && value.length === expected.size
 && new Set(value).size === expected.size && value.every(item => expected.has(item));

function ownerOrdered(identities) {
 const keys = identities.map(identity=>encoder.encode(identity));
 return keys.every((key,index) => {
  if (index === 0) return true;
  const previous = keys[index-1];
  for (let offset=0; offset<Math.min(key.length,previous.length); offset++) {
   if (key[offset] !== previous[offset]) return previous[offset] < key[offset];
  }
  return previous.length < key.length;
 });
}

function statusRow(status) {
 const {headHeight,finalizedHeight,syncTargetHeight,serviceState} = projectSavedValidatorStatus(status);
 const {validator_id:id,chain_id:chainId,network,incarnation} = status.discovery;
 const genesis = status.release.genesis_hash;
 if (![id,chainId,network,incarnation,genesis].every(captureLabel)) throw Error(unsupported);
 const capturedAt = status.generated_at_utc;
 captureTime(capturedAt);
 return {id,chainId,network,incarnation,genesis,capturedAt,headHeight,finalizedHeight,syncTargetHeight,serviceState};
}

function releaseDifferences(validators,rows,reported) {
 const reference = validators[0]?.release;
 const mismatches = new Map();
 const individual = validators.map((status,index) => {
  const fields = savedReleaseDifferences(status);
  const combined = new Set(fields);
  for (const name of Object.keys(status.release)) {
   if (status.release[name] !== reference[name]) combined.add(name);
  }
  if (combined.size) mismatches.set(rows[index].id,combined);
  return fields;
 });
 const consistent = validators.length > 0 && !mismatches.size;
 const groups = reported?.mismatched_fields_by_validator;
 if (reported?.consistent !== consistent || (reported.reference_validator_id ?? null) !== (rows[0]?.id ?? null)
  || !exactSet(reported.mismatched_validator_ids,new Set(mismatches.keys()))
  || !object(groups) || Object.keys(groups).length !== mismatches.size
  || [...mismatches].some(([id,fields]) => !Object.hasOwn(groups,id) || !exactSet(groups[id],fields))) throw Error(unsupported);

 return {consistent,mismatches,individual};
}

function commonHeight(rows,key,unavailable) {
 const first = rows[0]?.[key];
 return !unavailable.length && rows.every(row => row[key] === first) ? first ?? null : null;
}

function optionalHeight(value) {
 if (value == null) return null;
 const height = exactObservationU64(value);
 if (height === null) throw Error(unsupported);
 return height;
}

function projectFleet(value) {
 if (!object(value) || value.schema_version !== schema || !Array.isArray(value.validators)
  || !Array.isArray(value.unavailable_validator_ids)
  || value.validators.length + value.unavailable_validator_ids.length > maxValidators) throw Error(unsupported);
 const raws = value.validators;
 const rows = raws.map(statusRow);
 const unavailable = value.unavailable_validator_ids;
 const returned = rows.map(row=>row.id);
 const identities = [...returned,...unavailable];
 if (!unavailable.every(captureLabel) || new Set(identities).size !== identities.length
  || !ownerOrdered(returned) || !ownerOrdered(unavailable)) throw Error(unsupported);
 const release = releaseDifferences(raws,rows,value.release_consistency);

 const current = rows.reduce((latest,row) => row.capturedAt > latest ? row.capturedAt : latest,'');
 const head = commonHeight(rows,'headHeight',unavailable);
 const finalized = commonHeight(rows,'finalizedHeight',unavailable);
 const quorum = rows.length > 0 && raws.every(status => status.chain.quorum_available);
 const divergence = head === null || finalized === null || !release.consistent || raws.some(status => status.chain.divergence_detected);
 if (value.generated_at_utc !== current || optionalHeight(value.common_head_height) !== head
  || optionalHeight(value.common_finalized_height) !== finalized || value.quorum_available !== quorum
  || value.divergence_detected !== divergence) throw Error(unsupported);

 const [reference] = rows;
 const shared = rows.length > 0 && rows.every(({chainId,network,incarnation,genesis}) =>
  chainId === reference.chainId && network === reference.network && incarnation === reference.incarnation && genesis === reference.genesis);
 return {
  reportedAt:current || null,
  unavailable,
  sharedChain:shared ? {chainId:reference.chainId,network:reference.network,incarnation:reference.incarnation} : null,
  commonHead:shared ? head : null,
  commonFinalized:shared ? finalized : null,
  returnedQuorum:shared ? quorum : null,
  reportedDivergence:shared ? divergence : null,
  rows:rows.map((row,index) => {
   const status = raws[index];
   const health = release.consistent ? expectedSavedValidatorHealth(status,release.individual[index]) : 'RELEASE_MISMATCH';
   if (status.health?.classification !== health || status.liveness?.health !== health) throw Error(unsupported);
   const {genesis,...display} = row;
   return {...display,health,releaseDifferences:[...(release.mismatches.get(row.id) ?? [])].sort()};
  }),
 };
}

export function parseSavedValidatorFleet(raw) {
 if (typeof raw !== 'string' || raw.length > savedFleetLimit || encoder.encode(raw).length > savedFleetLimit) throw Error(unsupported);
 try {return projectFleet(parseExactNumbers(raw));} catch {throw Error(unsupported);}
}

export async function readSavedValidatorFleet(file,current = () => true) {
 if (!Number.isSafeInteger(file?.size) || file.size < 1 || file.size > savedFleetLimit) {
  throw Error('Choose a Validator Operations cluster status JSON file of at most 4 MiB.');
 }
 if (!current()) return null;
 let raw;
 try {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw Error();
  raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 } catch {throw Error('The selected cluster status could not be read in full as UTF-8.');}
 return current() ? parseSavedValidatorFleet(raw) : null;
}
