import {useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {genesisDigest} from './genesis-pin.js';
import {installParameters,provisioningChecks} from './nodeNetwork.js';
import {readSavedControllerPolicy} from './saved-controller-policy.js';
import {useObservationFile} from './useObservationFile.js';

function finding(value,yes,no) {
 return value === null ? 'Unavailable' : value ? yes : no;
}

function PolicyFindings({result,draft}) {
 if (result.status === 'pin-mismatch') return <p role="status">The selected policy bytes differ from the expected SHA-256.</p>;
 const {releaseListed,manifestMatches,inventoryAuthenticated,networkListed,chainMatches,reportedChain,installListed,scope} = result;
 const matchesDraft = releaseListed && manifestMatches && inventoryAuthenticated && networkListed && chainMatches && installListed;
 return <section aria-label="Saved controller policy findings">
  <p role="status">{matchesDraft ? 'The saved policy matches the compared installation clauses.'
   : 'One or more installation clauses in the saved policy are missing or differ.'}</p>
  <Detail data={{
   'reviewed policy SHA-256':result.policySha256,
   release:finding(releaseListed,'Draft release listed','Draft release absent'),
   'manifest SHA-256':finding(manifestMatches,'Draft digest matches','Draft digest differs'),
   inventory:finding(inventoryAuthenticated,'Recorded as authenticated','Authentication absent from release entry'),
   network:finding(networkListed,'Draft network listed','Draft network absent'),
   'chain ID':finding(chainMatches,`Draft chain matches (${draft.chain_id})`,`Policy records ${reportedChain}; draft specifies ${draft.chain_id}.`),
   'install qualification':finding(installListed,'Install listed as qualified','Install absent from qualified operations'),
   qualificationScope:scope === 'disposable' ? 'Disposable test scope' : scope === 'other' ? 'Unrecognized scope' : 'No declared scope',
  }}/>
 </section>;
}

function PolicyFile({pin,form,draft,canRead}) {
 const {result,error,reading,clear,select} = useObservationFile((file,current)=>
  readSavedControllerPolicy(file,pin,form,()=>current() && canRead()));
 return <>
  <label>Saved controller policy JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(result || error || reading) && <button onClick={clear}>Clear policy review</button>}
  {reading && <p role="status">Checking the selected controller policy…</p>}
  <ErrorMessage error={error}/>
  {result && <PolicyFindings result={result} draft={draft}/>}
 </>;
}

function PolicyPin({form,canRead}) {
 const [value,setValue] = useState('');
 const pin = genesisDigest(value);
 const draft = provisioningChecks(form).every(check=>check.valid) ? installParameters(form) : null;
 return <>
  <p>Compare a saved controller policy with this provisioning draft using a SHA-256 from an independent source.</p>
  <label>Expected policy file SHA-256 <input value={value} onChange={event=>setValue(event.target.value)} maxLength={64} autoComplete="off"/></label>
  {!draft ? <p>Complete the provisioning draft before selecting a policy.</p>
   : !pin ? <p>Enter the expected 64-character SHA-256 before selecting a policy.</p>
   : <PolicyFile key={JSON.stringify([pin,draft])} pin={pin} form={form} draft={draft} canRead={canRead}/>}
 </>;
}

export function SavedControllerPolicy({form,permitted,canRead = () => permitted}) {
 return <Card title="Saved controller policy review">
  {permitted ? <PolicyPin form={form} canRead={canRead}/>
   : <p>Allow NodeNetwork inspection in Security &amp; permissions to review saved controller policy.</p>}
  <p>Current host approval and one-time authorization require separate verification on an enrolled controller.</p>
 </Card>;
}
