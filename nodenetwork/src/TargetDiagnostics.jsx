import {useState} from 'react';
import {Detail, Resource, Table, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {NodeNetworkPanelCard} from './NodeNetworkPanelFrame.jsx';
import {nodeNetworkController} from './native-services.js';
import {installedControllerRead, targetControllerObservation} from './target-observation.js';
import {diagnosticSeverity, targetDiagnosticsObservation} from './target-diagnostics.js';

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

export function TargetDiagnostics({target, permitted}) {
 const [requested, setRequested] = useState(false);
 const report = useResource(async signal => {
  if (!requested || !target || !permitted) return null;
  let controller;
  try {
   controller = targetControllerObservation(await nodeNetworkController(target, 'target'));
  } catch {
   throw Error('The selected controller could not confirm diagnostics support.');
  }
  signal.throwIfAborted();
  if (!installedControllerRead(controller, 'diagnostics').available) {
   throw Error('Target diagnostics require an installed version-one controller with an available diagnostics read.');
  }
  const snapshot = targetDiagnosticsObservation(await nodeNetworkController(target, 'diagnostics'));
  return {...snapshot, receivedAt: Date.now()};
 }, requested);

 return <NodeNetworkPanelCard title="Target diagnostics" action={target && <button
  disabled={!permitted || (requested && report.loading)}
  onClick={() => requested ? report.reload() : setRequested(true)}>Read target diagnostics</button>}>
  <p>Review attributed service state, installation storage and a count-only node log window.</p>
  {!target && <p>Host selection is deferred. Review target settings to configure an enrolled controller.</p>}
  {target && !permitted && <p>Allow NodeNetwork inspection in Security &amp; permissions to read target diagnostics.</p>}
  {target && permitted && requested && <Resource value={{...report, reload: null}}>{value => <Snapshot value={value}/>}</Resource>}
 </NodeNetworkPanelCard>;
}
