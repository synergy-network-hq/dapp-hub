import {useState} from 'react';
import {Card, Detail, ModalDialog} from '@synergy-network/portal-native/dapp-sdk';
import {controllerOperation, releaseReferenceChecks, sameUpgradeParameters, upgradeParameters} from './nodeNetwork.js';

export function UpdatePackage({form, setForm}) {
 const invalid = releaseReferenceChecks(form).filter(check => !check.valid);
 return <Card title="Managed validator updates">
  <label>Approved release ID
   <input value={form.release_id} maxLength={128} autoComplete="off"
    onChange={event => setForm({...form, release_id: event.target.value})}/>
  </label>
  <label>Approved manifest SHA-256
   <input value={form.manifest_sha256} maxLength={64} autoComplete="off"
    onChange={event => setForm({...form, manifest_sha256: event.target.value})}/>
  </label>
  {invalid.length ? <ul aria-label="Update package reference checks">{invalid.map(check => <li key={check.field}>{check.message}</li>)}</ul>
   : <p>Release references pass the request format checks.</p>}
  <p>These references are shared with the provisioning draft. To retain them between sessions, save the draft in Operations.</p>
  <p>Stage the qualified package inside the Synergy root before a target preflight. Review the running release, downtime and rollback feasibility with the node operator before applying changes.</p>
 </Card>;
}

export function ControllerUpdate({form, target, permitted, busy, controller, result, run}) {
 const [review, setReview] = useState(null);
 const valid = releaseReferenceChecks(form).every(check => check.valid);
 const parameters = valid ? upgradeParameters(form) : null;
 const preflight = controllerOperation(controller, 'upgrade_preflight');
 const apply = controllerOperation(controller, 'upgrade');
 const canApply = permitted && !busy && apply.available && valid;
 const response = result?.operation === 'upgrade_preflight' ? result : null;
 const currentResponse = response && sameUpgradeParameters(response.submitted, parameters);

 return <Card title="Controlled master update">
  {response && <p role="status">{currentResponse
   ? `The controller returned an update preflight response for these references at ${new Date(response.receivedAt).toISOString()}.`
   : 'The release references have changed since the recorded preflight. Rerun it for the current package.'}</p>}
  <button disabled={!permitted || busy || !valid || !preflight.available}
   onClick={() => run('upgrade_preflight', parameters)}>Verify staged update</button>
  {!preflight.available && <p>{preflight.blocker}</p>}
  <button disabled={!canApply} onClick={() => setReview(parameters)}>Apply approved update</button>
  {!apply.available && <p>{apply.blocker}</p>}
  {review && <ModalDialog label="Review update request" onClose={() => setReview(null)}>
   <h2>Review update request</h2>
   <Detail data={{
    target: target.kind === 'local' ? 'This machine' : target.host,
    sshPort: target.kind === 'remote' ? target.port ?? 22 : undefined,
    installationRoot: target.root,
    releaseId: review.release_id,
    manifestSha256: review.manifest_sha256,
   }}/>
   <p>The native review confirms this exact request. Host policy must verify the staged release and a matching operator grant.</p>
   {!sameUpgradeParameters(review, parameters) && <p role="status">The draft changed. Close this review and reopen it for the current package.</p>}
   <div className="native-actions">
    <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
    <button disabled={!canApply || !sameUpgradeParameters(review, parameters)} onClick={() => {
     if (!canApply || !sameUpgradeParameters(review, parameters)) return;
     setReview(null);
     run('upgrade', review);
    }}>Continue to native review</button>
   </div>
  </ModalDialog>}
 </Card>;
}
