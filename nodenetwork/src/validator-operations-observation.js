// Node Control Panel 608f2529: control-service/src/validator_operations.rs.
import {projectSavedHostPreflight} from './saved-host-preflight.js';

export const validatorObservationLimit = 1024 * 1024;
const schemaVersion = 'synergy.validator-operations.v1';
const unsupported = 'The file is not a supported Validator Operations v1 observation.';
const integerMarker = '\u0000';
const uint64Max = 18446744073709551615n;
const uint32Max = 4294967295n;

// Validate JSON syntax first. Preserve numeric tokens for Rust u64 fields without
// rounding through Number. Reject ambiguous duplicate keys, including escapes.
export function parseExactNumbers(raw) {
 JSON.parse(raw);
 const objectKeys = [];
 const tokens = /("(?:[^"\\]|\\[\s\S])*")([ \t\r\n]*:)?|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]/g;
 const normalized = raw.replace(tokens, (token, quoted, separator) => {
  if (quoted) {
   const decoded = JSON.parse(quoted);
   if (decoded.includes(integerMarker)) throw Error(unsupported);
   if (separator) {
    const keys = objectKeys[objectKeys.length - 1];
    if (keys.has(decoded)) throw Error(unsupported);
    keys.add(decoded);
   }
   return token;
  }
  if (token === '{' || token === '[') {
   if (objectKeys.length >= 8) throw Error(unsupported);
   objectKeys.push(token === '{' ? new Set() : null);
  } else if (token === '}' || token === ']') objectKeys.pop();
  else return JSON.stringify(integerMarker + token);
  return token;
 });
 return JSON.parse(normalized);
}

const text = value => typeof value === 'string' && !value.startsWith(integerMarker);
const nonempty = value => text(value) && Boolean(value.trim());
const boolean = value => typeof value === 'boolean';
const oneOf = (...values) => value => values.includes(value);
const numberSource = value => typeof value === 'string' && value.startsWith(integerMarker) ? value.slice(1) : '';
const uint = limit => value => {
 const source = numberSource(value);
 return /^(0|[1-9]\d{0,19})$/.test(source) && BigInt(source) <= limit;
};
const u32 = uint(uint32Max);
const u64 = uint(uint64Max);
export function exactObservationU64(value) {
 return u64(value) ? numberSource(value) : null;
}
const percent = value => {
 const source = numberSource(value);
 const numeric = Number(source);
 return Boolean(source) && Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
};
const shape = (required, optional = {}) => value => {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 return Object.keys(value).every(key => Object.hasOwn(required, key) || Object.hasOwn(optional, key))
  && Object.entries(required).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]))
  && Object.entries(optional).every(([key, check]) => !Object.hasOwn(value, key) || value[key] === null || check(value[key]));
};

const progress = oneOf('ADVANCING', 'STABLE', 'STALLED', 'UNKNOWN');
const certificate = oneOf('MISSING', 'COLLECTING', 'FORMED', 'REJECTED');
const preflight = shape({id: text, status: oneOf('PASS', 'FAIL', 'UNKNOWN'), detail: text});
const releaseFields = {
 release_id: nonempty, release_tag: nonempty, binary_sha256: value => text(value) && /^[a-fA-F0-9]{64}$/.test(value),
 core_revision: nonempty, synq_revision: nonempty, aegis_revision: nonempty, genesis_hash: nonempty, protocol_version: nonempty,
 protected_pipeline_version: nonempty, validator_config_version: nonempty,
};
const release = shape(releaseFields);
const observation = shape({
 schema_version: oneOf(schemaVersion), observed_at_utc: text,
 discovery: shape({
  validator_id: nonempty, hostname: text, chain_id: nonempty, network: nonempty, incarnation: nonempty,
  validator_public_key_fingerprint: text, consensus_public_key_fingerprint: text, ingress_public_key_fingerprint: text,
  key_binding_status: text, vpn_address: text, p2p_address: text, management_address: text, data_path: text,
 }, {rpc_address: text}),
 release,
 service: shape({state: oneOf('ACTIVE', 'ACTIVATING', 'INACTIVE', 'FAILED', 'UNKNOWN'), unit_identity: text, uptime_seconds: u64, restart_count: u64}, {process_id: u32}),
 peers: shape({p2p_listener_ready: boolean, connected_peer_count: u32, authenticated_validator_peer_count: u32, expected_validator_peer_count: u32, peer_quorum_threshold: u32}),
 chain: shape({
  head_height: u64, finalized_height: u64, head_progress: progress, finality_progress: progress, sync_target_height: u64,
  quorum_available: boolean, divergence_detected: boolean,
 }, {last_finalized_at_utc: text, millis_since_last_finalized: u64}),
 posy: shape({
  current_height: u64, finalized_height: u64, current_view: u64, expected_proposer: text, proposal_seen: boolean,
  validation_votes: u32, validation_votes_required: u32, vc_status: certificate, finality_votes: u32, finality_votes_required: u32,
  qc_status: certificate, view_change_count: u64,
 }, {last_finalized_at_utc: text}),
 protected_pipeline: shape({
  target_height: u64, source: oneOf('GENESIS_BOOTSTRAP', 'NORMAL_ETDAG', 'NORMAL_ETDAG_STEADY_STATE'),
  phase: oneOf('GENESIS_BOOTSTRAP', 'COLLECTING', 'CUTOFF_READY', 'CUT_READY', 'ORDER_READY', 'COMMITTED_IN_PARENT', 'REVEAL_AUTHORIZED', 'REVEALING', 'READY_FOR_EXECUTION', 'CONSUMED', 'FAILED'),
  availability_count: u32, availability_required: u32, cutoff_marker_count: u32, cutoff_markers_required: u32,
  cut_ready: boolean, order_ready: boolean, reveal_authorized: boolean, reveal_share_count: u32, reveal_shares_required: u32,
  execution_ready: boolean, consumed: boolean,
 }, {cut_root: text, protected_batch_root: text, parent_commitment: text}),
 resources: shape({
  cpu_percent: percent, memory_bytes: u64, memory_percent: percent, disk_used_percent: percent,
  network_rx_bytes_per_second: u64, network_tx_bytes_per_second: u64,
 }),
}, {expected_release: release, preflight: value => Array.isArray(value) && value.every(preflight)});

const numeric = value => BigInt(numberSource(value));
function validThreshold(observed, required) {
 const threshold = numeric(required);
 return threshold > 0n && numeric(observed) <= threshold * 2n;
}

// Mirror the owner's structural consistency checks before deriving a finding.
function consistent({chain, posy, protected_pipeline: pipeline}) {
 const normal = pipeline.source !== 'GENESIS_BOOTSTRAP';
 if (numeric(chain.finalized_height) > numeric(chain.head_height) || numeric(posy.finalized_height) > numeric(posy.current_height)
  || (pipeline.cut_ready && !nonempty(pipeline.cut_root)) || (pipeline.order_ready && !nonempty(pipeline.protected_batch_root))
  || (pipeline.parent_commitment != null && !nonempty(pipeline.parent_commitment))
  || (pipeline.reveal_authorized && !pipeline.parent_commitment)
  || (normal && pipeline.execution_ready && !pipeline.reveal_authorized) || (pipeline.consumed && !pipeline.execution_ready)
  || numeric(pipeline.target_height) > numeric(posy.current_height) + 2n
  || !validThreshold(posy.validation_votes, posy.validation_votes_required)
  || !validThreshold(posy.finality_votes, posy.finality_votes_required)) return false;
 return !normal || (validThreshold(pipeline.availability_count, pipeline.availability_required)
  && validThreshold(pipeline.cutoff_marker_count, pipeline.cutoff_markers_required)
  && validThreshold(pipeline.reveal_share_count, pipeline.reveal_shares_required));
}

const below = (observed, required) => numeric(observed) < numeric(required);
const count = (observed, required) => `${numberSource(observed)} of ${numberSource(required)} required`;
const missing = (from, to, evidence) => ({from, to, evidence});

// Order follows the pinned owner's diagnose_first_missing_transition. The
// reasons use fixed labels, validated enum values and exact integer counts.
function firstMissingTransition({service, peers, posy, protected_pipeline: pipeline}) {
 if (service.state !== 'ACTIVE') {
  return missing('SERVICE.START_REQUESTED', 'SERVICE.ACTIVE', `Saved service state is ${service.state}.`);
 }
 if (!peers.p2p_listener_ready) {
  return missing('P2P.CONFIGURED', 'P2P.LISTENING', 'The saved observation reports that the P2P listener was unready.');
 }
 if (below(peers.authenticated_validator_peer_count, peers.peer_quorum_threshold)) {
  return missing('P2P.LISTENING', 'P2P.VALIDATOR_QUORUM',
   `Authenticated validator peers reached ${count(peers.authenticated_validator_peer_count, peers.peer_quorum_threshold)}.`);
 }

 const normal = pipeline.source !== 'GENESIS_BOOTSTRAP';
 if (normal) {
  if (below(pipeline.availability_count, pipeline.availability_required)) {
   return missing('PROTECTED_PIPELINE.COLLECTING', 'PROTECTED_PIPELINE.AVAILABILITY_QUORUM',
    `Availability evidence reached ${count(pipeline.availability_count, pipeline.availability_required)}.`);
  }
  if (below(pipeline.cutoff_marker_count, pipeline.cutoff_markers_required)) {
   return missing('PROTECTED_PIPELINE.AVAILABILITY_QUORUM', 'PROTECTED_PIPELINE.CUTOFF_READY',
    `Cutoff markers reached ${count(pipeline.cutoff_marker_count, pipeline.cutoff_markers_required)}.`);
  }
  if (!pipeline.cut_ready) {
   return missing('PROTECTED_PIPELINE.CUTOFF_READY', 'PROTECTED_PIPELINE.CUT_READY', 'The saved CutProof was unready.');
  }
  if (!pipeline.order_ready) {
   return missing('PROTECTED_PIPELINE.CUT_READY', 'PROTECTED_PIPELINE.ORDER_READY', 'The saved protected ordering was unready.');
  }
 }
 if (pipeline.parent_commitment == null) {
  return missing('PROTECTED_PIPELINE.ORDER_READY', 'PROTECTED_PIPELINE.COMMITTED_IN_PARENT',
   'The saved observation lacks the required protected-batch commitment in the parent.');
 }
 if (!posy.proposal_seen) {
  return missing('POSY.HEIGHT_READY', 'POSY.PROPOSAL', 'The saved observation reports no proposal from the expected proposer.');
 }
 if (below(posy.validation_votes, posy.validation_votes_required) || posy.vc_status !== 'FORMED') {
  return missing('POSY.PROPOSAL', 'POSY.VC',
   `Validation votes reached ${count(posy.validation_votes, posy.validation_votes_required)}. Saved VC status is ${posy.vc_status}.`);
 }
 if (normal) {
  if (!pipeline.reveal_authorized) {
   return missing('PROTECTED_PIPELINE.COMMITTED_IN_PARENT', 'PROTECTED_PIPELINE.REVEAL_AUTHORIZED',
    'The saved PoSy VC did not authorize reveal of the committed protected batch.');
  }
  if (below(pipeline.reveal_share_count, pipeline.reveal_shares_required) || !pipeline.execution_ready) {
   return missing('PROTECTED_PIPELINE.REVEAL_AUTHORIZED', 'PROTECTED_PIPELINE.EXECUTION_READY',
    `Reveal shares reached ${count(pipeline.reveal_share_count, pipeline.reveal_shares_required)}. Saved execution readiness is ${pipeline.execution_ready ? 'ready' : 'unready'}.`);
  }
 } else if (!pipeline.execution_ready) {
  return missing('PROTECTED_PIPELINE.GENESIS_BOOTSTRAP', 'PROTECTED_PIPELINE.EXECUTION_READY',
   'The saved Genesis-bound empty protected batch was unready for execution.');
 }
 if (below(posy.finality_votes, posy.finality_votes_required) || posy.qc_status !== 'FORMED') {
  return missing('POSY.VC', 'POSY.QC',
   `Finality votes reached ${count(posy.finality_votes, posy.finality_votes_required)}. Saved QC status is ${posy.qc_status}.`);
 }
 if (below(posy.finalized_height, posy.current_height)) {
  return missing('POSY.QC', 'POSY.FINALIZED',
   `The saved PoSy height is ${numberSource(posy.current_height)} and the finalized height is ${numberSource(posy.finalized_height)}.`);
 }
 return null;
}

const displayable = value => nonempty(value) && value.length <= 256 && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value);
const displayText = value => displayable(value) ? value : 'Unavailable';

function parseObservationContract(raw) {
 if (typeof raw !== 'string' || raw.length > validatorObservationLimit || new TextEncoder().encode(raw).length > validatorObservationLimit) {
  throw Error('The Validator Operations observation must be a JSON file of at most 1 MiB.');
 }
 let value;
 try {value = parseExactNumbers(raw);} catch {throw Error(unsupported);}
 if (!observation(value) || (Object.hasOwn(value, 'preflight') && value.preflight === null) || !consistent(value)) throw Error(unsupported);
 return value;
}

export function parseValidatorObservation(raw) {
 const value = parseObservationContract(raw);
 const {discovery, chain, service, peers, posy, release: reportedRelease, expected_release: expected, protected_pipeline: pipeline} = value;
 const mismatches = expected == null ? null : Object.keys(releaseFields).filter(key => expected[key] !== reportedRelease[key]);
 return {
  observedAt: displayText(value.observed_at_utc),
  validator: displayText(discovery.validator_id),
  network: displayText(discovery.network),
  chainId: displayText(discovery.chain_id),
  incarnation: displayText(discovery.incarnation),
  releaseId: displayText(reportedRelease.release_id),
  releaseTag: displayText(reportedRelease.release_tag),
  binarySha256: reportedRelease.binary_sha256,
  releaseMismatches: mismatches,
  serviceState: service.state,
  authenticatedPeers: numberSource(peers.authenticated_validator_peer_count),
  expectedPeers: numberSource(peers.expected_validator_peer_count),
  headHeight: numberSource(chain.head_height),
  finalizedHeight: numberSource(chain.finalized_height),
  syncTargetHeight: numberSource(chain.sync_target_height),
  finalityProgress: chain.finality_progress,
  posyView: numberSource(posy.current_view),
  vcStatus: posy.vc_status,
  qcStatus: posy.qc_status,
  protectedSource: pipeline.source,
  protectedPhase: pipeline.phase,
  missingTransition: firstMissingTransition(value),
  savedPreflight: projectSavedHostPreflight(value.preflight),
 };
}

async function readObservationText(file) {
 if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > validatorObservationLimit) {
  throw Error('Choose a Validator Operations JSON file of at most 1 MiB.');
 }
 let bytes;
 try {bytes = await file.arrayBuffer();} catch {throw Error('The selected observation file could not be read.');}
 if (bytes.byteLength > validatorObservationLimit || bytes.byteLength !== file.size) throw Error('The selected observation file could not be read.');
 try {return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);} catch {throw Error(unsupported);}
}

export async function readValidatorObservationFile(file) {
 return parseValidatorObservation(await readObservationText(file));
}

export async function readSavedServiceObservation(file) {
 const value = parseObservationContract(await readObservationText(file));
 return {
  validator: displayText(value.discovery.validator_id),
  observedAt: displayText(value.observed_at_utc),
  serviceState: value.service.state,
 };
}

export function captureTime(value) {
 const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(value);
 if (!match) throw Error('The observation requires a supported UTC capture time for comparison.');
 const [, second, fraction = ''] = match;
 const startMs = Date.parse(`${second}Z`);
 if (!Number.isFinite(startMs) || new Date(startMs).toISOString() !== `${second}.000Z`) {
  throw Error('The observation requires a supported UTC capture time for comparison.');
 }
 return BigInt(startMs) * 1_000_000n + BigInt(fraction.padEnd(9, '0'));
}

export async function readMaintenanceObservationFile(file) {
 const value = parseObservationContract(await readObservationText(file));
 const {discovery, release, service, chain} = value;
 const identity = [discovery.validator_id, discovery.chain_id, discovery.network, discovery.incarnation, release.genesis_hash,
  discovery.validator_public_key_fingerprint, discovery.consensus_public_key_fingerprint, discovery.ingress_public_key_fingerprint,
  discovery.key_binding_status];
 if ([...identity, ...Object.values(release)].some(field => !displayable(field))) {
  throw Error('The observation lacks usable validator identity or release fields for comparison.');
 }
 return {
  identity,
  capturedAt: captureTime(value.observed_at_utc),
  release,
  status: {
   observedAt: value.observed_at_utc,
   validator: discovery.validator_id,
   releaseId: release.release_id,
   releaseTag: release.release_tag,
   binarySha256: release.binary_sha256,
   serviceState: service.state,
   headHeight: numberSource(chain.head_height),
   finalizedHeight: numberSource(chain.finalized_height),
  },
 };
}

export function compareMaintenanceObservations(before, after) {
 if (before.identity.some((value, index) => value !== after.identity[index])) {
  throw Error('The reports describe different validator, chain or public key binding contexts.');
 }
 if (before.capturedAt >= after.capturedAt) {
  throw Error('Choose an earlier capture for Before and a later capture for After.');
 }
 const changes = Object.keys(releaseFields)
  .filter(key => before.release[key] !== after.release[key])
  .map(key => ({id:key, field:key.replaceAll('_', ' '), before:before.release[key], after:after.release[key]}));
 return {before:before.status, after:after.status, changes};
}
