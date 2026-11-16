import {useEffect,useRef,useState} from 'react';
import {nodeNetworkController,nodeNetworkBootstrap,nodeNetworkStageGenesis} from "./native-services.js";
import {Card,Detail,ErrorMessage,useResource,Resource,Table} from "@synergy-network/portal-native/dapp-sdk";
import {controllerOperation,installParameters} from './nodeNetwork.js';
import {installationObservation,installPreflightChecklist,installPreflightObservation} from './install-preflight.js';
import {InstallPreflight} from './InstallPreflight.jsx';
import {controllerRead,installedControllerMutation,installedControllerRead,stagedInstallMutation,targetControllerObservation} from './target-observation.js';
import {ControllerUpdate} from './UpdatePackage.jsx';
import {upgradePreflightObservation} from './upgrade-preflight.js';
import {ControllerRemoval} from './Offboarding.jsx';
import {removalPreflightObservation} from './removal-preflight.js';
import {VpnStatus} from './VpnStatus.jsx';
import {validatorStartupBlocker,vpnEnrollmentBlocker,vpnEnrollmentObservation,vpnEnrollmentSupported,vpnStatusObservation} from './vpn-status.js';
import {CustodyStatus} from './CustodyStatus.jsx';
import {custodyStatusObservation,custodyStatusReads} from './custody-status.js';
import {IdentityPreflight} from './IdentityPreflight.jsx';
import {formationPreparationInputs,formationPreparationObservation,genesisBindingInputs,genesisBindingObservation,identityGenerationInputs,identityGenerationObservation,
 identityPreflightObservation,identityPreflightReads} from './identity-preflight.js';
import {nodeServiceActions,nodeServiceActionObservation,nodeServiceRegistrationObservation,targetHealthObservation} from './target-health.js';
import {recoveryPreflightObservation} from './recovery-handoff.js';
import {genesisStageInputsMatch,genesisStageReceipt,genesisStageScope} from './genesis-stage-files.js';

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
const registeredServiceLabels = {node:'Node service',vpn:'VPN service','canary-rpc-relay':'Canary RPC relay service'};
const custodyPreparations = [
 {operation:'identity_generate',preflight:'identity_preflight',label:'Prepare existing-network identity',
  prompt:'Check existing-network inputs before preparing an identity.',parameters:identityGenerationInputs,observe:identityGenerationObservation},
 {operation:'formation_prepare',preflight:'formation_preflight',label:'Prepare formation identity',
  prompt:'Check formation inputs before preparing an identity.',parameters:formationPreparationInputs,observe:formationPreparationObservation},
];

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
 const [registrationReceipt,setRegistrationReceipt]=useState(null);
 const [formationReview,setFormationReview]=useState(null);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const key=JSON.stringify(target);
 const targetScope=`${key}:${permitted}`;
 const targetContext=useRef({scope:targetScope});
 if(targetContext.current.scope!==targetScope)targetContext.current={scope:targetScope};
 const identityScope=JSON.stringify([form.network_id,form.chain_id]);
 const identityContext=useRef({scope:identityScope});
 if(identityContext.current.scope!==identityScope)identityContext.current={scope:identityScope};
 const installScope=JSON.stringify([key,permitted,form.release_id,form.manifest_sha256,form.network_id,form.chain_id,form.node_name]);
 const installContext=useRef({scope:installScope});
 if(installContext.current.scope!==installScope)installContext.current={scope:installScope};
 const capabilities=useResource(async()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return targetControllerObservation(await nodeNetworkController(target,'target'));
 },targetScope);
 const state=capabilities.data;
 const preflight=installPreflightChecklist({form,target,permitted,capabilities,master,attempt:preflightAttempt,
  attemptCurrent:preflightAttempt?.context===installContext.current});
 const installGate=stagedInstallMutation(state);
 const canInstall=permitted&&installGate.available&&Boolean(preflight.reviewedParameters);
 const installResult=permitted&&result?.operation==='install'&&result.installContext===installContext.current?result:null;
 const statusGates=Object.fromEntries(Object.keys(typedStatus).map(operation=>[
  operation, ['uninstall_preflight','recovery_preflight'].includes(operation)?controllerRead(state,operation):installedControllerRead(state,operation),
 ]));
 const identityContextCurrent=!result?.identityContext||identityContext.current===result.identityContext;
 const statusResult=permitted&&identityContextCurrent&&statusGates[result?.operation]?.available?result:null;
 const healthResult=statusResult?.operation==='health'?statusResult:null;
 const recoveryResult=statusResult?.operation==='recovery_preflight'?statusResult:null;
 const vpnResult=permitted&&statusGates.vpn_status.available&&['vpn_status','vpn_enroll'].includes(result?.operation)?result:null;
 const enrollmentSupported=permitted&&vpnEnrollmentSupported(state);
 const enrollmentBlocker=vpnEnrollmentBlocker(vpnResult?.result);
 const startupBlocker=validatorStartupBlocker(vpnResult?.operation==='vpn_status'?vpnResult.result:null);
 const serviceGates=Object.fromEntries(nodeServiceActions.map(operation=>[operation,installedControllerMutation(state,operation)]));
 const registrationGate=installedControllerMutation(state,'register');
 const canRegister=permitted&&!capabilities.loading&&!capabilities.error&&registrationGate.available;
 const currentRegistration=permitted&&registrationReceipt?.context===targetContext.current?registrationReceipt:null;
 const resultIsPreparation=custodyPreparations.some(action=>action.operation===result?.operation);
 const preparedIdentity=permitted&&identityContextCurrent&&resultIsPreparation?result:null;
 const custodyResult=custodyStatusReads.some(read=>read.operation===statusResult?.operation)?statusResult:preparedIdentity;
 const bindingResult=permitted&&identityContextCurrent&&result?.operation==='genesis_bind'?result:null;
 const stageResult=permitted&&identityContextCurrent&&result?.operation==='genesis_stage'?result:null;
 const preparationResult=identityPreflightReads.some(read=>read.operation===statusResult?.operation)?statusResult:bindingResult??stageResult;
 const bindingReview=preparationResult?.operation==='genesis_binding_preflight'?preparationResult.result:null;
 const retainedFormation=permitted&&statusGates.formation_status.available&&formationReview?.context===identityContext.current
  ?formationReview.observation:null;
 const bindingInputs=genesisBindingInputs(bindingReview,retainedFormation,form);
 const bindingAvailable=installedControllerMutation(state,'genesis_bind').available;
 const stageAvailable=installedControllerMutation(state,'genesis_stage').available;
 const stagePolicy=preparationResult?.operation==='genesis_stage_preflight'?preparationResult.result:null;
 const stageScope=genesisStageScope(stagePolicy,retainedFormation,form);
 const preparationActions=custodyPreparations.map(action=>{
  const review=preparationResult?.operation===action.preflight?preparationResult.result:null;
  return {...action,review,inputs:action.parameters(review,form),available:installedControllerMutation(state,action.operation).available};
 });
 async function run(operation,parameters={}){
  const read=statusGates[operation];
  const isPreflight=operation==='install_preflight';
  const installsNode=operation==='install';
  const reviewedInstallContext=isPreflight||installsNode?installContext.current:null;
  const isEnrollment=operation==='vpn_enroll';
  const isServiceAction=nodeServiceActions.includes(operation);
  const registersServices=operation==='register';
  const registrationContext=registersServices?targetContext.current:null;
  const bindsGenesis=operation==='genesis_bind';
  const stagesGenesis=operation==='genesis_stage';
  const preparesCustody=preparationActions.find(action=>action.operation===operation);
  const reviewsCustody=Boolean(preparesCustody)||custodyPreparations.some(action=>action.preflight===operation)
   || bindsGenesis||stagesGenesis||['genesis_binding_preflight','genesis_stage_preflight','formation_status'].includes(operation);
  const reviewedIdentityContext=reviewsCustody?identityContext.current:null;
  const scopeSensitive=reviewedInstallContext||isEnrollment||isServiceAction||registersServices||reviewsCustody||['health','vpn_status','identity_status'].includes(operation);
  if(!permitted||busy||(read&&!read.available)||(isPreflight&&!preflight.canRun)||(installsNode&&!canInstall))return;
  if(isEnrollment&&(!enrollmentSupported||enrollmentBlocker||vpnResult?.operation!=='vpn_status'))return;
  if(isServiceAction&&(!serviceGates[operation].available||(operation!=='stop'&&startupBlocker)))return;
  if(registersServices&&!canRegister)return;
  if(preparesCustody&&(!preparesCustody.available||!preparesCustody.inputs))return;
  if(bindsGenesis&&(!bindingAvailable||!bindingInputs))return;
  if(stagesGenesis&&(!stageAvailable||!genesisStageInputsMatch(parameters,stageScope)))return;
  if(scopeSensitive&&!targetScopeCurrent()){
   setResult(null);setServiceAcknowledgement(null);setFormationReview(null);setPreflightAttempt(null);setRegistrationReceipt(null);
   setError('The target, recovery state or permission changed. Review the selected controller again.');
   return;
  }
  setBusy(true);setError('');
  if(!stagesGenesis)setResult(null);
  if(operation!=='health')setServiceAcknowledgement(null);
  if(!read&&!isPreflight)setRegistrationReceipt(null);
  if(operation==='formation_status'||(!read&&!isPreflight&&!stagesGenesis))setFormationReview(null);
  const submitted=stagesGenesis?{...stageScope,requestSha256:parameters.requestSha256}
   :bindsGenesis?bindingInputs:preparesCustody?preparesCustody.inputs:installsNode?preflight.reviewedParameters:registersServices?{}:{...parameters};
  const scopeCurrent=()=>alive.current&&(!scopeSensitive||targetScopeCurrent())
   &&(!reviewedIdentityContext||identityContext.current===reviewedIdentityContext)
   &&(!reviewedInstallContext||installContext.current===reviewedInstallContext)
   &&(!registrationContext||targetContext.current===registrationContext);
  setPreflightAttempt(isPreflight?{parameters:submitted,state:'pending',context:reviewedInstallContext}:null);
  try{
   const nativeBindingReview=bindsGenesis?{networkId:bindingReview.networkId,chainId:bindingReview.chainId,
    validatorAddress:bindingReview.validatorAddress}:undefined;
   const raw=stagesGenesis?await nodeNetworkStageGenesis(target,submitted):await nodeNetworkController(target,operation,submitted,nativeBindingReview);
   if(stagesGenesis&&raw===null)return;
   let response=raw;
   if(isPreflight)response=installPreflightObservation(raw,submitted,target);
   else if(installsNode)response=installationObservation(raw,submitted,target);
   else if(isEnrollment)response=vpnEnrollmentObservation(raw);
   else if(isServiceAction)response=nodeServiceActionObservation(operation,raw);
   else if(registersServices)response=nodeServiceRegistrationObservation(raw);
   else if(stagesGenesis)response=genesisStageReceipt(raw,stageScope);
   else if(bindsGenesis)response=genesisBindingObservation(raw,bindingReview);
   else if(preparesCustody)response=preparesCustody.observe(raw,preparesCustody.review);
   else if(read)response=typedStatus[operation](raw,submitted);
   if(scopeCurrent()){
    const receivedAt=Date.now();
    if(isPreflight)setPreflightAttempt({parameters:submitted,state:'received',receivedAt,observation:response,context:reviewedInstallContext});
    else if(isServiceAction)setServiceAcknowledgement({operation:response.requested,receivedAt});
    else if(registersServices)setRegistrationReceipt({result:response,receivedAt,context:registrationContext});
    else setResult({operation,submitted,result:response,receivedAt,identityContext:reviewedIdentityContext,installContext:reviewedInstallContext});
    if(operation==='formation_status'&&response.pending)setFormationReview({observation:response,context:reviewedIdentityContext});
    if(stagesGenesis)setFormationReview(null);
    if(!read&&!isPreflight)capabilities.reload();
   }
  }
  catch(failure){
   if(scopeCurrent()){
    if(isPreflight)setPreflightAttempt({parameters:submitted,state:'failed',context:reviewedInstallContext});
    if(stagesGenesis){setResult(null);setFormationReview(null);}
    setError(String(failure?.message||failure));
   }
  }
  finally{if(alive.current)setBusy(false);}
 }
 async function bootstrap(){
  if(!permitted||busy)return;
  setBusy(true);setError('');setResult(null);
  setPreflightAttempt(null);setFormationReview(null);setRegistrationReceipt(null);
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
   if(typedStatus[result?.operation]||['install','vpn_enroll','genesis_bind','genesis_stage'].includes(result?.operation)||resultIsPreparation)setResult(null);
   setPreflightAttempt(null);setServiceAcknowledgement(null);setFormationReview(null);setRegistrationReceipt(null);
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
    <div className="native-controller-action">
     <button disabled={busy||!canInstall} onClick={()=>run('install')}>Install approved node</button>
     {permitted&&!installGate.available&&<small>{installGate.blocker}</small>}
     {permitted&&installGate.available&&!preflight.reviewedParameters&&<small>Run installation preflight for the current draft before installing.</small>}
    </div>
    {installResult&&<section aria-label="Reported validator installation">
     <p>The selected controller reports installation completed for {installResult.result.node_name} on {installResult.result.network_id} (chain {installResult.result.chain_id}).</p>
     <ControllerReceipt receivedAt={installResult.receivedAt}/>
     <Detail data={{release:installResult.result.release_id,manifestSha256:installResult.result.manifest_sha256,declaredPackageMembers:installResult.result.declared_members}}/>
     <p>Custody, service registration and validator startup have separate controls.</p>
    </section>}
    {button('commission','Verify and commission provisioned custody')}
    <div className="native-controller-action">
     <button disabled={busy||!canRegister} onClick={()=>run('register')}>Register contained service</button>
     {permitted&&!registrationGate.available&&<small>{registrationGate.blocker}</small>}
    </div>
    {currentRegistration&&<section aria-label="Reported contained service registration">
     <ControllerReceipt receivedAt={currentRegistration.receivedAt}/>
     <ul>{currentRegistration.result.services.map(service=><li key={service}>{registeredServiceLabels[service]}</li>)}</ul>
     <p>Registration did not start services or enable them at boot. Read target health and VPN status separately.</p>
    </section>}
   </Card>
   <Card title="Lifecycle and monitoring">
    {statusAction('health','Read target health')}{serviceControls}
    {serviceEvidence}
    <p>Mutations require native operator confirmation and a matching one-time grant on the target. Software installation does not grant consensus membership.</p>
   </Card>
   <InstallPreflight checklist={preflight} action={
    <button disabled={busy||!preflight.canRun} onClick={()=>run('install_preflight',installParameters(form))}>Run installation preflight</button>
   }/>
   <IdentityPreflight permitted={permitted} canReviewFiles={targetScopeCurrent} busy={busy}
    stageScope={stageScope} onStage={permitted&&stageAvailable?review=>run('genesis_stage',review):null}
    actions={<>
     <div className="native-actions">{identityPreflightReads.map(({operation,label})=>statusAction(operation,label))}</div>
     {permitted&&preparationActions.some(action=>action.available)&&<>
      {preparationActions.filter(action=>action.available).map(({operation,label,inputs,review,prompt})=><div className="native-controller-action" key={operation}>
       <button disabled={busy||!inputs} onClick={()=>run(operation)}>{label}</button>
       {!inputs&&<small>{review?'The reviewed network or chain differs from the provisioning draft.':prompt}</small>}
      </div>)}
      <p>Native confirmation is required. Validator keys remain on the selected host.</p>
     </>}
     {permitted&&bindingAvailable&&<div className="native-controller-action">
      <button disabled={busy||!bindingInputs} onClick={()=>run('genesis_bind')}>Bind prepared identity to staged Genesis</button>
      {!bindingInputs&&!bindingResult&&<small>{bindingReview?.bound?'The controller already reports a Genesis binding.'
       : !retainedFormation?'Read formation custody status before requesting a binding.'
       : !bindingReview?'Review the staged Genesis binding for the prepared validator.'
       :'The unbound Genesis review must match the prepared validator and current draft.'}</small>}
     </div>}
    </>}
    observation={preparationResult?.result}
    bindingAcknowledged={Boolean(bindingResult)}
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
  {['Management','Validator setup'].includes(tab)&&<CustodyStatus
   actions={<div className="native-actions">{custodyStatusReads.map(({operation,label})=>statusAction(operation,label))}</div>}
   observation={custodyResult?.result}
   prepared={Boolean(preparedIdentity)}
   receipt={custodyResult&&<ControllerReceipt receivedAt={custodyResult.receivedAt}/>}
   onOpenHistory={onOpenDiagnostics}/>}
  {tab==='Updates'&&<ControllerUpdate form={form} target={target} permitted={permitted} busy={busy} controller={state} result={statusResult} run={run}/>}
  {tab==='Installation isolation'&&<ControllerRemoval target={target} permitted={permitted} busy={busy}
   controller={state} result={statusResult} run={run}
   inventoryAction={button('inventory','Inventory node-owned files')}
   preflightAction={statusAction('uninstall_preflight','Review uninstall scope')}/>}
  {busy&&<p role="status">Waiting for the target controller. Do not repeat the operation.</p>}
  <ErrorMessage error={error}/>{result&&!typedStatus[result.operation]&&!['install','vpn_enroll','genesis_bind','genesis_stage'].includes(result.operation)&&!resultIsPreparation&&<Card title={`Controller result · ${result.operation}`}><p>Response received {new Date(result.receivedAt).toISOString()}. This response is not a durable job record or proof of consensus readiness.</p><Detail data={{submittedOperation:result.operation,submittedPublicParameters:result.submitted}}/><p>These are the inputs submitted by this Portal view, not the current draft, a signed plan or authenticated target-state evidence. Native package/key selection remains part of the separate native review.</p><Detail data={result.result}/></Card>}
 </div>;
}
