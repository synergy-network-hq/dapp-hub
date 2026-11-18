import {useState} from 'react';
import {Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {commissioningDraftIdentity} from './commissioning-public-evidence.js';
import {releaseReferenceChecks,upgradeParameters} from './nodeNetwork.js';
import {readDraftPackageManifest} from './saved-upgrade-intent.js';
import {compareSavedReplacementIntent,readReplacementStageManifest,replacementIntentPins} from './saved-replacement-intent.js';
import {useObservationFile} from './useObservationFile.js';

function IntentFindings({result}) {
 const {protectedCandidate:protectedFiles}=result;
 return <section aria-label="Interrupted replacement intent findings">
  <p>{result.intentDigestChecked?'The saved intent digest matches the independently supplied SHA-256.':'No independent intent digest was supplied.'}</p>
  <ul>
   <li>{result.candidateMatches?'The recorded candidate matches the reviewed package manifest.':'The recorded candidate differs from the reviewed package manifest.'}</li>
   <li>{result.stageMatches?'The recorded stage matches the reviewed commissioning manifest.':'The recorded stage differs from the reviewed commissioning manifest.'}</li>
   {protectedFiles&&<li>{protectedFiles.netbirdMatches?'The candidate declares the preserved NetBird executable digest.':'The candidate omits the preserved NetBird executable digest or declares a different digest.'}</li>}
  </ul>
  <Detail data={{recordedProtectedFiles:result.recordedProtectedFiles,
   candidateProtectedFilesCompared:protectedFiles?.overlapCount,candidateProtectedFileConflicts:protectedFiles?.conflictCount}}/>
  {!protectedFiles&&<p>Both recorded input digests must match to compare the protected candidate files.</p>}
 </section>;
}

function IntentFile({candidate,stage,intentPin,canRead}) {
 const {result,error,reading,clear,select}=useObservationFile((file,current)=>
  compareSavedReplacementIntent(file,{candidate,stage,intentPin},()=>current()&&canRead()));
 return <>
  <label>Saved interrupted replacement intent JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(result||error||reading)&&<button onClick={clear}>Clear replacement intent check</button>}
  {reading&&<p role="status">Checking the saved replacement intent…</p>}
  <ErrorMessage error={error}/>
  {result&&<IntentFindings result={result}/>}
 </>;
}

function InputManifests({form,references,pins,canRead}) {
 const candidate=useObservationFile((file,current)=>readDraftPackageManifest(file,references,()=>current()&&canRead(),
  'The selected candidate package manifest differs from the current draft release or manifest SHA-256.'));
 const stage=useObservationFile((file,current)=>readReplacementStageManifest(file,pins.stagePin,form,()=>current()&&canRead()));
 return <>
  <label>Replacement candidate package manifest JSON <input type="file" accept=".json,application/json" onChange={candidate.select}/></label>
  {candidate.reading&&<p role="status">Checking the candidate package manifest…</p>}
  {candidate.result&&<p role="status">The candidate package manifest matches the current draft.</p>}
  <ErrorMessage error={candidate.error}/>
  <label>Replacement commissioning manifest JSON <input type="file" accept=".json,application/json" onChange={stage.select}/></label>
  {stage.reading&&<p role="status">Checking the replacement commissioning manifest…</p>}
  {stage.result&&<p role="status">The replacement commissioning manifest matches the supplied digest and current draft identity.</p>}
  <ErrorMessage error={stage.error}/>
  {candidate.result&&stage.result&&<IntentFile key={`${candidate.revision}:${stage.revision}`} candidate={candidate.result}
   stage={stage.result} intentPin={pins.intentPin} canRead={canRead}/>}
 </>;
}

export function SavedReplacementIntent({form,canRead}) {
 const [stage,setStage]=useState(''),[intent,setIntent]=useState('');
 const identity=commissioningDraftIdentity(form);
 const references=releaseReferenceChecks(form).every(check=>check.valid) ? upgradeParameters(form) : null;
 const pins=replacementIntentPins(stage,intent);
 return <section aria-label="Saved interrupted replacement intent">
  <h3>Interrupted replacement intent</h3>
  <p>Compare the saved intent with the candidate package and commissioning manifest. The review covers saved inputs. Current host state and recovery completion require separate operator evidence.</p>
  <div className="native-grid">
   <label>Expected replacement commissioning SHA-256 <input autoComplete="off" maxLength={64} value={stage} onChange={event=>setStage(event.target.value)}/></label>
   <label>Expected replacement intent SHA-256 (optional) <input autoComplete="off" maxLength={64} value={intent} onChange={event=>setIntent(event.target.value)}/></label>
  </div>
  {!identity||!references ? <p>Enter the candidate release and deployment identity in Operations first.</p>
   : !pins ? <p>Enter an independently supplied commissioning SHA-256. An intent digest is optional.</p>
   : <InputManifests key={JSON.stringify([identity,references,pins])} form={form} references={references} pins={pins} canRead={canRead}/>}
 </section>;
}
