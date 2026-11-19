const lifecycle = ['registered', 'starting', 'running', 'restarting', 'stopping', 'stopped', 'failed'];
const health = ['healthy', 'degraded', 'unhealthy'];
const readiness = ['ready', 'pending', 'blocked'];
const fieldCount = (value, count) => value && typeof value === 'object'
 && !Array.isArray(value) && Object.keys(value).length === count;

export const nodeServiceActions = Object.freeze(['start','stop','restart']);

export function nodeServiceActionObservation(operation,value) {
 if (!nodeServiceActions.includes(operation) || !fieldCount(value,2) || value.requested !== operation || value.healthNotInferred !== true) {
  throw Error('Node service action outcome is uncertain. Inspect the selected controller before another change.');
 }
 return {requested:operation,healthNotInferred:true};
}

export function nodeServiceRegistrationObservation(value) {
 const registered=value?.registered;
 const expected=['/etc/systemd/system/synergy-node.service','/etc/systemd/system/synergy-vpn.service'];
 if (!fieldCount(value,3) || value.services_started !== false || value.boot_enabled !== false
  || !Array.isArray(registered) || ![2,3].includes(registered.length)
  || registered[0]!==expected[0] || registered[1]!==expected[1]
  || (registered.length===3&&registered[2]!=='/etc/systemd/system/synergy-canary-rpc-relay.service')) {
  throw Error('Service registration outcome is uncertain. Inspect the selected target before another change.');
 }
 return {services:registered.length===3?['node','vpn','canary-rpc-relay']:['node','vpn']};
}

// The native health projection contains service observations only. Never interpret
// service count/readiness or additional caller fields as a validator denominator.
export function targetHealthObservation(value) {
 const unsupported = 'The selected controller returned unsupported service health evidence.';
 if (!fieldCount(value, 2) || value.schema_version !== 1
  || !Array.isArray(value.services) || value.services.length > 128) {
  throw Error(unsupported);
 }
 const seen = new Set();
 return value.services.map(service => {
  if (!fieldCount(service, 4)) throw Error(unsupported);
  const {id, state, health: reportedHealth, readiness: reportedReadiness} = service;
  if (typeof id !== 'string' || !id.length || id.length > 64 || /[^a-z0-9-]/.test(id) || seen.has(id)
   || !lifecycle.includes(state) || !health.includes(reportedHealth) || !readiness.includes(reportedReadiness)) {
   throw Error(unsupported);
  }
  seen.add(id);
  return {id, state, health: reportedHealth, readiness: reportedReadiness};
 });
}
