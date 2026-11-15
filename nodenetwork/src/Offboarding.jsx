import {useState} from 'react';
import {Card, Detail, ErrorMessage, ModalDialog, Table, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests} from './native-services.js';
import {controllerOperation} from './nodeNetwork.js';
import {removalRoot, removalScope, sameRemovalScope, uninstallParameters} from './offboarding.js';
import {filterRequests} from './request-history.js';
import {useObservationFile} from './useObservationFile.js';
import {readSavedServiceObservation} from './validator-operations-observation.js';

const dependencies = [
 {id: 'jobs', check: 'Pending jobs', next: 'Review the local dispatch journal and reconcile unresolved operations with the node operator.'},
 {id: 'chain', check: 'Chain exit and unbonding', next: 'Verify exit, stake and unsettled obligations with the chain operator. Keep tracking them until finalized.'},
 {id: 'service', check: 'Service shutdown', next: 'Confirm the managed validator is stopped through the qualified controller before retiring its signer.'},
 {id: 'vpn', check: 'VPN peer removal', next: 'Confirm the peer and its access are removed through the approved VPN control plane.'},
 {id: 'signer', check: 'Signer retirement', next: 'Verify signer retirement and the approved recovery procedure with the custody operator.'},
 {id: 'retention', check: 'Retention', next: 'Preserve required chain data, custody, and signing-safety material through an approved backup procedure before removal.'},
];
const columns = [
 {key: 'check', label: 'Dependency'},
 {key: 'evidence', label: 'Available evidence', render: row => row.id === 'jobs' || row.id === 'service'
  ? <span aria-live="polite">{row.evidence}</span> : row.evidence},
 {key: 'next', label: 'Evidence to verify'},
];

export function OffboardingChecklist({permitted, onOpenHistory}) {
 return <OffboardingEvidence key={String(permitted)} permitted={permitted} onOpenHistory={onOpenHistory}/>;
}

function OffboardingEvidence({permitted, onOpenHistory}) {
 const [requested, setRequested] = useState(false);
 const service = useObservationFile(readSavedServiceObservation);
 const journal = useResource(async () => {
  if (!permitted || !requested) return null;
  const value = await nodeNetworkRequests();
  const unresolved = filterRequests(value.records, {status: 'unresolved', operation: 'all', target: null}).length;
  return {unresolved, receivedAt: new Date().toISOString()};
 }, String(requested));

 let jobs = 'Local history review pending.';
 if (!permitted) jobs = 'Inspection permission required.';
 else if (requested && journal.loading) jobs = 'Reading this device’s local journal…';
 else if (journal.error) jobs = 'Local journal unavailable.';
 else if (journal.data) {
  const {unresolved, receivedAt} = journal.data;
  jobs = `${unresolved} unresolved ${unresolved === 1 ? 'dispatch' : 'dispatches'} across this device’s recorded configurations at ${receivedAt}.`;
 }
 let reportedService = permitted ? 'No saved service observation selected.' : 'Inspection permission required.';
 if (service.reading) reportedService = 'Reading the selected observation…';
 else if (service.error) reportedService = 'Saved service observation unavailable.';
 else if (service.result) {
  const {validator, observedAt, serviceState} = service.result;
  reportedService = `${validator} reported ${serviceState} in the selected observation. Capture time ${observedAt}.`;
 }
 const evidence = {jobs, service: reportedService};

 return <Card title="Offboarding dependencies">
  <p>Review each obligation before removing the installation. Local journal counts cover previously recorded configurations. A saved service observation describes the file’s reported validator at capture.</p>
  <Table rows={dependencies.map(row => ({...row, evidence: evidence[row.id] ?? 'Operator evidence required.'}))} columns={columns}/>
  <div className="native-actions">
   <button disabled={!permitted || (requested && journal.loading)} onClick={() => requested ? journal.reload() : setRequested(true)}>Check local unresolved dispatches</button>
   <button onClick={onOpenHistory}>Review local request history</button>
  </div>
  {permitted && <div className="native-actions">
   <label>Saved validator service observation JSON <input type="file" accept=".json,application/json" onChange={service.select}/></label>
   {(service.reading || service.error || service.result) && <button onClick={service.clear}>Clear saved service observation</button>}
  </div>}
  <ErrorMessage error={service.error}/>
  {journal.data && <p>Remote job state requires separate reconciliation.</p>}
 </Card>;
}

export function ControllerRemoval({target, permitted, busy, controller, result, inventoryAction, preflightAction, run}) {
 const [review, setReview] = useState(null);
 const [confirmation, setConfirmation] = useState('');
 const scope = removalScope(target);
 const gate = controllerOperation(controller, 'uninstall');
 const available = Boolean(scope && permitted && !busy && gate.available);
 const current = sameRemovalScope(review, scope);
 const confirmed = current && confirmation === removalRoot;
 const close = () => {setReview(null); setConfirmation('');};

 return <Card title="Containment and removal">
  {inventoryAction}
  {preflightAction}
  {result?.operation === 'uninstall_preflight' && <p role="status">
   The selected controller returned a removal preflight response at {new Date(result.receivedAt).toISOString()}.
   Confirm separate offboarding obligations with their owners.
  </p>}
  <p>Host removal deletes the installation under {removalRoot}, including chain data, node custody and signing-safety records. File retention needs a separate approved backup.</p>
  <button disabled={!available} onClick={() => {setConfirmation(''); setReview(scope);}}>Review destructive removal</button>
  {!gate.available && <p>{gate.blocker}</p>}
  {review && <ModalDialog label="Review destructive node removal" onClose={close}>
   <h2>Review destructive node removal</h2>
   <Detail data={{
    target: review.kind === 'local' ? 'This machine' : review.host,
    sshPort: review.port,
    installationRoot: review.root,
   }}/>
   <p>This request removes files from the selected host. Chain exit, VPN removal and signer retirement follow separate procedures.</p>
   {!current && <p role="status">The target changed. Close this review and reopen it for the current target.</p>}
   <label>Confirm destructive root
    <input aria-label="Confirm destructive root" autoComplete="off" value={confirmation}
     onChange={event => setConfirmation(event.target.value)} placeholder={removalRoot}/>
   </label>
   <div className="native-actions">
    <button data-initial-focus onClick={close}>Cancel</button>
    <button disabled={!available || !confirmed} onClick={() => {
     if (!available || !confirmed) return;
     const parameters = uninstallParameters(review, confirmation);
     close();
     run('uninstall', parameters);
    }}>Continue to native removal review</button>
   </div>
  </ModalDialog>}
 </Card>;
}
