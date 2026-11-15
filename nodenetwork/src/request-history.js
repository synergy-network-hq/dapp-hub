export const requestOperations = Object.freeze([
 'bootstrap', 'install', 'commission', 'register', 'start', 'stop', 'restart', 'upgrade', 'uninstall',
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

const pin = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const validState = record => {
 if (record.state === 'dispatch_intent') return record.observed_at_ms === null && record.response_ok === null;
 if (!timestamp(record.observed_at_ms)) return false;
 if (record.state === 'uncertain') return record.response_ok === null;
 return record.state === 'response_received' && typeof record.response_ok === 'boolean';
};

export function parseRequestHistory(value) {
 if (
  value?.schema !== 'nodenetwork-local-requests-v1' || value.limit !== 256
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
