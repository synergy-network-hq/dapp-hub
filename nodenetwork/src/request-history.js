import {nodeNetworkTarget} from './nodeNetwork.js';

export const requestOperations = Object.freeze([
 'bootstrap', 'install', 'identity_generate', 'formation_prepare', 'genesis_stage', 'genesis_bind', 'commission', 'register', 'vpn_enroll', 'start', 'stop', 'restart', 'upgrade', 'uninstall',
]);

export const requestStatusOptions = [
 {id: 'all', label: 'All requests'},
 {id: 'unresolved', label: 'Unknown or uncertain outcomes'},
 {id: 'responses', label: 'Responses received'},
 {id: 'reported-ok', label: 'Controller reported ok'},
 {id: 'refused', label: 'Controller reported refusal'},
];

function requestOutcome(record) {
 if (record.state !== 'response_received') return 'unresolved';
 return record.response_ok ? 'reported-ok' : 'refused';
}

export function requestStatusLabel(record) {
 if (record.state === 'dispatch_intent') return 'Outcome unknown · dispatch recorded';
 if (record.state === 'uncertain') return 'Outcome uncertain';
 return requestOutcome(record) === 'reported-ok' ? 'Controller reported ok' : 'Controller reported refusal';
}

export function filterRequests(records, {status, operation, target}) {
 return records.filter(record =>
  (status === 'all' || requestOutcome(record) === status
   || (status === 'responses' && record.state === 'response_received'))
  && (operation === 'all' || record.operation === operation)
  && (!target || record.target_digest === target),
 );
}

function matchesUnresolvedDispatch(record, fingerprint) {
 return Boolean(record && fingerprint && record.target_digest === fingerprint && ['dispatch_intent', 'uncertain'].includes(record.state));
}

export function matchesUnresolvedServiceDispatch(record, fingerprint) {
 return matchesUnresolvedDispatch(record, fingerprint) && ['register', 'start', 'restart', 'stop'].includes(record.operation);
}

export const custodyReceiptOperations = Object.freeze(['genesis_stage', 'genesis_bind', 'formation_prepare', 'identity_generate']);

export function matchesUnresolvedCustodyReceipt(record, fingerprint) {
 return matchesUnresolvedDispatch(record, fingerprint) && custodyReceiptOperations.includes(record.operation);
}

export function matchesUnresolvedSoftwareReceipt(record, fingerprint) {
 return matchesUnresolvedDispatch(record, fingerprint) && ['install','upgrade'].includes(record.operation);
}

export function retainsUnresolvedDispatch(records, reviewed, fingerprint) {
 const record = records.find(entry => entry.id === reviewed.id);
 return matchesUnresolvedDispatch(reviewed, fingerprint) && matchesUnresolvedDispatch(record, fingerprint)
  && ['operation', 'request_digest', 'state', 'recorded_at_ms', 'observed_at_ms'].every(field => record[field] === reviewed[field]);
}

const pin = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const validState = record => {
 if (record.state === 'dispatch_intent') return record.observed_at_ms === null && record.response_ok === null;
 if (!timestamp(record.observed_at_ms)) return false;
 if (record.state === 'uncertain') return record.response_ok === null;
 return record.state === 'response_received' && typeof record.response_ok === 'boolean';
};
const historyLimit = 256;

export async function configuredTargetFingerprint(target) {
 if (target?.root !== '/opt/Synergy' || (target.kind === 'local' && (target.host != null || target.port != null))) {
  throw Error('A supported configured target is required to filter local history.');
 }
 const selected = nodeNetworkTarget(target);
 if (!globalThis.crypto?.subtle) throw Error('This window cannot match the configured target to the local journal.');
 // Keep field order aligned with native Target::journal_identity and the v1 journal digest.
 const canonical = JSON.stringify({
  host:selected.host ?? null, kind:selected.kind,
  port:selected.kind === 'remote' ? selected.port ?? 22 : null, root:selected.root,
 });
 const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseRequestHistory(value) {
 if (
  value?.schema !== 'nodenetwork-local-requests-v1' || value.limit !== historyLimit
  || value.remoteJobRecovery !== false || value.automaticReplay !== false
  || !Array.isArray(value.records) || value.records.length > value.limit
  || value.records.some(record =>
   !record || record.version !== 1 || !pin(record.id) || !pin(record.target_digest)
   || !pin(record.request_digest) || !requestOperations.includes(record.operation)
   || !timestamp(record.recorded_at_ms) || !validState(record),
  )
  || new Set(value.records.map(record => record.id)).size !== value.records.length
 ) throw Error('Local request history returned an unsupported record. History is unavailable; no empty or completed state is inferred.');
 return value;
}

export function reviewRequestSelection(value, ids, reviewedAt = Date.now()) {
 const {records} = parseRequestHistory(value);
 if (!Array.isArray(ids) || !ids.length || ids.length > historyLimit || ids.some(id => !pin(id))
  || new Set(ids).size !== ids.length || !timestamp(reviewedAt)) {
  throw Error('Select supported local journal records before reviewing an export.');
 }
 const wanted = new Set(ids);
 const selected = records.filter(record => wanted.has(record.id));
 if (selected.length !== ids.length) throw Error('The selected records changed. Refresh local history and select them again.');
 return {
  schema: 'nodenetwork-local-request-summary-v1',
  reviewedAt: new Date(reviewedAt).toISOString(),
  records: selected.map(record => ({
   localRequestId: record.id,
   operation: record.operation,
   state: record.state,
   controllerReportedOk: record.response_ok,
   dispatchRecordedAt: new Date(record.recorded_at_ms).toISOString(),
   outcomeRecordedAt: record.observed_at_ms === null ? null : new Date(record.observed_at_ms).toISOString(),
  })),
 };
}
