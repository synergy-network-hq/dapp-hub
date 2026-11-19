import {runtimeProbeView} from './runtime-probe.js';
import {operatorAuthView,operatorAuthMessage} from './operator-auth.js';
import {ConsensusObservation} from './ConsensusObservation.jsx';
import {CurrentFleetConsensus} from './CurrentFleetConsensus.jsx';
import {GatewayAdmission} from './GatewayAdmission.jsx';
import {gatewayAdmissionView,gatewayCapability} from './gateway-admission.js';
import {GatewayTarget} from './GatewayTarget.jsx';
import {gatewayTargetView,gatewayTargetCapability,gatewayInstallView,gatewayInstallStatusView} from './gateway-target.js';
import {CustodyStatus} from './CustodyStatus.jsx';
import {IdentityPreflight} from './IdentityPreflight.jsx';
import {custodyStatusObservation} from './custody-status.js';
import {identityPreflightObservation,identityGenerationObservation} from './identity-preflight.js';
import {recoveryPreflightObservation} from './recovery-handoff.js';
import {targetHealthObservation,nodeServiceRegistrationObservation} from './target-health.js';
import {targetInventoryObservation} from './removal-preflight.js';
import {TargetInventoryEvidence} from './Offboarding.jsx';
import {VpnStatus} from './VpnStatus.jsx';
import {vpnStatusObservation} from './vpn-status.js';
import {bootstrapObservation} from './bootstrap-observation.js';
import {TreasurySend} from './TreasurySend.jsx';
import {TreasuryFormation} from './TreasuryFormation.jsx';
import {FleetReadiness} from './FleetReadiness.jsx';
import {GuestHosts} from './GuestHosts.jsx';
import {TransportFormation} from './TransportFormation.jsx';
import {useEffect,useRef,useState} from 'react';
import {nodeNetworkReconcileContinuation,nodeNetworkController,nodeNetworkBootstrap,exportNodeNetworkPublicArtifact,stageNodeNetworkSignedGenesis,stageNodeNetworkAuthorization,prepareNodeNetworkGenesis,exportNodeNetworkGenesis,stageNodeNetworkUpdate,nodeNetworkVpn,nodeNetworkGuest,rollbackBareNodeBootstrap,nodeNetworkSelectGuest,nodeNetworkConfigureGuest} from './native-services.js';
import {Card,Detail,ErrorMessage,Table} from '@synergy-network/portal-native/dapp-sdk';
import {bootPolicyParameters,bootPolicyView,bootPolicyStatusView,vpnStopView,vpnStopStatusView,vpnResumeView,vpnResumeStatusView,controllerDraftScope,retainedUpdateStageReceipt} from './operator-workflow.js';
import {formationView,formationStatusView,genesisBindingView,genesisStageView,existingGenesisStageView,publicExportView} from './formation-workflow.js';
import {networkFormationView} from './network-formation.js';
import {installParameters} from './nodeNetwork.js';
import {updateStageView,authorizationView,acceptedReview,approvedReviewScope,checkedTarget,diagnosticsView,identityStatusView,identityView,vpnView,vpnDiagnosticsView,unusedVpnCancellationView,workflowGate} from './operator-workflow.js';

const MUTATIONS=new Set(['gateway_install','gateway_target_generate','gateway_target_commission','gateway_admission_prepare','gateway_admission_sign','network_formation_prepare','network_formation_sign','authorization_stage','bootstrap','install','identity_generate','formation_prepare','genesis_stage','genesis_stage_existing','genesis_bind','commission','register','vpn_stop','vpn_resume','boot_policy','vpn_enroll','start','stop','restart','upgrade','uninstall']);
const PREFLIGHTS=new Set(['install_preflight','upgrade_preflight','uninstall_preflight']);
const LABELS={upgrade_native_preflight:'Verify candidate Linux origin and crypto smoke',gateway_install_status:'Verify original gateway installation',gateway_install_preflight:'Verify staged gateway software',gateway_install:'Install gateway software',gateway_target_preflight:'Verify signed gateway origin',gateway_target_status:'Read gateway custody',gateway_target_generate:'Generate fresh local gateway custody',gateway_target_export:'Read public gateway enrollment',gateway_target_commission:'Commission gateway custody',gateway_target_reconcile:'Reconcile original gateway request',gateway_admission_status:'Read gateway admission',gateway_admission_prepare:'Prepare exact gateway admission',gateway_admission_sign:'Sign exact gateway admission once',gateway_admission_export:'Read public gateway admission export',gateway_admission_reconcile:'Reconcile exact gateway request',boot_policy:'Change exact service boot policy',boot_policy_status:'Read or reconcile boot policy',bare_bootstrap_rollback:'Remove exact bare bootstrap',update_stage:'Select, approve and stage exact new master',network_formation_prepare:'Prepare unsigned engineering Genesis',network_formation_status:'Read or reconcile network formation',network_formation_sign:'Review and sign exact Genesis once',network_formation_export:'Export verified signed Genesis files',authorization_stage:'Stage exact approved formation authorization',authorization_status:'Read or reconcile staged authorization',target:'Inspect target',bootstrap:'Enroll clean host controller',install_preflight:'Verify staged installation',install:'Install approved node',identity_preflight:'Verify signed Genesis for custody',identity_generate:'Generate fresh APQE custody',identity_status:'Check pending APQE custody',formation_status:'Read or recover prepared identity',formation_preflight:'Review approved formation context',formation_prepare:'Prepare fresh APQE identity',formation_export:'Export public registration',genesis_stage:'Select signed Genesis authority folder',genesis_stage_existing:'Verify and stage existing network Genesis',genesis_binding_preflight:'Verify signed Genesis and identity',genesis_bind:'Bind existing identity to verified Genesis',bound_export:'Export bound public enrollment',commission:'Verify and commission custody',register:'Register services',vpn_enroll:'Enroll and start node VPN',vpn_resume:'Resume existing VPN only',vpn_resume_status:'Read or reconcile VPN resume',vpn_stop_status:'Read or reconcile VPN stop',vpn_stop:'Stop node VPN only',vpn_diagnostics:'Read VPN diagnostics',vpn_reconcile:'Reconcile original VPN enrollment',vpn_revoke:'Cancel exact provider setup key',vpn_cancel_unused:'Verify and cancel unused VPN attempt',vpn_retire:'Retire exact VPN peer',vpn_status:'Read VPN status',start:'Start validator',health:'Read target health',inventory:'Read installation inventory',diagnostics:'Read host diagnostics',stop:'Stop validator',restart:'Restart validator',recovery_preflight:'Check recovery readiness',upgrade_preflight:'Verify staged update',upgrade:'Apply approved update',uninstall_preflight:'Review removal scope',uninstall:'Remove installation'};

export function NodeController({target,form,setForm,permitted,tab,master,localSupported,onSelectTarget,onOpenDiagnostics,targetScopeCurrent=()=>permitted}){
 const [operator,setOperator]=useState('');
 const [state,setState]=useState(null),[pending,setPending]=useState(null),[error,setError]=useState(''),[results,setResults]=useState({}),[latest,setLatest]=useState(null),[review,setReview]=useState(null),[confirmation,setConfirmation]=useState('');
 const [networkReview,setNetworkReview]=useState(null);
 const [identityReview,setIdentityReview]=useState(null);
 const [formationReview,setFormationReview]=useState(null),[formationRecord,setFormationRecord]=useState(null),[bindingReview,setBindingReview]=useState(null);
 const active=useRef(true),locked=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const targetKey=JSON.stringify(target);
 const scopeKey=controllerDraftScope(targetKey,permitted,form);
 const stagedAdoption=useRef(null),resetScope=useRef(scopeKey);
 const scopeContext=useRef({key:scopeKey});
 if(scopeContext.current.key!==scopeKey)scopeContext.current={key:scopeKey};
 const isCurrent=scope=>active.current&&scope===scopeContext.current&&targetScopeCurrent();
 useEffect(()=>{const retained=retainedUpdateStageReceipt(stagedAdoption.current,resetScope.current,scopeKey);stagedAdoption.current=null;resetScope.current=scopeKey;setState(null);setResults({});setLatest(retained);setPending(null);setReview(null);setConfirmation('');setIdentityReview(null);setFormationReview(null);setFormationRecord(null);setBindingReview(null);locked.current=false;},[scopeKey]);
 useEffect(()=>{setNetworkReview(null);},[targetKey]);
 const gateFor=operation=>workflowGate({target,state,permitted,operation,form,review,confirmation,vpnStatus:results.vpn_status?.response,identityReview,formationReview,formationRecord,bindingReview,networkReview});

 async function perform(operation,parameterOverride){
  const scope=scopeContext.current;
  if(!permitted||locked.current)return;
  if(!targetScopeCurrent()){setError('The selected target scope changed. Inspect the original target before another operation.');return;}
  let parameters={};
  try{
   if(operation==='operator_auth_status'){
    if(target.kind!=='remote'||target.guest)throw Error('Select a physical remote target for local operator readiness.');
   }else if(operation==='authorization_stage'){
    if(!state||!operator||!(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(operator)))throw Error('Inspect the target and enter its existing administrative account.');
   }else if(operation==='bootstrap'){
    if(state||!operator||!(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(operator))||(target.kind==='local'&&!localSupported))throw Error('Select a supported clean host and enter its existing administrative account.');
    parameters=installParameters(form);
   }else if(operation.startsWith('gateway_target_')||operation==='gateway_install'||operation==='gateway_install_preflight'||operation==='gateway_install_status'){
    if(!gatewayTargetCapability(state,operation))throw Error('Inspect a current master with the qualified gateway target capability first.');
    parameters=parameterOverride??{};
   }else if(operation.startsWith('gateway_admission_')){
    if(!gatewayCapability(state,operation))throw Error('Inspect a current master with the qualified gateway admission capability first.');
    parameters=parameterOverride??{};
   }else if(operation!=='target'){
    const gate=gateFor(operation);if(!gate.available)throw Error(gate.blocker);
    parameters=operation==='boot_policy'?bootPolicyParameters(parameterOverride,target):gate.parameters;
   }
  }catch(failure){setError(failure.message);return;}
  locked.current=true;setPending(operation);setError('');setLatest(null);
  setResults(previous=>{if(operation==='target')return {};const next={...previous};delete next[operation];if(MUTATIONS.has(operation)){delete next.health;delete next.diagnostics;delete next.vpn_status;if(operation==='uninstall')return {};}return next;});
  if(operation==='target'||MUTATIONS.has(operation)||PREFLIGHTS.has(operation)){setReview(null);setConfirmation('');}
  if(operation==='target'||operation==='identity_preflight'||MUTATIONS.has(operation))setIdentityReview(null);
  if(operation==='formation_status'||operation==='formation_prepare'){setFormationRecord(null);setBindingReview(null);}
  if(operation==='formation_preflight'||operation==='formation_prepare')setFormationReview(null);
  if(operation==='genesis_stage'||operation==='genesis_binding_preflight'||operation==='genesis_bind')setBindingReview(null);
  if(operation==='target'||MUTATIONS.has(operation))setState(null);
  try{
   const raw=operation==='network_formation_prepare'?await prepareNodeNetworkGenesis(target,formationRecord.formation_sha256):operation==='authorization_stage'?await stageNodeNetworkAuthorization(target,operator):operation==='bootstrap'?await nodeNetworkBootstrap(target,operator,parameters):operation==='genesis_stage_existing'?await stageNodeNetworkSignedGenesis(target,`network:${form.chain_id}:${form.network_id}`):operation==='genesis_stage'?await stageNodeNetworkSignedGenesis(target,formationRecord.address):await nodeNetworkController(target,operation,parameters);
   if(!isCurrent(scope))return;
   if((operation==='bootstrap'||operation==='authorization_stage'||operation==='network_formation_prepare')&&raw===null){setError('Native review cancelled. No completed operation was reported.');return;}
   if((operation==='genesis_stage'||operation==='genesis_stage_existing')&&raw===null)return;
   if(operation==='target')setState(checkedTarget(raw,target));
   if(PREFLIGHTS.has(operation)){
    if(!acceptedReview(operation,parameters,raw,target))throw Error('The target did not return an affirmative result for this preflight. No matching review was recorded.');
    setReview({target:targetKey,scope:approvedReviewScope(operation,parameters)});
   }
   if(operation==='bootstrap')bootstrapObservation(raw,parameters);
   const response=operation==='upgrade_native_preflight'?runtimeProbeView(raw,parameters):operation==='operator_auth_status'?operatorAuthView(raw):operation==='gateway_install_status'?gatewayInstallStatusView(raw,parameters):operation.startsWith('gateway_target_')?await gatewayTargetView(raw,operation,parameters):operation==='gateway_install'||operation==='gateway_install_preflight'?gatewayInstallView(raw,operation,parameters):operation.startsWith('gateway_admission_')?gatewayAdmissionView(raw,operation,parameters):operation.startsWith('network_formation_')?networkFormationView(raw,operation==='network_formation_sign'?networkReview:null):operation==='authorization_stage'||operation==='authorization_status'?authorizationView(raw):operation==='diagnostics'?diagnosticsView(raw):operation==='boot_policy'?bootPolicyView(raw,parameters):operation==='boot_policy_status'?bootPolicyStatusView(raw):operation==='vpn_resume'?vpnResumeView(raw):operation==='vpn_resume_status'?vpnResumeStatusView(raw):operation==='vpn_stop_status'?vpnStopStatusView(raw):operation==='vpn_stop'?vpnStopView(raw):operation==='vpn_diagnostics'?vpnDiagnosticsView(raw):(operation==='vpn_status'||operation==='vpn_enroll')?vpnView(raw):
    operation==='identity_status'?identityStatusView(raw):
    operation==='identity_preflight'||operation==='identity_generate'?identityView(raw,operation==='identity_generate'):
    operation==='formation_preflight'?formationView(raw):
    operation==='formation_prepare'?formationView(raw,true):
    operation==='formation_status'?formationStatusView(raw):
    operation==='genesis_stage_existing'?existingGenesisStageView(raw,form):operation==='genesis_stage'?genesisStageView(raw,formationRecord):
    operation==='genesis_binding_preflight'||operation==='genesis_bind'?genesisBindingView(raw,formationRecord,parameters.genesis_sha256??null):raw;
   const evidence=operation==='health'?targetHealthObservation(raw):operation==='inventory'?targetInventoryObservation(raw):operation==='vpn_status'?vpnStatusObservation(raw):operation==='register'?nodeServiceRegistrationObservation(raw):operation==='identity_generate'?identityGenerationObservation(raw,{networkId:identityReview?.network_id,chainId:identityReview?.chain_id,genesisSha256:identityReview?.genesis_sha256}):['identity_status','formation_status'].includes(operation)?custodyStatusObservation(operation,raw):['genesis_binding_preflight','genesis_bind'].includes(operation)?{title:'Staged Genesis binding',networkId:response.network_id,chainId:response.chain_id,validatorAddress:response.address,genesisSha256:response.genesis_sha256,bound:response.bound,stageReceiptVerified:typeof raw.stage_request_sha256==='string'&&/^[0-9a-f]{64}$/.test(raw.stage_request_sha256)}:['identity_preflight','formation_preflight','genesis_stage_preflight'].includes(operation)?identityPreflightObservation(operation,raw):operation==='recovery_preflight'?recoveryPreflightObservation(raw):null;
   if(operation.startsWith('network_formation_'))setNetworkReview({target:targetKey,...response});
   if(operation==='identity_preflight')setIdentityReview({target:targetKey,...response});
   if(operation==='formation_preflight')setFormationReview({target:targetKey,...response});
   if(operation==='formation_prepare'||operation==='formation_status'){
    if(operation==='formation_prepare'&&(!formationReview||response.formation_sha256!==parameters.formation_sha256||response.network_id!==formationReview.network_id||response.chain_id!==formationReview.chain_id||response.formation_id!==formationReview.formation_id))throw Error('The prepared identity did not match the reviewed formation.');
    setFormationRecord(response);
   }
   if(operation==='genesis_binding_preflight'||operation==='genesis_bind')setBindingReview({target:targetKey,...response});

   const record={operation,parameters,response,evidence,receivedAt:Date.now()};
   setResults(previous=>{const next={...previous,[operation]:record};if(operation==='vpn_stop'||operation==='vpn_resume'){delete next.vpn_status;delete next.vpn_diagnostics;}if(operation==='boot_policy')delete next.boot_policy_status;return next;});setLatest(record);
  }catch(failure){if(isCurrent(scope))setError(`${String(failure?.message||failure)}${MUTATIONS.has(operation)?' Inspect the target to reconcile its state before repeating this operation.':''}`);}
  finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 async function nativeVpn(operation){
  const scope=scopeContext.current;
  if(!permitted||locked.current)return;
  locked.current=true;setPending(`vpn_${operation}`);setError('');
  try{const value=await nodeNetworkVpn(target,operation);if(!isCurrent(scope)||value===null)return;
   if(operation==='retire'){if(value.retired!==true||value.absence_verified!==true)throw Error('Provider retirement was not verified.');setLatest({operation:'vpn_retire',parameters:{},response:value,receivedAt:Date.now()});}
   else if(operation==='revoke'){if(value.setup_key_absent!==true)throw Error('Provider did not verify setup-key absence.');setLatest({operation:'vpn_revoke',parameters:{},response:{setup_key_absent:true},receivedAt:Date.now()});}
   else if(operation==='cancel_unused'){const response=unusedVpnCancellationView(value);setResults(old=>{const next={...old};delete next.vpn_status;return next;});setLatest({operation:'vpn_cancel_unused',parameters:{},response,receivedAt:Date.now()});}
   else{const response=vpnView(value),evidence=vpnStatusObservation(value);setResults(old=>({...old,vpn_status:{operation:'vpn_status',response,evidence,receivedAt:Date.now()}}));setLatest({operation:`vpn_${operation}`,parameters:{},response,receivedAt:Date.now()});}
   setState(null);
  }catch(failure){if(isCurrent(scope))setError(`${String(failure?.message||failure)} Reconcile the original intent; do not issue another setup key.`);}
  finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 async function reconcileContinuation(){
  const scope=scopeContext.current;
  if(!permitted||locked.current||!state)return;
  locked.current=true;setPending('continuation_not_applied');setError('');
  try{const response=await nodeNetworkReconcileContinuation(target);if(!isCurrent(scope)||response===null)return;
   setState(null);setResults({});setReview(null);setIdentityReview(null);setFormationReview(null);setBindingReview(null);
   setLatest({operation:'continuation_not_applied',parameters:{},response,receivedAt:Date.now()});
  }catch(failure){if(isCurrent(scope))setError(`${String(failure?.message||failure)} Pending intent remains fenced; no operation was retried.`);}
  finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 async function rollbackBare(){
  const scope=scopeContext.current;
  if(!permitted||locked.current||!operator)return;
  locked.current=true;setPending('bare_bootstrap_rollback');setError('');
  try{const value=await rollbackBareNodeBootstrap(target,operator,form.release_id);if(!isCurrent(scope)||value===null)return;setState(null);setLatest({operation:'bare_bootstrap_rollback',parameters:{},response:value,receivedAt:Date.now()});}
  catch(failure){if(isCurrent(scope))setError(`${String(failure?.message||failure)} Do not repeat removal after an uncertain result.`);}
  finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 async function stageUpdate(){
  const scope=scopeContext.current;
  if(!permitted||!state||locked.current)return;
  locked.current=true;setPending('update_stage');setError('');setReview(null);
  try{const value=await stageNodeNetworkUpdate(target);if(!isCurrent(scope)||value===null)return;const response=updateStageView(value);const record={operation:'update_stage',parameters:{},response,receivedAt:Date.now()};const adopted={...form,release_id:response.release_id,manifest_sha256:response.manifest_sha256};stagedAdoption.current={fromScope:scope.key,toScope:controllerDraftScope(targetKey,permitted,adopted),record};setForm(current=>controllerDraftScope(targetKey,permitted,current)===scope.key?{...current,release_id:response.release_id,manifest_sha256:response.manifest_sha256}:current);setState(null);setLatest(record);}
  catch(failure){if(isCurrent(scope))setError(`${String(failure?.message||failure)} Read authorization status to reconcile before repeating.`);}
  finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 async function exportPublic(kind){
  const scope=scopeContext.current;
  const address=formationRecord?.address;
  const operation=kind==='formation'?'formation_export':'bound_export';
  if(!permitted||!address||locked.current||(kind==='formation'?!gateFor(operation).available:!bindingReview?.bound))return;
  locked.current=true;setPending(operation);setError('');setLatest(null);
  try{
   const response=publicExportView(await exportNodeNetworkPublicArtifact(target,kind,address,kind==='formation'?formationRecord.formation_sha256:bindingReview.genesis_sha256),address);
   if(isCurrent(scope)&&response)setLatest({operation,parameters:{},response,receivedAt:Date.now()});
  }catch(failure){if(isCurrent(scope))setError(String(failure?.message||failure));}
  finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 async function exportNetwork(){
  const scope=scopeContext.current;
  if(!permitted||locked.current||!networkReview?.signed||networkReview.target!==targetKey)return;
  locked.current=true;setPending('network_formation_export');setError('');
  try{const response=await exportNodeNetworkGenesis(target,networkReview.review_sha256);if(isCurrent(scope)&&response)setLatest({operation:'network_formation_export',parameters:{},response,receivedAt:Date.now()});}
  catch(failure){if(isCurrent(scope))setError(String(failure?.message||failure));}finally{if(isCurrent(scope)){locked.current=false;setPending(null);}}
 }
 function action(operation){
  const gate=gateFor(operation);
  return <div className="native-controller-action" key={operation}><button type="button" disabled={!!pending||!gate.available} onClick={()=>perform(operation)}>{LABELS[operation]}</button>{!gate.available&&<small>{gate.blocker}</small>}</div>;
 }
 const field=(key,label)=><label key={key}>{label}<input value={form[key]} maxLength={128} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={!!pending} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>;
 const sample=results.diagnostics?.response;
 const setup=['install_preflight','install'];
 const vpn=results.vpn_status?.response;
 const exportRegistration=gateFor('formation_export');
 const newest=operations=>operations.map(op=>results[op]).filter(Boolean).sort((a,b)=>b.receivedAt-a.receivedAt)[0];
 const custody=newest(['identity_status','formation_status','identity_generate']);
 const preparation=newest(['identity_preflight','formation_preflight','genesis_binding_preflight','genesis_bind','genesis_stage_preflight']);
 return <div className="native-controller">
  <Card title="Selected target" action={<button type="button" disabled={!permitted||!!pending} onClick={()=>perform('target')}>{LABELS.target}</button>}>
   <p>{target.kind==='local'?'This machine':`${target.host}:${target.port||22}`} · {target.root}</p>
   {target.kind==='remote'&&!target.guest&&<button type="button" disabled={!permitted||!!pending} onClick={()=>perform('operator_auth_status')}>Read local operator authentication</button>}
   {results.operator_auth_status&&<p>{operatorAuthMessage(results.operator_auth_status.response)}</p>}
   {state?<Detail data={{platform:state.platform,architecture:state.architecture,installed:state.installed,controllerVersion:state.controllerVersion,communityEnrollment:state.communityEnrollment}}/>:<p>{permitted?'Inspect the enrolled controller to see which operations are available.':'Allow NodeNetwork inspection in Security & permissions.'}</p>}
  </Card>
  {tab==='Validator setup'&&<div className="native-grid">
   <Card title="2. Enroll a clean host, or resume on an enrolled host">
    <p>Inspect an existing controller first. For a clean host, native review verifies the selected package, SSH host key and public operator key. Enrollment stages the release; it does not grant installation, consensus membership or activation.</p>
    {master&&<button type="button" disabled={!!pending} onClick={()=>setForm({...form,release_id:master.release,manifest_sha256:master.manifestSha256})}>Copy inspected release reference into draft</button>}
    <label>Existing administrative account<input value={operator} maxLength={32} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={!!pending} onChange={event=>setOperator(event.target.value)}/></label>
    <button type="button" disabled={!permitted||!!pending||!!state||!operator||(target.kind==='local'&&!localSupported)} onClick={()=>perform('bootstrap')}>{LABELS.bootstrap}</button>
    <p>For an independently approved isolated engineering target only: review removal of a completed bare bootstrap before retrying setup with a corrected master. A separately compiled original authorization may be removed only while its initial formation grants remain entirely unused. Installed software, custody, VPN, consumed grants, continuations or runtime state make this operation refuse.</p>
    <button type="button" disabled={!permitted||!!pending||!operator||!form.release_id} onClick={rollbackBare}>Review exact bare bootstrap removal</button>
   </Card>
   <Card title="3. Review exact engineering formation authorization">
    <p>The isolated native build independently pins up to five exact initial host authorization documents. Select the matching document and fixed-name inputs through native review. Later native-confirmed operations can use short-lived one-request continuations bound to that same target, master and formation. This does not approve production, membership or stake.</p>
    <button type="button" disabled={!permitted||!!pending||!state||!operator} onClick={()=>perform('authorization_stage')}>{LABELS.authorization_stage}</button>
    {action('authorization_status')}
    <button type="button" disabled={!permitted||!!pending||!state} onClick={reconcileContinuation}>Verify pending continuation not applied</button>
    <p>This read-only native review releases only an exact unapplied local continuation. It never reports operation success or retries a mutation. Inspect again before a separate next action.</p>
    <p>After an interrupted result, read the target authorization receipt. No grant is recreated and no operation is replayed. A different initial host authorization requires a separately reviewed native build pin. A confirmed continuation never regenerates custody or replays an uncertain operation.</p>
   </Card>
   <Card title="4. Install the approved validator software">
    <p>Inspect the target after each change. Software installation does not commission a validator or start consensus.</p>
    {setup.map(action)}
   </Card>
   <Card title="Join an existing network">
    <p>Verify the network’s signed Genesis, then generate a fresh identity on this host. Custody preparation does not enroll the VPN or authorize consensus.</p>
    {['genesis_stage_existing','identity_generate'].map(action)}
    {identityReview&&<Detail data={{network:identityReview.network_id,chainId:identityReview.chain_id,verifiedGenesisSha256:identityReview.genesis_sha256}}/>}
   </Card>
   <Card title="Stage A · Prepare a validator before Genesis">
    <p>Read the authenticated host first. Preparation generates independent APQE keys on the selected host and keeps private material there. It does not sign Genesis or grant validator membership.</p>

    {formationReview&&<Detail data={{network:formationReview.network_id,chainId:formationReview.chain_id,formationId:formationReview.formation_id,reviewedFormationSha256:formationReview.formation_sha256}}/>}
    {action('formation_prepare')}
    <p role="status">{formationRecord?.pending===true?'Identity generated and verified · Public registration ready to export':formationRecord?.pending===false?'No prepared identity on this target':'Formation status not verified'}</p>
    {formationRecord?.pending&&<Detail data={{address:formationRecord.address,formationId:formationRecord.formation_id}}/>}
    <button type="button" disabled={!!pending||!exportRegistration.available} onClick={()=>exportPublic('formation')}>{LABELS.formation_export}</button>
    <p>After an interrupted response, inspect and read formation status to recover the same identity. Do not prepare another one.</p>
   </Card>
   <ConsensusObservation target={target} disabled={!permitted||!state||!!pending}/>
   <TreasurySend target={target} disabled={!permitted||!state||!!pending}/>
   <TreasuryFormation target={target} disabled={!permitted||!state||!!pending} onMutation={()=>setState(null)}/>
   <Card title="Create fresh engineering Genesis from five prepared validators">
    <p>On the selected formation coordinator, choose recipe.json and registration-1.json through registration-5.json in one public input folder. The native master verifies each APQE possession proof and exact formation membership. New encrypted authority custody remains inside this managed root.</p>
    {action('network_formation_status')}{action('network_formation_prepare')}
    {networkReview?.pending&&<Detail data={networkReview}/>}
    <p>Preparation is unsigned. Signing requires a separate native review and exact host authorization; it does not authorize production, prove stake or start any validator.</p>
    {action('network_formation_sign')}
    <button type="button" disabled={!!pending||!permitted||!networkReview?.signed||networkReview.target!==targetKey} onClick={exportNetwork}>{LABELS.network_formation_export}</button>
    <p>Export only the verified signed public files, then independently review their exact hashes for Stage B on each validator. After an interrupted operation, read network formation status; do not regenerate custody or repeat signing.</p>
   </Card>
   <Card title="Stage B · Verify signed Genesis and bind custody">
    <p>For a freshly created engineering network, Portal re-verifies the original approved formation coordinator and its exact saved signed public export. Otherwise, select the independently signed Genesis, authority manifest and public key folder. Portal checks the target’s pinned hashes before sending the files. Verify the staged result before binding custody.</p>
    {action('genesis_stage')}
    {bindingReview&&<Detail data={{network:bindingReview.network_id,chainId:bindingReview.chain_id,address:bindingReview.address,verifiedGenesisSha256:bindingReview.genesis_sha256}}/>}
    <p role="status">{bindingReview?.bound===true?'Existing custody bound to the verified Genesis':bindingReview?'Genesis and signed membership verified · Custody not yet bound':'Genesis authorization pending verification'}</p>
    {action('genesis_bind')}
    <button type="button" disabled={!!pending||!permitted||!bindingReview?.bound} onClick={()=>exportPublic('bound')}>{LABELS.bound_export}</button>
    <p>Bound public enrollment can be used by the independent transport registry signer. No private key is exported. Signed membership does not prove the required 50,000 SNRG stake, runtime admission or participation.</p>
   </Card>
   <Card title="4. Connect VPN, commission and verify runtime">
  {!target.guest&&<GuestHosts invokeConfigureGuest={nodeNetworkConfigureGuest} onSelectGuest={async(host,id)=>{const selected=await nodeNetworkSelectGuest(host,id);if(selected&&onSelectTarget)onSelectTarget(selected);return selected;}} target={target} disabled={!permitted||!state||!!pending} invokeGuest={nodeNetworkGuest} onMutation={()=>setState(null)}/>}
   {target.guest&&<Card title="Managed guest target"><Detail data={{physicalHost:target.host,guest:target.guest.guest_id,creationRequest:target.guest.create_request_sha256}}/><p>SSH is routed through the authenticated hosting machine. Guest administration uses its approved synergy account.</p><button type="button" disabled={!!pending} onClick={()=>{const physical={...target};delete physical.guest;onSelectTarget?.(physical);}}>Return to hosting machine</button></Card>}
     <FleetReadiness target={target} disabled={!permitted||!state||!!pending} onMutation={()=>setState(null)}/>
     <TransportFormation target={target} disabled={!permitted||!state||!!pending} onMutation={()=>setState(null)}/>
    <p>{vpn?.connected&&vpn?.server_bound?'VPN connected and server binding observed':vpn?'VPN enrollment or connection pending':'VPN status not verified'}</p>
    {['register','vpn_stop','vpn_resume','vpn_stop_status','vpn_resume_status','vpn_diagnostics','commission','start','health'].map(action)}
    {['enroll','reconcile','revoke','cancel_unused','retire'].map(op=><button key={op} type="button" disabled={!permitted||!!pending} onClick={()=>nativeVpn(op)}>{op==='enroll'?'Authorize provider and enroll VPN once':op==='reconcile'?'Reconcile and verify original VPN enrollment':op==='retire'?'Retire exact VPN peer for removal':op==='cancel_unused'?'Verify and cancel unused VPN attempt':'Cancel exact provider setup key'}</button>)}
    <p>An unused attempt can be cancelled only after the provider and target verify that it never enrolled. Cancellation does not enroll the node. A new attempt requires a separate native confirmation.</p>
    <p>{results.commission?.response?.commissioned===true?'Commissioning confirmed by the target.':'Validator commissioning not verified.'} A start response does not establish running, admitted, participating, synchronized or healthy status. Verify runtime evidence independently.</p>
   </Card>
  </div>}
  {tab==='Management'&&<Card title="Node lifecycle and diagnostics">
   <button type="button" disabled={!permitted||!!pending||!state} onClick={reconcileContinuation}>Verify pending continuation not applied</button>
   {['authorization_status','health','vpn_stop','vpn_resume','vpn_stop_status','vpn_resume_status','vpn_diagnostics','diagnostics','inventory','start','stop','restart','recovery_preflight'].map(action)}
   <p>Use health to verify the result after a start or restart. Recovery remains a separately qualified operation. This workspace does not offer arbitrary shell or checkpoint access.</p>
  </Card>}
  {(tab==='Setup'||tab==='Management')&&<GatewayTarget key={scopeKey} state={state} form={form} disabled={!permitted||!!pending} pending={pending} results={results} perform={perform}/>}
  {tab==='Management'&&<GatewayAdmission key={scopeKey} state={state} disabled={!permitted||!!pending} pending={pending} results={results} perform={perform}/>}
  {tab==='Management'&&<CurrentFleetConsensus disabled={!permitted||!!pending}/>}
  {tab==='Management'&&state?.operations?.some(row=>row.operation==='boot_policy_status'&&row.kind==='read')&&<Card title="Explicit service boot policy">
   <p>Change one attributed service at a time. This never starts or stops a service now. Enabling validator boot also starts its existing VPN dependency at boot, even when VPN's own boot link is disabled. Managed guest boot enablement is unavailable.</p>
   {action('boot_policy_status')}
   {results.boot_policy_status?<Detail data={{nodeBootEnabled:results.boot_policy_status.response.node_enabled,vpnBootEnabled:results.boot_policy_status.response.vpn_enabled,exactAuditedChangeObserved:results.boot_policy_status.response.applied}}/>:<p>Current boot policy has not been observed.</p>}
   {['node','vpn'].map(service=><div className="button-row" key={service}>
    {!target.guest&&<button type="button" disabled={!!pending||!gateFor('boot_policy').available} onClick={()=>perform('boot_policy',{service,enabled:true})}>Enable {service==='node'?'validator':'VPN'} at boot</button>}
    <button type="button" disabled={!!pending||!gateFor('boot_policy').available} onClick={()=>perform('boot_policy',{service,enabled:false})}>Disable {service==='node'?'validator':'VPN'} at boot</button>
   </div>)}
   <p>After a lost reply, read boot policy status to reconcile the original exact request before another change.</p>
  </Card>}
  {tab==='Validator setup'&&<IdentityPreflight actions={<>{['identity_preflight','formation_preflight','genesis_binding_preflight'].map(action)}</>}
   bindingAcknowledged={preparation?.operation==='genesis_bind'} observation={preparation?.evidence} receipt={preparation&&<ControllerReceipt receivedAt={preparation.receivedAt}/>}
   permitted={permitted} busy={!!pending} canReviewFiles={()=>permitted&&targetScopeCurrent()}/>}
  {['Validator setup','Management'].includes(tab)&&<CustodyStatus actions={<>{['identity_status','formation_status'].map(action)}</>}
   prepared={custody?.operation==='identity_generate'} observation={custody?.evidence} receipt={custody&&<ControllerReceipt receivedAt={custody.receivedAt}/>}/>}
  {tab==='Management'&&results.recovery_preflight?.evidence&&<Card title="Recovery readiness"><section aria-label="Recovery preflight evidence">
   <ControllerReceipt receivedAt={results.recovery_preflight.receivedAt}/><p>Checkpoint import is not qualified. The controller reported no change to certified state.</p>
  </section></Card>}
  {['Validator setup','Management'].includes(tab)&&<VpnStatus action={action('vpn_status')}
   observation={results.vpn_status?.evidence}
   receipt={results.vpn_status&&<ControllerReceipt receivedAt={results.vpn_status.receivedAt}/>}
   onOpenDiagnostics={onOpenDiagnostics}/>}
  {['Validator setup','Management'].includes(tab)&&results.register?.evidence&&<Card title="Reported contained service registration">
   <ControllerReceipt receivedAt={results.register.receivedAt}/>
   <ul>{results.register.evidence.services.map(service=><li key={service}>{{node:'Node service',vpn:'VPN service','canary-rpc-relay':'Canary RPC relay service'}[service]}</li>)}</ul>
   <p>Registration did not start services or enable them at boot. Read target health and VPN status separately.</p>
  </Card>}
  {['Validator setup','Management'].includes(tab)&&results.health?.evidence&&<Card title="Reported service health">
   <ControllerReceipt receivedAt={results.health.receivedAt}/>
   <Table columns={[{key:'id',label:'Service'},{key:'state',label:'Lifecycle'},{key:'health',label:'Health'},{key:'readiness',label:'Service readiness'}]}
    rows={results.health.evidence} empty="The controller returned no service observations."/>
   <p>Consensus not observed. This service-health response supplies no authenticated roster, online peer count, quorum or cluster assignment; service readiness does not establish consensus participation.</p>
  </Card>}
  {['Management','Installation isolation'].includes(tab)&&results.inventory?.evidence&&<Card title="Node inventory">
   <TargetInventoryEvidence report={{result:results.inventory.evidence,receivedAt:results.inventory.receivedAt}}/>
  </Card>}
  {tab==='Updates'&&<Card title="Controlled master update">
   <p>Stop the validator through Management, then inspect the authenticated target. Native review selects the new master folder and verifies its entire inventory. Only an explicitly confirmed isolated engineering target can adopt new software; production approval remains separate.</p>
   <button type="button" disabled={!permitted||!!pending||!state} onClick={stageUpdate}>{LABELS.update_stage}</button>
   {action('authorization_status')}
   {field('release_id','Approved release ID')}{field('manifest_sha256','Approved manifest SHA-256')}
   <p>The controller verifies the master staged on the target. Review the exact release before applying it. Check target state before starting or retrying an update.</p>
   {state?.operations?.some(row=>row.operation==='upgrade_native_preflight'&&row.kind==='read'&&row.available===true)&&<>{action('upgrade_native_preflight')}<p>Authenticated candidate Linux origin and crypto smoke only. KEM, sessions, consensus and production are not qualified. This read does not approve an upgrade.</p></>}
   {action('upgrade_preflight')}{action('upgrade')}
  </Card>}
  {tab==='Installation isolation'&&<Card title="Containment and removal">
   {action('inventory')}{action('uninstall_preflight')}
   <p>Removal destroys node custody, signing-safety records and chain data. Review the exact scope and preserve required material using an approved procedure first.</p>
   <label>Confirm destructive root<input autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={confirmation} disabled={!!pending} onChange={event=>setConfirmation(event.target.value)} placeholder={target.root}/></label>
   {action('uninstall')}
  </Card>}
  {(tab==='Performance'||tab==='Logs')&&<Card title={tab==='Performance'?'Target resource sample':'Bounded node log summary'} action={action('diagnostics')}>
   {!sample?<p>Read the authenticated controller for a current sample. Missing fields are not measurements.</p>:<>
    <p>Observed {new Date(sample.observedAt).toISOString()}. This is a point-in-time sample.</p>
    {tab==='Performance'?<Detail data={{services:sample.services,storage:sample.storage}}/>:sample.log?<Detail data={sample.log}/>:<p>No log summary was available.</p>}
   </>}
   {tab==='Logs'&&<p>Only aggregate counts from the bounded window are shown. Raw log messages are unavailable.</p>}
  </Card>}
  {pending&&<p role="status">{LABELS[pending]}: waiting for native review or the target controller. Do not repeat the operation.</p>}
  <ErrorMessage error={error}/>
  {latest&&!['target','health','inventory','vpn_status','register','identity_status','formation_status','identity_preflight','formation_preflight','genesis_binding_preflight','genesis_bind','identity_generate','genesis_stage_preflight','recovery_preflight'].includes(latest.operation)&&(!(tab==='Performance'||tab==='Logs')||latest.operation!=='diagnostics')&&<Card title={`Controller result · ${LABELS[latest.operation]}`}>
   <p>Received {new Date(latest.receivedAt).toISOString()} from the selected target. This response is not a durable job record or proof of consensus readiness.</p>
   {!!Object.keys(latest.parameters).length&&!latest.operation.startsWith('gateway_admission_')&&!latest.operation.startsWith('gateway_target_')&&<Detail data={{submittedPublicParameters:latest.parameters}}/>}<Detail data={latest.response}/>
  </Card>}
 </div>;
}

function ControllerReceipt({receivedAt}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[receivedAt]);
 return <p role="status">Source: native target controller · Response received {new Date(receivedAt).toISOString()} · {now-receivedAt>=60000?'Older than one minute':'Read within the past minute'}</p>;
}
