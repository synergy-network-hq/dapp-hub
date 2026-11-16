import {Card, Detail, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {releaseReferenceChecks,upgradeParameters} from './nodeNetwork.js';
import {compareSavedUpgradeManifest,readSavedUpgradeIntent} from './saved-upgrade-intent.js';
import {useObservationFile} from './useObservationFile.js';

function UpgradeCandidate({intent,references,canRead}) {
 const {result,error,reading,select} = useObservationFile((file,current) =>
  compareSavedUpgradeManifest(file,intent,references,() => current() && canRead()));
 return <>
  <label>Candidate package manifest JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Comparing the selected manifest…</p>}
  <ErrorMessage error={error}/>
  {result && <section aria-label="Saved upgrade intent comparison">
   <p role="status">The candidate manifest matches the draft and the saved upgrade intent.</p>
   <Detail data={{priorRelease:result.priorRelease,priorManifestSha256:result.priorPin,
    candidateRelease:result.candidateRelease,candidateManifestSha256:result.candidatePin,
    recordedInstallationStage:result.stage,recordedRegistration:result.registered?'Registered services':'No registered services'}}/>
   <ul aria-label="Recorded software inventory changes">
    <li>Added {result.counts.added}</li><li>Changed {result.counts.changed}</li>
    <li>Removed {result.counts.removed}</li><li>Unchanged {result.counts.unchanged}</li>
   </ul>
   {result.registered && <p>The owner requires the node service to be stopped for an upgrade. The intent includes recorded node and VPN service definitions{result.relay?' and the Canary RPC relay':''}.</p>}
   <p>Restart is a separate owner operation. Confirm current service state with the node operator.</p>
  </section>}
 </>;
}

function IntentFiles({references,canRead}) {
 const {result,error,reading,revision,clear,select} = useObservationFile((file,current) =>
  readSavedUpgradeIntent(file,() => current() && canRead()));
 return <>
  <label>Saved software upgrade intent JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(reading || error || result) && <button onClick={clear}>Clear saved upgrade review</button>}
  {reading && <p role="status">Checking the saved upgrade intent…</p>}
  <ErrorMessage error={error}/>
  {result && <UpgradeCandidate key={revision} intent={result} references={references} canRead={canRead}/>}
 </>;
}

export function SavedUpgradeIntent({form,permitted,canRead = () => permitted}) {
 const references = releaseReferenceChecks(form).every(check=>check.valid) ? upgradeParameters(form) : null;
 return <Card title="Saved interrupted upgrade">
  <p>Use the release references above, the owner’s saved upgrade-intent.json and the candidate package.json to compare the recorded software changes locally.</p>
  {!permitted ? <p>Allow NodeNetwork inspection in Security &amp; permissions to review saved upgrade evidence.</p>
   : references ? <IntentFiles key={JSON.stringify(references)} references={references} canRead={canRead}/>
   : <p>Enter an approved release ID and manifest SHA-256 above to open a saved upgrade intent.</p>}
  <p>Managed recovery requires the enrolled controller, current host evidence and native authorization.</p>
 </Card>;
}
