import {useState} from 'react';
import {Card, Detail, ErrorMessage, ModalDialog, Table, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests} from './native-services.js';
import {installedControllerMutation} from './target-observation.js';
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
const removalColumns = [
 {key:'label',label:'Area'}, {key:'files',label:'Files'}, {key:'directories',label:'Directories'},
 {key:'sockets',label:'Sockets'}, {key:'fileBytes',label:'Logical file bytes'},
];
const accountImpact = removal => removal.accountRemoval
 ? 'The controller includes the attributed managed account in removal.'
 : 'The controller reported no attributed managed account in removal.';

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

export function ControllerRemoval({target, permitted, busy, controller, result, removalResult, targetContext, inventoryAction, preflightAction, run}) {
 const [review, setReview] = useState(null);
 const [confirmation, setConfirmation] = useState('');
 const scope = removalScope(target);
 const gate = installedControllerMutation(controller, 'uninstall');
 const available = Boolean(scope && permitted && !busy && !removalResult && gate.available);
 const receipt = result?.operation === 'uninstall_preflight' ? result : null;
 const current = sameRemovalScope(review?.scope, scope) && review.receipt === receipt && review.controller === controller
  && review.context === targetContext;
 const confirmed = current && confirmation === removalRoot;
 const close = () => {setReview(null); setConfirmation('');};

 return <Card title="Containment and removal">
  {inventoryAction}
  {preflightAction}
  {receipt && <section aria-label="Removal preflight evidence">
   <p role="status">The controller reported removal scope at {new Date(receipt.receivedAt).toISOString()}.</p>
   <p>{accountImpact(receipt.result)}</p>
   <Table rows={receipt.result.sections} columns={removalColumns}/>
   <p>Counts describe the in-root inventory at receipt. Outside-root audit and forensic erasure require separate evidence.</p>
  </section>}
  <p>Host removal deletes the installation under {removalRoot}, including chain data, node custody and signing-safety records. File retention needs a separate approved backup.</p>
  <button disabled={!available} onClick={() => {setConfirmation(''); setReview({scope,receipt,controller,context:targetContext});}}>Review destructive removal</button>
  {!gate.available && !removalResult && <p>{gate.blocker}</p>}
  {removalResult&&<section aria-label="Reported logical removal">
   <p role="status">The controller reported logical removal of {removalResult.result.root}. Response received {new Date(removalResult.receivedAt).toISOString()}.</p>
   <p>The receipt reports zero remaining attributed host-managed records. Removal created no backup. Forensic erasure remains unverified.</p>
   <p>Track chain exit, VPN retirement and signer obligations separately.</p>
  </section>}
  {review && <ModalDialog label="Review destructive node removal" onClose={close}>
   <h2>Review destructive node removal</h2>
   <Detail data={{
    target: review.scope.kind === 'local' ? 'This machine' : review.scope.host,
    sshPort: review.scope.port,
    installationRoot: review.scope.root,
    reportedInventoryMembers: review.receipt?.result.memberCount,
    preflightReceivedAt: review.receipt ? new Date(review.receipt.receivedAt).toISOString() : undefined,
   }}/>
   <p>{review.receipt ? accountImpact(review.receipt.result) : 'This review has no current removal preflight attached.'}</p>
   <p>This request removes files from the selected host. Chain exit, VPN removal and signer retirement follow separate procedures.</p>
   {!current && <p role="status">The target or its preflight changed. Close this review and reopen it for the current target.</p>}
   <label>Confirm destructive root
    <input aria-label="Confirm destructive root" autoComplete="off" value={confirmation}
     onChange={event => setConfirmation(event.target.value)} placeholder={removalRoot}/>
   </label>
   <div className="native-actions">
    <button data-initial-focus onClick={close}>Cancel</button>
    <button disabled={!available || !confirmed} onClick={() => {
     if (!available || !confirmed) return;
     const parameters = uninstallParameters(review.scope, confirmation);
     close();
     run('uninstall', parameters);
    }}>Continue to native removal review</button>
   </div>
  </ModalDialog>}
 </Card>;
}
