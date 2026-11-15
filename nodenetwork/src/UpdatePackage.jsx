import {useState} from 'react';
import {Card, Detail, ModalDialog} from '@synergy-network/portal-native/dapp-sdk';
import {controllerOperation, releaseReferenceChecks, sameUpgradeParameters, upgradeParameters} from './nodeNetwork.js';
import {installedControllerRead} from './target-observation.js';

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
 const preflight = installedControllerRead(controller, 'upgrade_preflight');
 const apply = controllerOperation(controller, 'upgrade');
 const response = result?.operation === 'upgrade_preflight' ? result : null;
 const currentResponse = preflight.available && response && sameUpgradeParameters(response.submitted, parameters);
 const canReview = permitted && !busy && apply.available && valid && (!response || currentResponse);
 const currentReview = canReview && review && review.receipt === response && review.controller === controller
  && sameUpgradeParameters(review.parameters, parameters);

 return <Card title="Controlled master update">
  {currentResponse && <>
   <p role="status">The controller verified the staged package and installed receipt. Response received {new Date(response.receivedAt).toISOString()}.</p>
   <Detail data={{
    reportedRelease: response.result.release,
    submittedManifestSha256: response.submitted.manifest_sha256,
    automaticRestart: response.result.automaticRestart,
   }}/>
   <p>Confirm service state, downtime and rollback feasibility with the node operator.</p>
  </>}
  {response && !currentResponse && <p role="status">The release references have changed since the recorded preflight. Rerun it for the current package.</p>}
  <button disabled={!permitted || busy || !valid || !preflight.available}
   onClick={() => run('upgrade_preflight', parameters)}>Verify staged update</button>
  {!preflight.available && <p>{preflight.blocker}</p>}
  <button disabled={!canReview} onClick={() => setReview({parameters, receipt:response, controller})}>Apply approved update</button>
  {!apply.available && <p>{apply.blocker}</p>}
  {review && <ModalDialog label="Review update request" onClose={() => setReview(null)}>
   <h2>Review update request</h2>
   <Detail data={{
    target: target.kind === 'local' ? 'This machine' : target.host,
    sshPort: target.kind === 'remote' ? target.port ?? 22 : undefined,
    installationRoot: target.root,
    releaseId: review.parameters.release_id,
    manifestSha256: review.parameters.manifest_sha256,
    preflightReceivedAt: review.receipt ? new Date(review.receipt.receivedAt).toISOString() : undefined,
   }}/>
   {!review.receipt && <p>This review has no verified staged-package preflight. The node operator should verify the current installation or any interrupted upgrade before continuing.</p>}
   <p>The native review confirms this exact request. Host policy must verify the staged release and a matching operator grant.</p>
   {!currentReview && <p role="status">The draft or its preflight changed. Close this review and verify the current package.</p>}
   <div className="native-actions">
    <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
    <button disabled={!currentReview} onClick={() => {
     if (!currentReview) return;
     setReview(null);
     run('upgrade', review.parameters);
    }}>Continue to native review</button>
   </div>
  </ModalDialog>}
 </Card>;
}
