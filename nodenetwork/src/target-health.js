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
