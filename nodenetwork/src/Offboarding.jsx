import {useState} from 'react';
import {Card, Detail, ModalDialog, Table} from '@synergy-network/portal-native/dapp-sdk';
import {controllerOperation} from './nodeNetwork.js';
import {removalRoot, removalScope, sameRemovalScope, uninstallParameters} from './offboarding.js';

const dependencies = [
 {check: 'Pending jobs', next: 'Review the local dispatch journal and reconcile unresolved operations with the node operator.'},
 {check: 'Chain exit and unbonding', next: 'Verify exit, stake and unsettled obligations with the chain operator. Keep tracking them until finalized.'},
 {check: 'Service shutdown', next: 'Confirm the managed validator is stopped through the qualified controller before retiring its signer.'},
 {check: 'VPN peer removal', next: 'Confirm the peer and its access are removed through the approved VPN control plane.'},
 {check: 'Signer retirement', next: 'Verify signer retirement and the approved recovery procedure with the custody operator.'},
 {check: 'Retention', next: 'Preserve required chain data, custody, and signing-safety material through an approved backup procedure before removal.'},
];
const columns = [{key: 'check', label: 'Dependency'}, {key: 'next', label: 'Evidence to review'}];

export function OffboardingChecklist({onOpenHistory}) {
 return <Card title="Offboarding dependencies">
  <p>Use this checklist to gather evidence for each separate obligation before removing the node installation.</p>
  <Table rows={dependencies} columns={columns}/>
  <button onClick={onOpenHistory}>Review local request history</button>
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
