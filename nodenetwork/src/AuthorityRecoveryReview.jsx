import {useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {authorityRecoveryScope,compareAuthorityRecoveryPublicFile,readAuthorityRecoveryCompletion,readAuthorityRecoveryPlan} from './authority-recovery-evidence.js';
import {genesisDigest} from './genesis-pin.js';
import {useObservationFile} from './useObservationFile.js';

const bindingFinding={matches:'The embedded authority bindings match the recorded original and successor digests.',
 differs:'An embedded authority binding differs from the reviewed plan.',unsupported:'The embedded authority binding evidence is unsupported.'};

function EvidenceFile({label,read,show,canRead}) {
 const {reading,result,error,select}=useObservationFile((file,current)=>read(file,()=>current()&&canRead()));
 return <>
  <label>{label} <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading&&<p role="status">Checking the selected evidence…</p>}
  <ErrorMessage error={error}/>
  {result&&<p role="status">{show(result)}</p>}
 </>;
}

function RecoveryPlanFile({pin,scope,canRead}) {
 const {reading,result,error,revision,select,clear}=useObservationFile((file,current)=>
  readAuthorityRecoveryPlan(file,pin,scope,()=>current()&&canRead()));
 return <>
  <label>Saved authority-recovery plan JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(reading||error||result)&&<button onClick={clear}>Clear authority-recovery plan</button>}
  {reading&&<p role="status">Checking the saved authority-recovery plan…</p>}
  <ErrorMessage error={error}/>
  {result&&<section key={revision} aria-label="Authority-recovery plan findings">
   <p role="status">The plan matches the independent digest and current Canary draft scope.</p>
   <Detail data={{role:result.findings.role==='validator'?'Validator':'RPC gateway',plannedFiles:result.findings.plannedFiles,
    changedFileDigests:result.findings.changedFiles,preservedNetworkPins:result.findings.preservedNetworkPins}}/>
   <p>{result.findings.priorCertificateRecorded?'The plan records a prior certificate digest.':'The plan records no prior certificate.'}</p>
   <EvidenceFile label="Saved authority-recovery completion JSON" canRead={canRead}
    read={(file,current)=>readAuthorityRecoveryCompletion(file,result,current)}
    show={()=>'The matching saved receipt reports that native preflight passed.'}/>
   <EvidenceFile label="Saved replacement authority certificate JSON" canRead={canRead}
    read={(file,current)=>compareAuthorityRecoveryPublicFile(file,'certificate',result,current)}
    show={({matches,bindings})=>matches?`Certificate bytes match the reviewed plan. ${bindingFinding[bindings]}`:'Certificate bytes differ from the reviewed plan.'}/>
   <EvidenceFile label="Saved successor authority JSON" canRead={canRead}
    read={(file,current)=>compareAuthorityRecoveryPublicFile(file,'authority',result,current)}
    show={({matches})=>matches?'Successor authority bytes match the reviewed plan.':'Successor authority bytes differ from the reviewed plan.'}/>
  </section>}
 </>;
}

function RecoveryPlanPin({form,canRead}) {
 const [expected,setExpected]=useState('');
 const scope=authorityRecoveryScope(form);
 const pin=genesisDigest(expected);
 return <>
  <p>Review a saved Canary authority-recovery plan using its independently supplied SHA-256.</p>
  <label>Expected authority-recovery plan SHA-256 <input autoComplete="off" value={expected} maxLength={64} onChange={event=>setExpected(event.target.value)}/></label>
  {!scope ? <p>Enter the Canary network, chain 99999 and package SHA-256 in the provisioning draft.</p>
   : !pin ? <p>Enter the expected plan digest before selecting a plan.</p>
   : <RecoveryPlanFile key={JSON.stringify([scope,pin])} pin={pin} scope={scope} canRead={canRead}/>}
 </>;
}

export function AuthorityRecoveryReview({form,permitted,canRead=()=>permitted}) {
 return <Card title="Saved authority recovery">
  {permitted?<RecoveryPlanPin form={form} canRead={canRead}/>
   :<p>Allow NodeNetwork inspection in Security &amp; permissions to review saved authority recovery.</p>}
  <p>Signature verification, current VPN and service state, and activation authority require separate owner evidence.</p>
 </Card>;
}
