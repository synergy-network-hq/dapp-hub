import {useEffect,useRef,useState} from 'react';
import {nodeNetworkController,nodeNetworkBootstrap} from "./native-services.js";
import {Card,Detail,ErrorMessage,useResource,Resource,Table} from "@synergy-network/portal-native/dapp-sdk";
import {controllerOperation,installParameters} from './nodeNetwork.js';
import {installPreflightChecklist,installPreflightObservation} from './install-preflight.js';
import {InstallPreflight} from './InstallPreflight.jsx';
import {controllerRead,installedControllerMutation,installedControllerRead,targetControllerObservation} from './target-observation.js';
import {ControllerUpdate} from './UpdatePackage.jsx';
import {upgradePreflightObservation} from './upgrade-preflight.js';
import {ControllerRemoval} from './Offboarding.jsx';
import {removalPreflightObservation} from './removal-preflight.js';
import {VpnStatus} from './VpnStatus.jsx';
import {validatorStartupBlocker,vpnEnrollmentBlocker,vpnEnrollmentObservation,vpnEnrollmentSupported,vpnStatusObservation} from './vpn-status.js';
import {CustodyStatus} from './CustodyStatus.jsx';
import {custodyStatusObservation,custodyStatusReads} from './custody-status.js';
import {IdentityPreflight} from './IdentityPreflight.jsx';
import {identityPreflightObservation,identityPreflightReads} from './identity-preflight.js';
import {nodeServiceActions,nodeServiceActionObservation,targetHealthObservation} from './target-health.js';
import {recoveryPreflightObservation} from './recovery-handoff.js';

const typedStatus = {
 health: targetHealthObservation,
 upgrade_preflight: upgradePreflightObservation,
 uninstall_preflight: removalPreflightObservation,
 recovery_preflight: recoveryPreflightObservation,
 vpn_status: vpnStatusObservation,
 identity_status: response => custodyStatusObservation('identity_status',response),
 formation_status: response => custodyStatusObservation('formation_status',response),
 identity_preflight: response => identityPreflightObservation('identity_preflight',response),
 formation_preflight: response => identityPreflightObservation('formation_preflight',response),
 genesis_binding_preflight: response => identityPreflightObservation('genesis_binding_preflight',response),
 genesis_stage_preflight: response => identityPreflightObservation('genesis_stage_preflight',response),
};

const healthColumns = [
 {key:'id',label:'Service'},
 ...[['state','Lifecycle'],['health','Health'],['readiness','Service readiness']].map(([key,label])=>({
  key,label,render:row=>row[key][0].toUpperCase()+row[key].slice(1),
 })),
];
const serviceLabels = {start:'Start node',stop:'Stop node',restart:'Restart node'};

function TargetHealth({report}) {
 return <div>
  <h3>Reported service health</h3>
  <ControllerReceipt receivedAt={report.receivedAt}/>
  <Table columns={healthColumns} rows={report.result} empty="The controller returned no service observations."/>
  <p>Service readiness describes each reported service. Consensus readiness and validator membership have separate checks.</p>
 </div>;
}

function ControllerReceipt({receivedAt}) {
 const [now, setNow] = useState(Date.now);
 useEffect(() => {
  setNow(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 15000);
  return () => clearInterval(timer);
 }, [receivedAt]);
 const older = now - receivedAt >= 60000;
 return <p role="status">
  Source: native target controller · Response received {new Date(receivedAt).toISOString()} · {older ? 'Older than one minute' : 'Read within the past minute'}
 </p>;
}

export function NodeController({target,form,setForm,permitted,tab,master,localSupported,onOpenDiagnostics,targetScopeCurrent=()=>permitted}){
 const [operator,setOperator]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
 const [preflightAttempt,setPreflightAttempt]=useState(null);
 const [serviceAcknowledgement,setServiceAcknowledgement]=useState(null);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const key=JSON.stringify(target);
 const capabilities=useResource(async()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return targetControllerObservation(await nodeNetworkController(target,'target'));
 },`${key}:${permitted}`);
 const state=capabilities.data;
 const preflight=installPreflightChecklist({form,target,permitted,capabilities,master,attempt:preflightAttempt});
 const statusGates=Object.fromEntries(Object.keys(typedStatus).map(operation=>[
  operation, ['uninstall_preflight','recovery_preflight'].includes(operation)?controllerRead(state,operation):installedControllerRead(state,operation),
 ]));
 const statusResult=permitted&&statusGates[result?.operation]?.available?result:null;
 const healthResult=statusResult?.operation==='health'?statusResult:null;
 const recoveryResult=statusResult?.operation==='recovery_preflight'?statusResult:null;
 const vpnResult=permitted&&statusGates.vpn_status.available&&['vpn_status','vpn_enroll'].includes(result?.operation)?result:null;
 const enrollmentSupported=permitted&&vpnEnrollmentSupported(state);
 const enrollmentBlocker=vpnEnrollmentBlocker(vpnResult?.result);
 const startupBlocker=validatorStartupBlocker(vpnResult?.operation==='vpn_status'?vpnResult.result:null);
 const serviceGates=Object.fromEntries(nodeServiceActions.map(operation=>[operation,installedControllerMutation(state,operation)]));
 const custodyResult=custodyStatusReads.some(read=>read.operation===statusResult?.operation)?statusResult:null;
 const preparationResult=identityPreflightReads.some(read=>read.operation===statusResult?.operation)?statusResult:null;
 async function run(operation,parameters={}){
  const read=statusGates[operation];
  const isPreflight=operation==='install_preflight';
  const isEnrollment=operation==='vpn_enroll';
  const isServiceAction=nodeServiceActions.includes(operation);
  const scopeSensitive=isEnrollment||isServiceAction||operation==='health'||operation==='vpn_status';
  if(!permitted||busy||(read&&!read.available)||(isPreflight&&!preflight.canRun))return;
  if(isEnrollment&&(!enrollmentSupported||enrollmentBlocker||vpnResult?.operation!=='vpn_status'))return;
  if(isServiceAction&&(!serviceGates[operation].available||(operation!=='stop'&&startupBlocker)))return;
  if(scopeSensitive&&!targetScopeCurrent()){
   setResult(null);setServiceAcknowledgement(null);
   setError('The target, recovery state or permission changed. Review the selected controller again.');
   return;
  }
  setBusy(true);setError('');setResult(null);
  if(operation!=='health')setServiceAcknowledgement(null);
  const submitted={...parameters};
  setPreflightAttempt(isPreflight?{parameters:submitted,state:'pending'}:null);
  try{
   const raw=await nodeNetworkController(target,operation,submitted);
   let response=raw;
   if(isPreflight)response=installPreflightObservation(raw,submitted,target);
   else if(isEnrollment)response=vpnEnrollmentObservation(raw);
   else if(isServiceAction)response=nodeServiceActionObservation(operation,raw);
   else if(read)response=typedStatus[operation](raw,submitted);
   if(alive.current&&(!scopeSensitive||targetScopeCurrent())){
    const receivedAt=Date.now();
    if(isPreflight)setPreflightAttempt({parameters:submitted,state:'received',receivedAt,observation:response});
    else if(isServiceAction)setServiceAcknowledgement({operation:response.requested,receivedAt});
    else setResult({operation,submitted,result:response,receivedAt});
    if(!read&&!isPreflight)capabilities.reload();
   }
  }
  catch(failure){
   if(alive.current&&(!scopeSensitive||targetScopeCurrent())){
    if(isPreflight)setPreflightAttempt({parameters:submitted,state:'failed'});
    setError(String(failure?.message||failure));
   }
  }
  finally{if(alive.current)setBusy(false);}
 }
 async function bootstrap(){
  if(!permitted||busy)return;
  setBusy(true);setError('');setResult(null);
  setPreflightAttempt(null);
  try{const submitted=installParameters(form);const response=await nodeNetworkBootstrap(target,operator,submitted);if(response&&alive.current){setResult({operation:'bootstrap',submitted,result:response,receivedAt:Date.now()});capabilities.reload();}}
  catch(failure){if(alive.current)setError(String(failure?.message||failure));}
  finally{if(alive.current)setBusy(false);}
 }
 function button(operation,label,parameters=()=>({})){
  const gate=controllerOperation(state,operation);
  return <div className="native-controller-action" key={operation}><button disabled={!permitted||busy||!gate.available} onClick={()=>{try{run(operation,parameters());}catch(failure){setError(failure.message);}}}>{label}</button>{!gate.available&&<small>{gate.blocker}</small>}</div>;
 }
 function statusAction(operation,label){
  const gate=statusGates[operation];
  return <div className="native-controller-action" key={operation}>
   <button disabled={!permitted||busy||!gate.available} onClick={()=>run(operation)}>{label}</button>
   {permitted&&!gate.available&&<small>{gate.blocker}</small>}
  </div>;
 }
 const serviceControls=<>
  {nodeServiceActions.map(operation=>{
   const gate=serviceGates[operation];
   return <div className="native-controller-action" key={operation}>
    <button disabled={!permitted||busy||!gate.available||(operation!=='stop'&&!!startupBlocker)}
     onClick={()=>run(operation)}>{serviceLabels[operation]}</button>
    {permitted&&!gate.available&&<small>{gate.blocker}</small>}
   </div>;
  })}
  {permitted&&(serviceGates.start.available||serviceGates.restart.available)&&startupBlocker&&<p>{startupBlocker}</p>}
 </>;
 const serviceEvidence=<>
  {permitted&&serviceAcknowledgement&&<section aria-label="Node service action acknowledgement">
   <p>The controller acknowledged the {serviceAcknowledgement.operation} request. Read target health for the service state.</p>
   <ControllerReceipt receivedAt={serviceAcknowledgement.receivedAt}/>
  </section>}
  {healthResult&&<TargetHealth report={healthResult}/>}
 </>;
 return <div className="native-controller">
  <Card title="Authenticated target controller" action={<button disabled={!permitted||busy} onClick={()=>{
   if(typedStatus[result?.operation]||result?.operation==='vpn_enroll')setResult(null);
   setPreflightAttempt(null);setServiceAcknowledgement(null);
   capabilities.reload();
  }}>Inspect selected target</button>}>
   <Resource value={capabilities}>{data=><>
    <ControllerReceipt receivedAt={data.receivedAt}/>
    <Detail data={data.summary}/>
    <p>This controller report describes the selected configuration. Verify node identity, installed state, and consensus readiness through their authoritative checks.</p>
   </>}</Resource>
   <p>Inspect an enrolled target, or bootstrap a clean target from the approved master below. Remote access uses an enrolled dedicated account, verified SSH host keys and agent credentials. No password or private key is sent to the dApp.</p>
  </Card>
  {tab==='Validator setup'&&<div className="native-grid">
   <Card title="Approved installation package">
    <Detail data={form}/><p>Edit package and network references in the provisioning draft above. Native execution validates these references again.</p>
    {master&&<button onClick={()=>setForm({...form,release_id:master.release,manifest_sha256:master.manifestSha256})}>Use inspected manifest in preflight</button>}
    <label>Existing administrative SSH account<input aria-label="Existing administrative SSH account" value={operator} onChange={event=>setOperator(event.target.value)} autoComplete="off"/></label>
    <button disabled={!permitted||busy||!operator||(target.kind==='local'&&!localSupported)} onClick={bootstrap}>Bootstrap clean target from approved master</button>
    <p>Bootstrap uses native package and public-key pickers, verified SSH host identity and agent authentication. Its embedded canonical engine requires an empty /opt/Synergy and confirms the exact target and privilege scope before transmission.</p>
    <p>The R5 baseline is shown for comparison. Its digest alone does not approve this target, network or installation.</p>
    {button('install','Install approved node',()=>installParameters(form))}
    {button('commission','Verify and commission provisioned custody')}
    {button('register','Register contained service')}
   </Card>
   <Card title="Lifecycle and monitoring">
    {statusAction('health','Read target health')}{serviceControls}
    {serviceEvidence}
    <p>Mutations require native operator confirmation and a matching one-time grant on the target. Software installation does not grant consensus membership.</p>
   </Card>
   <InstallPreflight checklist={preflight} action={
    <button disabled={busy||!preflight.canRun} onClick={()=>run('install_preflight',installParameters(form))}>Run installation preflight</button>
   }/>
   <IdentityPreflight permitted={permitted}
    actions={<div className="native-actions">{identityPreflightReads.map(({operation,label})=>statusAction(operation,label))}</div>}
    observation={preparationResult?.result}
    receipt={preparationResult&&<ControllerReceipt receivedAt={preparationResult.receivedAt}/>}/>
  </div>}
  {tab==='Management'&&<Card title="Node lifecycle and diagnostics">
   {statusAction('health','Read target health')}{button('inventory','Inventory node-owned files')}
   {serviceControls}
   {statusAction('recovery_preflight','Diagnose recovery readiness')}
   {serviceEvidence}
   {recoveryResult&&<section aria-label="Recovery preflight evidence">
    <ControllerReceipt receivedAt={recoveryResult.receivedAt}/>
    <p>The controller reports that checkpoint import is unqualified for the selected release.</p>
    <p>The controller reported no change to certified state during this check.</p>
   </section>}
   <p>Health and diagnostics use the selected target controller. Public RPC observations describe their RPC node. Recovery executes only through a separately qualified procedure; this interface does not offer arbitrary checkpoint imports or shell access.</p>
  </Card>}
  {['Management','Validator setup'].includes(tab)&&<VpnStatus
   action={statusAction('vpn_status','Read VPN status')}
   observation={vpnResult?.result}
   receipt={vpnResult&&<ControllerReceipt receivedAt={vpnResult.receivedAt}/>}
   enrollmentReported={vpnResult?.operation==='vpn_enroll'}
   enrollmentAction={enrollmentSupported&&<div className="native-controller-action">
    <button disabled={busy||!!enrollmentBlocker} onClick={()=>run('vpn_enroll')}>Enroll validator VPN</button>
    {enrollmentBlocker&&<small>{enrollmentBlocker}</small>}
    <p>Portal requests native confirmation to use the staged input on this host. The controller requires a matching one-use host grant.</p>
   </div>}
   onOpenDiagnostics={onOpenDiagnostics}/>}
  {tab==='Management'&&<CustodyStatus
   actions={<div className="native-actions">{custodyStatusReads.map(({operation,label})=>statusAction(operation,label))}</div>}
   observation={custodyResult?.result}
   receipt={custodyResult&&<ControllerReceipt receivedAt={custodyResult.receivedAt}/>}
   onOpenHistory={onOpenDiagnostics}/>}
  {tab==='Updates'&&<ControllerUpdate form={form} target={target} permitted={permitted} busy={busy} controller={state} result={statusResult} run={run}/>}
  {tab==='Installation isolation'&&<ControllerRemoval target={target} permitted={permitted} busy={busy}
   controller={state} result={statusResult} run={run}
   inventoryAction={button('inventory','Inventory node-owned files')}
   preflightAction={statusAction('uninstall_preflight','Review uninstall scope')}/>}
  {busy&&<p role="status">Waiting for the target controller. Do not repeat the operation.</p>}
  <ErrorMessage error={error}/>{result&&!typedStatus[result.operation]&&result.operation!=='vpn_enroll'&&<Card title={`Controller result · ${result.operation}`}><p>Response received {new Date(result.receivedAt).toISOString()}. This response is not a durable job record or proof of consensus readiness.</p><Detail data={{submittedOperation:result.operation,submittedPublicParameters:result.submitted}}/><p>These are the inputs submitted by this Portal view, not the current draft, a signed plan or authenticated target-state evidence. Native package/key selection remains part of the separate native review.</p><Detail data={result.result}/></Card>}
 </div>;
}
