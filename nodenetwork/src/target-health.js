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

export function serviceActionLabel(operation,state) {
 const verb={start:'Start',stop:'Stop',restart:'Restart'}[operation];
 if(!verb)return null;
 return `${verb} ${state?.installed_role==='rpc_gateway'?'gateway relay':state?.installed_role==='validator'?'validator':'selected service'}`;
}

export function gatewayHealthObservation(v){
 const keys=['schema','observed_at_ms','role','relay','vpn','admission_custody_verified','consensus_participant','configured_loopback','production_qualified'];
 const exact=(v,k)=>fieldCount(v,k.length)&&k.every(key=>Object.hasOwn(v,key));
 const u53=n=>Number.isSafeInteger(n)&&n>=0;
 const error=()=>{throw Error('Unsupported gateway relay observations. Reachability and consensus were not inferred.');};
 if(!exact(v,keys)||v.schema!=='nodenetwork-gateway-health-v1'||v.role!=='rpc_gateway'||!u53(v.observed_at_ms)||v.observed_at_ms===0||v.admission_custody_verified!==true||v.consensus_participant!==false||v.configured_loopback!==true||v.production_qualified!==false)error();
 if(!exact(v.relay,['unit','state','pid'])||v.relay.unit!=='synergy-canary-rpc-relay.service'||!['unregistered','active','inactive','failed','activating','deactivating','reloading','maintenance','refreshing'].includes(v.relay.state)||(v.relay.state==='unregistered'?v.relay.pid!==null:!u53(v.relay.pid)))error();
 if(!exact(v.vpn,['registered','enrollment_recorded','server_bound','connected'])||!Object.values(v.vpn).every(x=>typeof x==='boolean')||(v.vpn.connected&&(!v.vpn.registered||!v.vpn.enrollment_recorded)))error();
 return {...v,relay:{...v.relay},vpn:{...v.vpn}};
}

export function nodeServiceRegistrationObservation(value) {
 if(fieldCount(value,4)&&value.schema==='nodenetwork-service-registration-v1'&&value.services_started===false&&value.boot_enabled===false&&Array.isArray(value.services)&&[['node','vpn'],['node','vpn','canary-rpc-relay']].some(ids=>JSON.stringify(ids)===JSON.stringify(value.services)))return {services:[...value.services]};
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
 if(value?.schema==='nodenetwork-gateway-health-v1')return gatewayHealthObservation(value);
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
