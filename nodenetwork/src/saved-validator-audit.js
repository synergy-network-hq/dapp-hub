import {captureTime,parseExactNumbers} from './validator-operations-observation.js';

// Node Control Panel 608f2529: control-service/src/testnet_agent_service.rs.
const prefix = 'validator.operations.';
const denied = ['denied:NetworkDenied','denied:AuthenticationRequired','denied:OperatorIdentityRequired','denied:ScopeRequired'];
const read = ['success','unavailable',...denied];
const lifecycle = ['authorized:execution_pending','success','failed'];
const actions = {
 status:['Read validator status',read],cluster_status:['Read cluster status',read],
 diagnose_liveness:['Diagnose liveness',read],preflight:['Read host preflight',read],logs:['Collect structured logs',read],
 lifecycle:['Lifecycle access',denied],'lifecycle.start':['Start validator',lifecycle],
 'lifecycle.stop':['Stop validator',lifecycle],'lifecycle.restart':['Restart validator',lifecycle],
 'snapshot.capture':['Capture diagnostic snapshot',['authorized:capture_pending','success','failed',...denied]],
};
export const auditActions = Object.fromEntries(Object.entries(actions).map(([key,[label]])=>[key,label]));
export const auditOutcomes = {
 success:'Reported success',unavailable:'Reported unavailable',failed:'Reported failure',
 'authorized:execution_pending':'Authorized before execution','authorized:capture_pending':'Authorized before capture',
 'denied:NetworkDenied':'Denied · network','denied:AuthenticationRequired':'Denied · authentication',
 'denied:OperatorIdentityRequired':'Denied · operator identity','denied:ScopeRequired':'Denied · scope',
};
export const auditFileLimit = 4 * 1024 * 1024;
export const auditExportLimit = 50;
const rowLimit = 2048;
const lineLimit = 4096;
const day = 86_400_000_000_000n;
const encoder = new TextEncoder();
const unsupported = 'The file contains an unsupported validator management audit record.';
const nonempty = value => typeof value === 'string' && Boolean(value.trim()) && !value.startsWith('\u0000');

function auditRow(raw,index) {
 if (!raw || raw.length > lineLimit || encoder.encode(raw).length > lineLimit) throw Error(unsupported);
 const record = parseExactNumbers(raw);
 const {recorded_at_utc:time,operator_id:operator,remote_address:address,action,outcome,validator_id:validator} = record ?? {};
 const component = typeof action === 'string' && action.startsWith(prefix) ? action.slice(prefix.length) : '';
 const fields = ['recorded_at_utc','operator_id','remote_address','action','outcome'];
 if (component !== 'cluster_status') fields.push('validator_id');
 if (!record || !Object.hasOwn(actions,component) || !actions[component][1].includes(outcome)
  || Object.keys(record).length !== fields.length || !fields.every(key=>Object.hasOwn(record,key))
  || !nonempty(operator) || !nonempty(address) || (component !== 'cluster_status' && !nonempty(validator))) throw Error(unsupported);
 const nanoseconds = captureTime(time);
 return {id:index+1,time,action:component,outcome,nanoseconds};
}

export function parseSavedValidatorAudit(raw) {
 if (typeof raw !== 'string' || raw.length > auditFileLimit || encoder.encode(raw).length > auditFileLimit
  || (raw !== '' && !raw.endsWith('\n'))) throw Error('Choose a complete validator management audit JSONL file of at most 4 MiB.');
 if (!raw) return [];
 const lines = raw.slice(0,-1).split('\n',rowLimit+1);
 if (lines.length > rowLimit) throw Error(`Choose an audit file with at most ${rowLimit.toLocaleString('en-US')} records.`);
 try {
  return lines.map(auditRow).sort((a,b)=>a.nanoseconds === b.nanoseconds ? a.id-b.id : a.nanoseconds > b.nanoseconds ? -1 : 1);
 } catch {throw Error(unsupported);}
}

export async function readSavedValidatorAudit(file,current = () => true) {
 if (!Number.isSafeInteger(file?.size) || file.size < 0 || file.size > auditFileLimit) {
  throw Error('Choose a validator management audit JSONL file of at most 4 MiB.');
 }
 if (!current()) return null;
 let raw;
 try {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw Error();
  raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 } catch {throw Error('The selected audit file could not be read in full as UTF-8.');}
 return current() ? parseSavedValidatorAudit(raw) : null;
}

export function filterSavedValidatorAudit(rows,{action,outcome,from,through}) {
 const earliest = from ? captureTime(`${from}T00:00:00Z`) : null;
 const end = through ? captureTime(`${through}T00:00:00Z`) : null;
 if (earliest !== null && end !== null && earliest > end) throw Error('The first UTC day must be on or before the last UTC day.');
 const after = end === null ? null : end+day;
 return rows.filter(row => (!action || row.action === action) && (!outcome || row.outcome === outcome)
  && (earliest === null || row.nanoseconds >= earliest) && (after === null || row.nanoseconds < after));
}

export function reviewSavedValidatorAudit(rows,selected) {
 const records = rows.filter(row=>selected.has(row.id));
 if (!records.length || records.length > auditExportLimit || records.length !== selected.size) throw Error('Choose saved audit rows from the current filter.');
 return {schema:'nodenetwork-saved-validator-management-audit-v1',entries:records.map(({id,time,action,outcome})=>({
  savedLine:id,recordedAtUtc:time,action:prefix+action,outcome,
 }))};
}
