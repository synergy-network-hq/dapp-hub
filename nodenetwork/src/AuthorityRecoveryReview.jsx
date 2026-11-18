import {useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {authorityRecoveryScope,authorityRecoveryStartupFindings,compareAuthorityRecoveryPublicFile,compareAuthorityRecoveryStartupFile,
 readAuthorityRecoveryCompletion,readAuthorityRecoveryPlan} from './authority-recovery-evidence.js';
import {genesisDigest} from './genesis-pin.js';
import {useObservationFile} from './useObservationFile.js';

const bindingFinding={matches:'The embedded authority bindings match the recorded original and successor digests.',
 differs:'An embedded authority binding differs from the reviewed plan.',unsupported:'The embedded authority binding evidence is unsupported.'};
const filePhase={before:'matches the prior digest',after:'matches the planned digest',unchanged:'matches both recorded digests',
 different:'matches neither recorded digest'};
const startupPhase={before:'The three saved startup files match the prior snapshot.',
 after:'The three saved startup files match the planned snapshot.',mixed:'The saved startup files mix prior and planned snapshots.',
 unavailable:'The selected files do not establish a recorded startup snapshot.'};

function startupCertificateFinding(certificate) {
 if (!certificate) return 'Select the recovery certificate above to compare its bytes and authority bindings.';
 if (!certificate.matches) return 'The selected certificate digest differs from the reviewed plan.';
 return bindingFinding[certificate.bindings];
}

function EvidenceFile({label,read,show,canRead}) {
 const review=useObservationFile((file,current)=>read(file,()=>current()&&canRead()));
 return <EvidenceFileInput label={label} review={review} show={show}/>;
}

function EvidenceFileInput({label,review,show}) {
 const {reading,result,error,select}=review;
 return <>
  <label>{label} <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading&&<p role="status">Checking the selected evidence…</p>}
  <ErrorMessage error={error}/>
  {result&&<p role="status">{show(result)}</p>}
 </>;
}

function useStartupFile(kind,plan,canRead) {
 return useObservationFile((file,current)=>compareAuthorityRecoveryStartupFile(file,kind,plan,()=>current()&&canRead()));
}

function StartupFindings({report,certificate}) {
 return <section aria-label="Authority-recovery startup findings">
  <p role="status">{startupPhase[report.stage]}</p>
  {report.stage==='after'&&(report.identityMatches===undefined ? <p>Saved startup clauses could not be read.</p> : <ul>
   <li>{report.identityMatches?'The saved startup records match the reviewed validator role, package and Canary network.'
    :'A saved startup record differs from the reviewed validator role, package or Canary network.'}</li>
   <li>{report.certificateReferencesMatch?'The saved startup records reference the planned recovery certificate.'
    :'A saved startup record differs from the planned recovery certificate reference.'}</li>
   <li>{report.networkBindingsMatch?'The saved configuration references and startup policy pins match the planned public network inputs.'
    :'A saved configuration reference or startup policy pin differs from the planned public network inputs.'}</li>
  </ul>)}
  {report.stage==='after'&&<p>{startupCertificateFinding(certificate)}</p>}
 </section>;
}

function StartupPinReview({plan,certificate,canRead}) {
 const configuration=useStartupFile('configuration',plan,canRead);
 const receipt=useStartupFile('receipt',plan,canRead);
 const policy=useStartupFile('policy',plan,canRead);
 const files=[['Saved node configuration',configuration],['Saved installation receipt',receipt],['Saved startup policy',policy]];
 const reviewed=files.every(([,file])=>file.result||file.error);
 const report=reviewed&&authorityRecoveryStartupFindings({configuration:configuration.result,receipt:receipt.result,policy:policy.result});
 return <section aria-label="Saved validator startup snapshot">
  <h3>Saved validator startup snapshot</h3>
  <p>Select copies of the node configuration, installation receipt and startup policy to compare them with the reviewed recovery plan.</p>
  {files.map(([label,review])=><EvidenceFileInput key={label} label={`${label} JSON`} review={review}
   show={result=>`${label} ${filePhase[result.stage]}.`}/>)}
  {files.some(([,file])=>file.reading||file.result||file.error)&&<button onClick={()=>files.forEach(([,file])=>file.clear())}>Clear startup file review</button>}
  {report&&canRead()&&<StartupFindings report={report} certificate={certificate}/>}
 </section>;
}

function RecoveryEvidence({plan,canRead}) {
 const certificate=useObservationFile((file,current)=>compareAuthorityRecoveryPublicFile(file,'certificate',plan,()=>current()&&canRead()));
 return <>
  <EvidenceFile label="Saved authority-recovery completion JSON" canRead={canRead}
   read={(file,current)=>readAuthorityRecoveryCompletion(file,plan,current)}
   show={()=>'The matching saved receipt reports that native preflight passed.'}/>
  <EvidenceFileInput label="Saved replacement authority certificate JSON" review={certificate}
   show={({matches,bindings})=>matches?`Certificate bytes match the reviewed plan. ${bindingFinding[bindings]}`:'Certificate bytes differ from the reviewed plan.'}/>
  <EvidenceFile label="Saved successor authority JSON" canRead={canRead}
   read={(file,current)=>compareAuthorityRecoveryPublicFile(file,'authority',plan,current)}
   show={({matches})=>matches?'Successor authority bytes match the reviewed plan.':'Successor authority bytes differ from the reviewed plan.'}/>
  {plan.startup&&<StartupPinReview plan={plan} certificate={certificate.result} canRead={canRead}/>}
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
   <RecoveryEvidence plan={result} canRead={canRead}/>
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
