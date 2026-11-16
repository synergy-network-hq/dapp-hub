import {useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {commissioningDraftIdentity,commissioningPublicArtifacts,readCommissioningManifest,readCommissioningStartupPolicy,
 reviewCommissioningPublicArtifacts} from './commissioning-public-evidence.js';
import {genesisDigest} from './genesis-pin.js';
import {useObservationFile} from './useObservationFile.js';

function PublicFindings({result}) {
 return <section aria-label="Commissioning public evidence findings">
  {result.status==='digest-mismatch' ? <>
   <p role="status">Some selected public files differ from the recorded SHA-256 digests.</p>
   <ul aria-label="Public files with different digests">{result.mismatches.map(name=><li key={name}>{name}</li>)}</ul>
  </> : <>
   <p role="status">All six public files match the commissioning manifest and startup policy.</p>
   <Detail data={{validatorsInStartupPolicy:result.policyCount,activeValidatorsReportedByAuthority:result.activeCount}}/>
   <p role="status">{result.rosterMatches?'The saved policy and reported active authority roster match.'
    :'The saved policy and reported active authority roster differ.'}</p>
  </>}
 </section>;
}

function PublicFiles({manifest,policy,canRead}) {
 const {result,error,reading,select} = useObservationFile((files,current)=>
  reviewCommissioningPublicArtifacts(files,manifest,policy,()=>current() && canRead()),{maxFiles:commissioningPublicArtifacts.length});
 return <>
  <p>Select the six public network files together.</p>
  <ul aria-label="Required public network files">{commissioningPublicArtifacts.map(({name})=><li key={name}>{name}</li>)}</ul>
  <label>Commissioning public network files <input type="file" multiple accept=".json,.pub,application/json" onChange={select}/></label>
  {reading && <p role="status">Checking the selected public files…</p>}
  <ErrorMessage error={error}/>
  {result && <PublicFindings result={result}/>}
 </>;
}

function StartupFile({manifest,canRead}) {
 const {result,error,reading,revision,select} = useObservationFile((file,current)=>
  readCommissioningStartupPolicy(file,manifest,()=>current() && canRead()));
 return <>
  <label>Saved commissioning startup policy JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Checking the selected startup policy…</p>}
  <ErrorMessage error={error}/>
  {result && <>
   <p role="status">The startup policy matches the manifest and declares the engineering profile. The saved validator and VPN readiness flags record operator declarations.</p>
   <PublicFiles key={revision} manifest={manifest} policy={result} canRead={canRead}/>
  </>}
 </>;
}

function ManifestFile({pin,form,canRead}) {
 const {result,error,reading,revision,clear,select} = useObservationFile((file,current)=>
  readCommissioningManifest(file,pin,form,()=>current() && canRead()));
 return <>
  <label>Saved APQE commissioning manifest JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(result || error || reading) && <button onClick={clear}>Clear commissioning review</button>}
  {reading && <p role="status">Checking the selected commissioning manifest…</p>}
  <ErrorMessage error={error}/>
  {result && <>
   <p role="status">The commissioning manifest matches the supplied digest and current draft identity.</p>
   <StartupFile key={revision} manifest={result} canRead={canRead}/>
  </>}
 </>;
}

function CommissioningPin({form,canRead}) {
 const [input,setInput] = useState('');
 const pin = genesisDigest(input);
 const draft = commissioningDraftIdentity(form);
 return <>
  <p>Compare saved engineering commissioning files using a manifest SHA-256 from an independent source.</p>
  <label>Expected commissioning manifest SHA-256 <input value={input} onChange={event=>setInput(event.target.value)} maxLength={64} autoComplete="off"/></label>
  {!draft ? <p>Enter a valid network, chain ID and node name in the provisioning draft.</p>
   : !pin ? <p>Enter the expected 64-character SHA-256 before selecting the manifest.</p>
   : <ManifestFile key={JSON.stringify([pin,draft])} pin={pin} form={form} canRead={canRead}/>}
 </>;
}

export function CommissioningPublicEvidence({form,permitted,canRead = ()=>permitted}) {
 return <Card title="Commissioning public evidence">
  {permitted ? <CommissioningPin form={form} canRead={canRead}/>
   : <p>Allow NodeNetwork inspection in Security &amp; permissions to review saved commissioning files.</p>}
  <p>This review is scoped to engineering evidence. Native signature verification, custody, live VPN checks and production approval require separate verification.</p>
 </Card>;
}
