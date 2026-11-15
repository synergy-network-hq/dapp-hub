// Node Control Panel 608f2529: control-service/src/validator_operations.rs.
export const validatorObservationLimit = 1024 * 1024;
const schemaVersion = 'synergy.validator-operations.v1';
const unsupported = 'The file is not a supported Validator Operations v1 observation.';
const integerMarker = '\u0000';
const uint64Max = 18446744073709551615n;
const uint32Max = 4294967295n;

// Validate JSON syntax first. Preserve numeric tokens for Rust u64 fields without
// rounding through Number. Reject ambiguous duplicate keys, including escapes.
function parseExactNumbers(raw) {
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

// Mirror the owner's structural consistency checks. Live liveness and health
// evaluation require the owner runtime and are outside the saved-file reader.
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

const displayText = value => nonempty(value) && value.length <= 256 && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value) ? value : 'Unavailable';

export function parseValidatorObservation(raw) {
 if (typeof raw !== 'string' || raw.length > validatorObservationLimit || new TextEncoder().encode(raw).length > validatorObservationLimit) {
  throw Error('The Validator Operations observation must be a JSON file of at most 1 MiB.');
 }
 let value;
 try {value = parseExactNumbers(raw);} catch {throw Error(unsupported);}
 if (!observation(value) || (Object.hasOwn(value, 'preflight') && value.preflight === null) || !consistent(value)) throw Error(unsupported);
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
 };
}

export async function readValidatorObservationFile(file) {
 if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > validatorObservationLimit) {
  throw Error('Choose a Validator Operations JSON file of at most 1 MiB.');
 }
 let bytes;
 try {bytes = await file.arrayBuffer();} catch {throw Error('The selected observation file could not be read.');}
 if (bytes.byteLength > validatorObservationLimit || bytes.byteLength !== file.size) throw Error('The selected observation file could not be read.');
 let raw;
 try {raw = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);} catch {throw Error(unsupported);}
 return parseValidatorObservation(raw);
}
