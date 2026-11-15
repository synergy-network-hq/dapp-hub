import {useEffect,useRef,useState} from 'react';
import {nodeNetworkController,nodeNetworkBootstrap} from "./native-services.js";
import {Card,Detail,ErrorMessage,useResource,Resource} from "@synergy-network/portal-native/dapp-sdk";
import {controllerOperation,installParameters} from './nodeNetwork.js';
import {installPreflightChecklist} from './install-preflight.js';
import {InstallPreflight} from './InstallPreflight.jsx';
import {targetControllerObservation} from './target-observation.js';
import {ControllerUpdate} from './UpdatePackage.jsx';
import {ControllerRemoval} from './Offboarding.jsx';

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

export function NodeController({target,form,setForm,permitted,tab,master,localSupported}){
 const [operator,setOperator]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
 const [preflightAttempt,setPreflightAttempt]=useState(null);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const key=JSON.stringify(target);
 const capabilities=useResource(async()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return targetControllerObservation(await nodeNetworkController(target,'target'));
 },`${key}:${permitted}`);
 const state=capabilities.data;
 const preflight=installPreflightChecklist({form,target,permitted,capabilities,master,attempt:preflightAttempt});
 async function run(operation,parameters={}){
  if(!permitted||busy)return;
  setBusy(true);setError('');setResult(null);
  const submitted={...parameters};
  const isPreflight=operation==='install_preflight';
  setPreflightAttempt(isPreflight?{parameters:submitted,state:'pending'}:null);
  try{
   const response=await nodeNetworkController(target,operation,submitted);
   if(alive.current){
    const receivedAt=Date.now();
    if(isPreflight)setPreflightAttempt({parameters:submitted,state:'received',receivedAt});
    setResult({operation,submitted,result:response,receivedAt});
    capabilities.reload();
   }
  }
  catch(failure){
   if(alive.current){
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
 return <div className="native-controller">
  <Card title="Authenticated target controller" action={<button disabled={!permitted||busy} onClick={capabilities.reload}>Inspect selected target</button>}>
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
    {button('health','Read target health')}{button('start','Start node')}{button('stop','Stop node')}{button('restart','Restart node')}
    <p>Mutations require native operator confirmation and a matching one-time grant on the target. Software installation does not grant consensus membership.</p>
   </Card>
   <InstallPreflight checklist={preflight} action={
    <button disabled={busy||!preflight.canRun} onClick={()=>run('install_preflight',installParameters(form))}>Run installation preflight</button>
   }/>
  </div>}
  {tab==='Management'&&<Card title="Node lifecycle and diagnostics">
   {button('health','Read target health')}{button('inventory','Inventory node-owned files')}
   {button('start','Start node')}{button('stop','Stop node')}{button('restart','Restart node')}
   {button('recovery_preflight','Diagnose recovery readiness')}
   <p>Health and diagnostics use the selected target controller. Public RPC observations describe their RPC node. Recovery executes only through a separately qualified procedure; this interface does not offer arbitrary checkpoint imports or shell access.</p>
  </Card>}
  {tab==='Updates'&&<ControllerUpdate form={form} target={target} permitted={permitted} busy={busy} controller={state} result={result} run={run}/>}
  {tab==='Installation isolation'&&<ControllerRemoval target={target} permitted={permitted} busy={busy}
   controller={state} result={result} run={run}
   inventoryAction={button('inventory','Inventory node-owned files')}
   preflightAction={button('uninstall_preflight','Review uninstall scope')}/>}
  {busy&&<p role="status">Waiting for the target controller. Do not repeat the operation.</p>}
  <ErrorMessage error={error}/>{result&&<Card title={`Controller result · ${result.operation}`}><p>Response received {new Date(result.receivedAt).toISOString()}. This response is not a durable job record or proof of consensus readiness.</p><Detail data={{submittedOperation:result.operation,submittedPublicParameters:result.submitted}}/><p>These are the inputs submitted by this Portal view, not the current draft, a signed plan or authenticated target-state evidence. Native package/key selection remains part of the separate native review.</p><Detail data={result.result}/></Card>}
 </div>;
}
