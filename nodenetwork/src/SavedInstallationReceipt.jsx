import {Card,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {installParameters,provisioningChecks} from './nodeNetwork.js';
import {compareSavedInstallationReceipt,readInstallationPackageManifest} from './saved-installation-receipt.js';
import {useObservationFile} from './useObservationFile.js';

const findings = [
 ['rootMatches','Canonical installation root'],
 ['validatorRole','Validator role'],
 ['networkMatches','Draft network incarnation'],
 ['chainMatches','Draft chain ID'],
 ['nodeNameMatches','Draft validator node name'],
 ['digestMatches','Package manifest SHA-256'],
 ['inventoryMatches','Declared software inventory'],
];

function ReceiptFile({manifest,form,canRead}) {
 const {result,error,reading,select} = useObservationFile((file,current)=>
  compareSavedInstallationReceipt(file,manifest,form,()=>current() && canRead()));
 return <>
  <label>Saved installation receipt JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Checking the selected installation receipt…</p>}
  <ErrorMessage error={error}/>
  {result && <section aria-label="Saved installation receipt findings">
   <p role="status">{findings.every(([key])=>result[key]) ? 'The saved receipt matches the compared package and draft fields.'
    : 'Some fields in the saved receipt differ from the package or draft.'}</p>
   <ul>{findings.map(([key,label])=><li key={key}>{label} {result[key] ? 'matches' : 'differs'}</li>)}</ul>
   <p>Software members declared in the receipt {result.declaredMembers}</p>
  </section>}
 </>;
}

function ManifestFile({form,canRead}) {
 const {result,error,reading,revision,clear,select} = useObservationFile((file,current)=>
  readInstallationPackageManifest(file,form,()=>current() && canRead()));
 return <>
  <label>Package manifest for installation receipt <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(result || error || reading) && <button onClick={clear}>Clear installation receipt review</button>}
  {reading && <p role="status">Checking the selected package manifest…</p>}
  <ErrorMessage error={error}/>
  {result && <>
   <p role="status">The package manifest matches the release ID and SHA-256 in the current draft.</p>
   <ReceiptFile key={revision} manifest={result} form={form} canRead={canRead}/>
  </>}
 </>;
}

export function SavedInstallationReceipt({form,permitted,canRead = ()=>permitted}) {
 const draft = permitted && provisioningChecks(form).every(check=>check.valid) ? installParameters(form) : null;
 return <Card title="Saved installation receipt review">
  {!permitted ? <p>Allow NodeNetwork inspection in Security &amp; permissions to review saved installation files.</p>
   : !draft ? <p>Complete the provisioning draft using independently reviewed release references to compare saved installation files.</p>
   : <ManifestFile key={JSON.stringify(draft)} form={form} canRead={canRead}/>}
  <p>The review compares declarations in two selected files. The installed software, file ownership and service state require separate host checks.</p>
 </Card>;
}
