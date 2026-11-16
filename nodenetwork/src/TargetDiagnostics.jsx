import {useState} from 'react';
import {Detail, Resource, Table, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {NodeNetworkPanelCard} from './NodeNetworkPanelFrame.jsx';
import {nodeNetworkController, nodeNetworkRequests} from './native-services.js';
import {installedControllerRead, targetControllerObservation} from './target-observation.js';
import {diagnosticSeverity, serviceRegistrationAttribution, targetDiagnosticsObservation} from './target-diagnostics.js';
import {retainsRegistrationDispatch} from './request-history.js';

const serviceColumns = [
 {key: 'label', label: 'Service'}, {key: 'state', label: 'Reported state'}, {key: 'restarts', label: 'Restarts'},
 {key: 'memory', label: 'Memory (bytes)'}, {key: 'cpu', label: 'CPU usage (ns)'},
];
const severityColumns = [{key: 'label', label: 'Severity'}, {key: 'count', label: 'Complete lines'}];
const counter = value => value ?? 'Not reported';

function Snapshot({value}) {
 const {observedAt, receivedAt, services, storage, log} = value;
 const serviceRows = [['node', 'Synergy node'], ['vpn', 'Validator VPN']].map(([id, label]) => ({
  id, label, state: services[id]?.state ?? 'No attributed service returned',
  restarts: counter(services[id]?.restarts), memory: counter(services[id]?.memory_bytes), cpu: counter(services[id]?.cpu_usage_ns),
 }));
 return <>
  <p role="status">Selected target controller · Local receipt {new Date(receivedAt).toISOString()}</p>
  <p>Target-reported observation time {new Date(observedAt).toISOString()}</p>
  <h3>Managed services</h3>
  <Table columns={serviceColumns} rows={serviceRows}/>
  <h3>Installation storage</h3>
  <Detail data={{capacityBytes: counter(storage.capacity_bytes), availableBytes: counter(storage.available_bytes)}}/>
  <h3>Node log window</h3>
  {log.available ? <>
   <p>Counts use complete lines in the latest bounded read of up to 65,536 bytes.</p>
   <Detail data={{fileSizeBytes: counter(log.size_bytes), sampledBytes: log.window_bytes, completeLines: log.complete_lines}}/>
   <Table columns={severityColumns} rows={Object.entries(diagnosticSeverity).map(([id, label]) => ({id, label, count: log.severity[id]}))}/>
  </> : <p>The controller reported no available node log window.</p>}
 </>;
}

async function readTargetDiagnostics(target, signal, targetScopeCurrent, reviewJournal) {
 const requireCurrent = () => {
  signal.throwIfAborted();
  if (!targetScopeCurrent()) throw Error('The target, recovery state or permission changed. Review the configured target again.');
 };
 const recheck = async () => {
  requireCurrent();
  if (reviewJournal) await reviewJournal();
 };
 const read = async (operation, observe, errorMessage) => {
  await recheck();
  requireCurrent();
  try {
   return observe(await nodeNetworkController(target, operation));
  } catch {
   throw Error(errorMessage);
  }
 };
 const controller = await read('target', targetControllerObservation, 'The selected controller could not confirm diagnostics support.');
 requireCurrent();
 if (!installedControllerRead(controller, 'diagnostics').available) {
  throw Error('Target diagnostics require an installed version-one controller with an available diagnostics read.');
 }
 const snapshot = await read('diagnostics', targetDiagnosticsObservation, 'The selected controller could not provide supported target diagnostics.');
 const receivedAt = Date.now();
 await recheck();
 requireCurrent();
 return {...snapshot, receivedAt};
}

export function TargetDiagnostics({target, permitted, targetScopeCurrent = () => permitted}) {
 const [requested, setRequested] = useState(false);
 const report = useResource(signal => requested && target && permitted
  ? readTargetDiagnostics(target, signal, targetScopeCurrent) : null, requested);

 return <NodeNetworkPanelCard title="Target diagnostics" action={target && <button
  disabled={!permitted || (requested && report.loading)}
  onClick={() => requested ? report.reload() : setRequested(true)}>Read target diagnostics</button>}>
  <p>Review attributed service state, installation storage and a count-only node log window.</p>
  {!target && <p>Host selection is deferred. Review target settings to configure an enrolled controller.</p>}
  {target && !permitted && <p>Allow NodeNetwork inspection in Security &amp; permissions to read target diagnostics.</p>}
  {target && permitted && requested && <Resource value={{...report, reload: null}}>{value => <Snapshot value={value}/>}</Resource>}
 </NodeNetworkPanelCard>;
}

export function RegistrationDiagnosticsReview({target, record, targetScopeCurrent}) {
 const [requested, setRequested] = useState(false);
 const report = useResource(signal => requested ? readTargetDiagnostics(target, signal, targetScopeCurrent, async () => {
  const journal = await nodeNetworkRequests().catch(() => {throw Error('The local registration dispatch could not be rechecked. Refresh local history.');});
  if (!retainsRegistrationDispatch(journal.records, record)) {
   throw Error('The selected registration dispatch changed. Refresh local history and select it again.');
  }
 }) : null, requested);
 return <section aria-label="Current service attribution">
  <p>Read current Node and VPN attribution from the selected controller. This observation leaves the prior dispatch unresolved.</p>
  <div className="native-actions">
   <button disabled={requested && report.loading} onClick={() => requested ? report.reload() : setRequested(true)}>Read current service attribution</button>
   {requested && <button onClick={() => setRequested(false)}>Dismiss service evidence</button>}
  </div>
  {requested && <Resource value={{...report, reload: null}}>{value => {
   const attribution = serviceRegistrationAttribution(value);
   return <>
    <p role="status">{attribution.summary}</p>
    <p>Target observation {new Date(value.observedAt).toISOString()} · Local receipt {new Date(value.receivedAt).toISOString()}</p>
    <Detail data={{nodeService: attribution.node, vpnService: attribution.vpn}}/>
    <p>Reconcile the prior request with the node operator. Canary relay registration and other installation effects require separate evidence.</p>
   </>;
  }}</Resource>}
 </section>;
}
