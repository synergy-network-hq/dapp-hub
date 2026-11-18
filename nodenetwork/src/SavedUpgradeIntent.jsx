import {useState} from 'react';
import {Card, Detail, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {releaseReferenceChecks,upgradeParameters} from './nodeNetwork.js';
import {compareSavedUpgradeCompletion,compareSavedUpgradeManifest,readSavedUpgradeIntent,savedUpgradeCompletionPins} from './saved-upgrade-intent.js';
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

function CompletionFile({pins,canRead}) {
 const {result,error,reading,clear,select} = useObservationFile((file,current)=>
  compareSavedUpgradeCompletion(file,pins,()=>current() && canRead()));
 const matches = result?.priorMatches && result.candidateMatches;
 return <>
  <label>Saved software upgrade completion JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(reading || error || result) && <button onClick={clear}>Clear completion receipt</button>}
  {reading && <p role="status">Checking the saved completion receipt…</p>}
  <ErrorMessage error={error}/>
  {result && <section aria-label="Saved upgrade completion comparison">
   <p role="status">{matches ? 'The saved completion receipt matches both package references.'
    : 'The saved completion receipt differs from the package references.'}</p>
   <Detail data={{reportedPriorManifestSha256:result.priorPin,priorReference:result.priorMatches?'Matches':'Differs',
    reportedCandidateManifestSha256:result.candidatePin,candidateReference:result.candidateMatches?'Matches':'Differs'}}/>
   {matches && <Detail data={{recordedPath:result.resumed?'Resumed a recorded upgrade':'Started a new upgrade',
    consensusStarted:result.consensusStarted?'Yes':'No',automaticRestart:result.automaticRestart?'Yes':'No'}}/>}
  </section>}
 </>;
}

function SavedCompletion({references,canRead}) {
 const [prior,setPrior] = useState('');
 const pins = savedUpgradeCompletionPins(prior,references.manifest_sha256);
 return <details>
  <summary>Review a saved upgrade completion receipt</summary>
  <p>Use the owner’s upgrade-completed.json and an independently supplied prior manifest digest. Confirm the originating host and current service state with the node operator.</p>
  <label>Expected prior manifest SHA-256 <input value={prior} onChange={event=>setPrior(event.target.value)} maxLength={64} autoComplete="off"/></label>
  {pins ? <CompletionFile key={prior} pins={pins} canRead={canRead}/>
   : <p>Enter the previous manifest’s 64-character lowercase SHA-256, distinct from the candidate digest.</p>}
 </details>;
}

export function SavedUpgradeIntent({form,permitted,canRead = () => permitted}) {
 const references = releaseReferenceChecks(form).every(check=>check.valid) ? upgradeParameters(form) : null;
 return <Card title="Saved interrupted upgrade">
  <p>Use the release references above, the owner’s saved upgrade-intent.json and the candidate package.json to compare the recorded software changes locally.</p>
  {!permitted ? <p>Allow NodeNetwork inspection in Security &amp; permissions to review saved upgrade evidence.</p>
   : references ? <div key={JSON.stringify(references)}>
    <IntentFiles references={references} canRead={canRead}/>
    <SavedCompletion references={references} canRead={canRead}/>
   </div>
   : <p>Enter an approved release ID and manifest SHA-256 above to open a saved upgrade intent.</p>}
  <p>Managed recovery requires the enrolled controller, current host evidence and native authorization.</p>
 </Card>;
}
