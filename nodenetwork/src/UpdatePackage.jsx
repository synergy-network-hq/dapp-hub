import {useState} from 'react';
import {Card, Detail, ModalDialog} from '@synergy-network/portal-native/dapp-sdk';
import {releaseReferenceChecks, sameUpgradeParameters, upgradeParameters} from './nodeNetwork.js';
import {installedControllerMutation, installedControllerRead} from './target-observation.js';

const upgradeOutcomes = {
 already_current: 'The controller reports this package was already current.',
 completed: 'The controller reports the software upgrade completed.',
 resumed: 'The controller reports the interrupted software upgrade resumed and completed.',
};

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

export function ControllerUpdate({form, target, permitted, busy, controller, result, upgradeResult, upgradeContext, run}) {
 const [review, setReview] = useState(null);
 const valid = releaseReferenceChecks(form).every(check => check.valid);
 const parameters = valid ? upgradeParameters(form) : null;
 const preflight = installedControllerRead(controller, 'upgrade_preflight');
 const apply = installedControllerMutation(controller, 'upgrade');
 const response = result?.operation === 'upgrade_preflight' ? result : null;
 const currentResponse = preflight.available && response && response.upgradeContext === upgradeContext
  && sameUpgradeParameters(response.submitted, parameters);
 const canReview = permitted && !busy && apply.available && valid && (!response || currentResponse);
 const currentReview = canReview && review && review.receipt === response && review.controller === controller && review.context === upgradeContext
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
  <button disabled={!canReview} onClick={() => setReview({parameters, receipt:response, controller, context:upgradeContext})}>Apply approved update</button>
  {!apply.available && <p>{apply.blocker}</p>}
  {upgradeResult&&<section aria-label="Reported software upgrade">
   <p role="status">{upgradeOutcomes[upgradeResult.result.outcome]} Response received {new Date(upgradeResult.receivedAt).toISOString()}.</p>
   <Detail data={{reviewedRelease:upgradeResult.submitted.release_id,installedManifestSha256:upgradeResult.result.manifest,
    previousManifestSha256:upgradeResult.result.previous}}/>
   {upgradeResult.result.vpnRestartRequired===true&&<p>The controller reported that VPN requires a separate restart. Coordinate it with the node operator.</p>}
   {upgradeResult.result.vpnRestartRequired===false&&<p>The controller reported no VPN restart requirement for this upgrade.</p>}
   <p>The receipt reports no automatic restart or consensus start. Check current service health separately.</p>
  </section>}
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
   {!review.receipt && <p>This review has no verified staged-package preflight. The controller can resume an interrupted upgrade with the exact recorded package. Review any interrupted operation with the node operator before continuing.</p>}
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
