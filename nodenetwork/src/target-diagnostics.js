export const diagnosticSeverity = Object.freeze({
 error: 'Error', warn: 'Warning', info: 'Info', debug: 'Debug', trace: 'Trace', unclassified: 'Unclassified',
});
const serviceStates = Object.freeze({
 active: 'Active', inactive: 'Inactive', failed: 'Failed', activating: 'Activating',
 deactivating: 'Deactivating', reloading: 'Reloading', maintenance: 'Maintenance', refreshing: 'Refreshing',
});
const unsupported = 'The selected controller returned unsupported target diagnostics.';
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0;
const optionalCount = value => value === null || count(value);

function service(value) {
 if (value === null) return null;
 if (!fields(value, ['state', 'restarts', 'memory_bytes', 'cpu_usage_ns'])
  || !(value.state === null || (typeof value.state === 'string' && Object.hasOwn(serviceStates, value.state)))
  || ![value.restarts, value.memory_bytes, value.cpu_usage_ns].every(optionalCount)) throw Error(unsupported);
 return {...value, state: value.state === null ? 'Not reported' : serviceStates[value.state]};
}

export function targetDiagnosticsObservation(value) {
 if (!fields(value, ['schema', 'observed_at_ms', 'services', 'storage', 'log'])
  || value.schema !== 'nodenetwork-diagnostics-v1' || !count(value.observed_at_ms) || value.observed_at_ms > 8_640_000_000_000_000
  || !fields(value.services, ['node', 'vpn']) || !fields(value.storage, ['capacity_bytes', 'available_bytes'])) {
  throw Error(unsupported);
 }
 const {storage, log} = value;
 if (![storage.capacity_bytes, storage.available_bytes].every(optionalCount)
  || (storage.capacity_bytes !== null && storage.available_bytes !== null && storage.available_bytes > storage.capacity_bytes)
  || !fields(log, ['available', 'size_bytes', 'window_bytes', 'complete_lines', 'severity'])
  || !fields(log.severity, Object.keys(diagnosticSeverity)) || typeof log.available !== 'boolean'
  || !optionalCount(log.size_bytes) || !count(log.window_bytes) || log.window_bytes > 65_536
  || !count(log.complete_lines) || log.complete_lines > log.window_bytes
  || (log.size_bytes !== null && log.window_bytes > log.size_bytes)
  || (!log.available && (log.size_bytes !== null || log.window_bytes !== 0))) throw Error(unsupported);
 const counts = Object.values(log.severity);
 if (counts.some(number => !count(number) || number > log.complete_lines)
  || counts.reduce((sum, number) => sum + number, 0) !== log.complete_lines) throw Error(unsupported);
 return {
  observedAt: value.observed_at_ms,
  services: {node: service(value.services.node), vpn: service(value.services.vpn)},
  storage: {...storage},
  log: {...log, severity: {...log.severity}},
 };
}

export function serviceRegistrationAttribution({services}) {
 const {node, vpn} = services;
 const summary = node && vpn ? 'The controller attributed both Node and VPN services.'
  : node || vpn ? 'The controller returned partial service attribution. The observation is inconclusive.'
   : 'The controller reported no attributed Node or VPN service.';
 return {summary, node: node?.state ?? 'No attribution reported', vpn: vpn?.state ?? 'No attribution reported'};
}

export function nodeServiceState({services}) {
 const node = services.node;
 if (!node) return {label: 'No attribution reported', summary: 'The controller reported no attributed Node service.'};
 if (node.state === 'Not reported') return {label: node.state, summary: 'The controller attributed the Node service without reporting its state.'};
 return {label: node.state, summary: 'The controller reported the current state of the attributed Node service.'};
}
