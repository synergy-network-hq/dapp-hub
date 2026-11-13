import {useEffect,useRef,useState} from 'react';
import {nodeNetworkController,nodeNetworkBootstrap,exportNodeNetworkPublicArtifact,stageNodeNetworkSignedGenesis} from './native-services.js';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {formationView,formationStatusView,genesisBindingView,genesisStageView,publicExportView} from './formation-workflow.js';
import {installParameters} from './nodeNetwork.js';
import {acceptedReview,approvedReviewScope,checkedTarget,diagnosticsView,identityStatusView,identityView,vpnView,workflowGate} from './operator-workflow.js';

const MUTATIONS=new Set(['bootstrap','install','identity_generate','formation_prepare','genesis_stage','genesis_bind','commission','register','vpn_enroll','start','stop','restart','upgrade','uninstall']);
const PREFLIGHTS=new Set(['install_preflight','upgrade_preflight','uninstall_preflight']);
const LABELS={target:'Inspect target',bootstrap:'Enroll clean host controller',install_preflight:'Verify staged installation',install:'Install approved node',identity_preflight:'Verify signed Genesis for custody',identity_generate:'Generate fresh APQE custody',identity_status:'Check pending APQE custody',formation_status:'Read or recover prepared identity',formation_preflight:'Review approved formation context',formation_prepare:'Prepare fresh APQE identity',formation_export:'Export public registration',genesis_stage:'Select signed Genesis authority folder',genesis_binding_preflight:'Verify signed Genesis and identity',genesis_bind:'Bind existing identity to verified Genesis',bound_export:'Export bound public enrollment',commission:'Verify and commission custody',register:'Register services',vpn_enroll:'Enroll and start node VPN',vpn_status:'Read VPN status',start:'Start validator',health:'Read node health',inventory:'Read installation inventory',diagnostics:'Read host diagnostics',stop:'Stop validator',restart:'Restart validator',recovery_preflight:'Check recovery readiness',upgrade_preflight:'Verify staged update',upgrade:'Apply approved update',uninstall_preflight:'Review removal scope',uninstall:'Remove installation'};

export function NodeController({target,form,setForm,permitted,tab,master,localSupported}){
 const [operator,setOperator]=useState('');
 const [state,setState]=useState(null),[pending,setPending]=useState(null),[error,setError]=useState(''),[results,setResults]=useState({}),[latest,setLatest]=useState(null),[review,setReview]=useState(null),[confirmation,setConfirmation]=useState('');
 const [identityReview,setIdentityReview]=useState(null);
 const [formationReview,setFormationReview]=useState(null),[formationRecord,setFormationRecord]=useState(null),[bindingReview,setBindingReview]=useState(null);
 const active=useRef(true),locked=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const targetKey=JSON.stringify(target);
 const gateFor=operation=>workflowGate({target,state,permitted,operation,form,review,confirmation,vpnStatus:results.vpn_status?.response,identityReview,formationReview,formationRecord,bindingReview});

 async function perform(operation){
  if(!permitted||locked.current)return;
  let parameters={};
  try{
   if(operation==='bootstrap'){
    if(state||!operator||!(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(operator))||(target.kind==='local'&&!localSupported))throw Error('Select a supported clean host and enter its existing administrative account.');
    parameters=installParameters(form);
   }else if(operation!=='target'){
    const gate=gateFor(operation);if(!gate.available)throw Error(gate.blocker);
    parameters=gate.parameters;
   }
  }catch(failure){setError(failure.message);return;}
  locked.current=true;setPending(operation);setError('');setLatest(null);
  setResults(previous=>{const next={...previous};delete next[operation];if(MUTATIONS.has(operation)){delete next.health;delete next.diagnostics;delete next.vpn_status;if(operation==='uninstall')return {};}return next;});
  if(operation==='target'||MUTATIONS.has(operation)||PREFLIGHTS.has(operation)){setReview(null);setConfirmation('');}
  if(operation==='target'||operation==='identity_preflight'||MUTATIONS.has(operation))setIdentityReview(null);
  if(operation==='formation_status'||operation==='formation_prepare'){setFormationRecord(null);setBindingReview(null);}
  if(operation==='formation_preflight'||operation==='formation_prepare')setFormationReview(null);
  if(operation==='genesis_stage'||operation==='genesis_binding_preflight'||operation==='genesis_bind')setBindingReview(null);
  if(operation==='target'||MUTATIONS.has(operation))setState(null);
  try{
   const raw=operation==='bootstrap'?await nodeNetworkBootstrap(target,operator,parameters):operation==='genesis_stage'?await stageNodeNetworkSignedGenesis(target,formationRecord.address):await nodeNetworkController(target,operation,parameters);
   if(!active.current)return;
   if(operation==='bootstrap'&&raw===null){setError('Native review cancelled. No completed operation was reported.');return;}
   if(operation==='genesis_stage'&&raw===null)return;
   if(operation==='target')setState(checkedTarget(raw,target));
   if(PREFLIGHTS.has(operation)){
    if(!acceptedReview(operation,parameters,raw,target))throw Error('The target did not return an affirmative result for this preflight. No matching review was recorded.');
    setReview({target:targetKey,scope:approvedReviewScope(operation,parameters)});
   }
   if(operation==='bootstrap'&&(raw?.root!==target.root||raw.controllerEnrolled!==true||raw.rootDeletionGuardActive!==true||raw.stagedRelease!==parameters.release_id||raw.manifestSha256!==parameters.manifest_sha256))throw Error('The controller enrollment response did not confirm the selected target, release and removal guard. Inspect the target before attempting another operation.');
   const response=operation==='diagnostics'?diagnosticsView(raw):(operation==='vpn_status'||operation==='vpn_enroll')?vpnView(raw):
    operation==='identity_status'?identityStatusView(raw):
    operation==='identity_preflight'||operation==='identity_generate'?identityView(raw,operation==='identity_generate'):
    operation==='formation_preflight'?formationView(raw):
    operation==='formation_prepare'?formationView(raw,true):
    operation==='formation_status'?formationStatusView(raw):
    operation==='genesis_stage'?genesisStageView(raw,formationRecord):
    operation==='genesis_binding_preflight'||operation==='genesis_bind'?genesisBindingView(raw,formationRecord,parameters.genesis_sha256??null):raw;
   if(operation==='identity_preflight')setIdentityReview({target:targetKey,genesis_sha256:response.genesis_sha256});
   if(operation==='formation_preflight')setFormationReview({target:targetKey,...response});
   if(operation==='formation_prepare'||operation==='formation_status'){
    if(operation==='formation_prepare'&&response.formation_sha256!==parameters.formation_sha256)throw Error('The prepared identity did not match the reviewed formation.');
    setFormationRecord(response);
   }
   if(operation==='genesis_binding_preflight'||operation==='genesis_bind')setBindingReview({target:targetKey,...response});
   const record={operation,parameters,response,receivedAt:Date.now()};
   setResults(previous=>({...previous,[operation]:record}));setLatest(record);
  }catch(failure){if(active.current)setError(`${String(failure?.message||failure)}${MUTATIONS.has(operation)?' Inspect the target to reconcile its state before repeating this operation.':''}`);}
  finally{locked.current=false;if(active.current)setPending(null);}
 }
 async function exportPublic(kind){
  const address=formationRecord?.address;
  const operation=kind==='formation'?'formation_export':'bound_export';
  if(!permitted||!address||locked.current||(kind==='formation'?!gateFor(operation).available:!bindingReview?.bound))return;
  locked.current=true;setPending(operation);setError('');setLatest(null);
  try{
   const response=publicExportView(await exportNodeNetworkPublicArtifact(target,kind,address,kind==='formation'?formationRecord.formation_sha256:bindingReview.genesis_sha256),address);
   if(active.current&&response)setLatest({operation,parameters:{},response,receivedAt:Date.now()});
  }catch(failure){if(active.current)setError(String(failure?.message||failure));}
  finally{locked.current=false;if(active.current)setPending(null);}
 }
 function action(operation){
  const gate=gateFor(operation);
  return <div className="native-controller-action" key={operation}><button type="button" disabled={!!pending||!gate.available} onClick={()=>perform(operation)}>{LABELS[operation]}</button>{!gate.available&&<small>{gate.blocker}</small>}</div>;
 }
 const field=(key,label)=><label key={key}>{label}<input value={form[key]} maxLength={128} autoComplete="off" disabled={!!pending} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>;
 const sample=results.diagnostics?.response;
 const setup=['install_preflight','install'];
 const vpn=results.vpn_status?.response;
 const exportRegistration=gateFor('formation_export');
 return <div className="native-controller">
  <Card title="Selected target" action={<button type="button" disabled={!permitted||!!pending} onClick={()=>perform('target')}>{LABELS.target}</button>}>
   <p>{target.kind==='local'?'This machine':`${target.host}:${target.port||22}`} · {target.root}</p>
   {state?<Detail data={{platform:state.platform,architecture:state.architecture,installed:state.installed,controllerVersion:state.controllerVersion,communityEnrollment:state.communityEnrollment}}/>:<p>{permitted?'Inspect the enrolled controller to see which operations are available.':'Allow NodeNetwork inspection in Security & permissions.'}</p>}
  </Card>
  {tab==='Validator setup'&&<div className="native-grid">
   <Card title="2. Enroll a clean host, or resume on an enrolled host">
    <p>Inspect an existing controller first. For a clean host, native review verifies the selected package, SSH host key and public operator key. Enrollment stages the release; it does not grant installation, consensus membership or activation.</p>
    {master&&<button type="button" disabled={!!pending} onClick={()=>setForm({...form,release_id:master.release,manifest_sha256:master.manifestSha256})}>Copy inspected release reference into draft</button>}
    <label>Existing administrative account<input value={operator} maxLength={32} autoComplete="off" disabled={!!pending||!!state} onChange={event=>setOperator(event.target.value)}/></label>
    <button type="button" disabled={!permitted||!!pending||!!state||!operator||(target.kind==='local'&&!localSupported)} onClick={()=>perform('bootstrap')}>{LABELS.bootstrap}</button>
   </Card>
   <Card title="3. Stage and install validator software">
    <p>Inspect the target after each change. Software installation does not commission a validator or start consensus.</p>
    {setup.map(action)}
   </Card>
   <Card title="Stage A · Prepare a validator before Genesis">
    <p>Read the authenticated host first. Preparation generates independent APQE keys on the selected host and keeps private material there. It does not sign Genesis or grant validator membership.</p>
    {action('formation_status')}{action('formation_preflight')}
    {formationReview&&<Detail data={{network:formationReview.network_id,chainId:formationReview.chain_id,formationId:formationReview.formation_id,reviewedFormationSha256:formationReview.formation_sha256}}/>}
    {action('formation_prepare')}
    <p role="status">{formationRecord?.pending===true?'Identity generated and verified · Public registration ready to export':formationRecord?.pending===false?'No prepared identity on this target':'Formation status not verified'}</p>
    {formationRecord?.pending&&<Detail data={{address:formationRecord.address,formationId:formationRecord.formation_id}}/>}
    <button type="button" disabled={!!pending||!exportRegistration.available} onClick={()=>exportPublic('formation')}>{LABELS.formation_export}</button>
    <p>After an interrupted response, inspect and read formation status to recover the same identity. Do not prepare another one.</p>
   </Card>
   <Card title="Stage B · Verify signed Genesis and bind custody">
    <p>Select the folder containing the independently signed Genesis, signed authority manifest, and public authority key. Portal checks the target’s pinned hashes before sending the files. Verify the staged result before binding custody.</p>
    {action('genesis_stage')}{action('genesis_binding_preflight')}
    {bindingReview&&<Detail data={{network:bindingReview.network_id,chainId:bindingReview.chain_id,address:bindingReview.address,verifiedGenesisSha256:bindingReview.genesis_sha256}}/>}
    <p role="status">{bindingReview?.bound===true?'Existing custody bound to the verified Genesis':bindingReview?'Genesis and signed membership verified · Custody not yet bound':'Genesis authorization pending verification'}</p>
    {action('genesis_bind')}
    <button type="button" disabled={!!pending||!permitted||!bindingReview?.bound} onClick={()=>exportPublic('bound')}>{LABELS.bound_export}</button>
    <p>Bound public enrollment can be used by the independent transport registry signer. No private key is exported. Signed membership does not prove the required 50,000 SNRG stake, runtime admission or participation.</p>
   </Card>
   <Card title="4. Connect VPN, commission and verify runtime">
    <p>{vpn?.connected&&vpn?.server_bound?'VPN connected and server binding observed':vpn?'VPN enrollment or connection pending':'VPN status not verified'}</p>
    {['register','vpn_status','vpn_enroll','commission','start','health'].map(action)}
    <p>{results.commission?.response?.commissioned===true?'Commissioning confirmed by the target.':'Validator commissioning not verified.'} A start response does not establish running, admitted, participating, synchronized or healthy status. Verify runtime evidence independently.</p>
   </Card>
  </div>}
  {tab==='Management'&&<Card title="Node lifecycle and diagnostics">
   {['health','vpn_status','vpn_enroll','diagnostics','inventory','start','stop','restart','recovery_preflight'].map(action)}
   <p>Use health to verify the result after a start or restart. Recovery remains a separately qualified operation. This workspace does not offer arbitrary shell or checkpoint access.</p>
  </Card>}
  {tab==='Updates'&&<Card title="Controlled master update">
   {field('release_id','Approved release ID')}{field('manifest_sha256','Approved manifest SHA-256')}
   <p>The controller verifies the master staged on the target. Review the exact release before applying it. Check target state before starting or retrying an update.</p>
   {action('upgrade_preflight')}{action('upgrade')}
  </Card>}
  {tab==='Installation isolation'&&<Card title="Containment and removal">
   {action('inventory')}{action('uninstall_preflight')}
   <p>Removal destroys node custody, signing-safety records and chain data. Review the exact scope and preserve required material using an approved procedure first.</p>
   <label>Confirm destructive root<input autoComplete="off" value={confirmation} disabled={!!pending} onChange={event=>setConfirmation(event.target.value)} placeholder={target.root}/></label>
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
  {latest&&latest.operation!=='target'&&(!(tab==='Performance'||tab==='Logs')||latest.operation!=='diagnostics')&&<Card title={`Controller result · ${LABELS[latest.operation]}`}>
   <p>Received {new Date(latest.receivedAt).toISOString()} from the selected target. This response is not a durable job record or proof of consensus readiness.</p>
   {!!Object.keys(latest.parameters).length&&<Detail data={{submittedPublicParameters:latest.parameters}}/>}<Detail data={latest.response}/>
  </Card>}
 </div>;
}
