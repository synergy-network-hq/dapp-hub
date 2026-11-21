import {useState} from 'react';
import {Card, Detail, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {readReplacementRecoveryFile,replacementRecoveryPins} from './replacement-recovery.js';
import {useObservationFile} from './useObservationFile.js';
import {SavedReplacementIntent} from './SavedReplacementIntent.jsx';

function RecoveryFile({pins, canRead}) {
 const {result, error, reading, clear, select} = useObservationFile((file,current) => {
  if (!canRead()) throw Error('NodeNetwork inspection is unavailable for this bundle.');
  return readReplacementRecoveryFile(file,pins,() => current() && canRead());
 });
 return <>
  <div className="native-actions">
   <label>Replacement recovery tar <input type="file" accept=".tar,application/x-tar" onChange={select}/></label>
   {(reading || result || error) && <button onClick={clear}>Clear recovery bundle review</button>}
  </div>
  {reading && <p role="status">Reviewing the selected recovery archive…</p>}
  <ErrorMessage error={error}/>
  {result && <section aria-label="Replacement recovery digest comparison">
   <p role="status">{result.verifiedToolFiles} recovery tool digests match the embedded manifest.</p>
   <Detail data={{archiveSha256:result.archiveSha256,basePackageSha256:result.basePackageSha256}}/>
   <ul>
    <li>{result.archivePinMatches ? 'Archive digest matches the expected SHA-256.' : 'Archive digest differs from the expected SHA-256.'}</li>
    <li>{result.basePinMatches ? 'Base package digest matches the expected SHA-256.' : 'Base package digest differs from the expected SHA-256.'}</li>
   </ul>
  </section>}
 </>;
}

function RecoveryPins({canRead}) {
 const [base,setBase] = useState('');
 const [archive,setArchive] = useState('');
 const pins = replacementRecoveryPins(base,archive);
 return <>
  <p>Enter the independently supplied SHA-256 digests for the base package manifest and the owner’s replacement recovery tar.</p>
  <div className="native-grid">
   <label>Expected base package SHA-256 <input autoComplete="off" maxLength={128} value={base} onChange={event => setBase(event.target.value)}/></label>
   <label>Expected recovery archive SHA-256 <input autoComplete="off" maxLength={128} value={archive} onChange={event => setArchive(event.target.value)}/></label>
  </div>
  {pins ? <RecoveryFile key={`${pins.base}:${pins.archive}`} pins={pins} canRead={canRead}/>
   : <p>Both digests need 64 hexadecimal characters before a file can be selected.</p>}
 </>;
}

export function ReplacementRecoveryReview({form,permitted,canRead = () => permitted}) {
 return <Card title="Replacement recovery bundle">
  {permitted ? <RecoveryPins canRead={canRead}/>
   : <p>Allow NodeNetwork inspection in Security &amp; permissions to review the local recovery bundle.</p>}
  <p>Managed recovery requires a verified target, its retained replacement intent, and approved staged inputs.</p>
  {permitted&&<SavedReplacementIntent form={form} canRead={canRead}/>}
 </Card>;
}
