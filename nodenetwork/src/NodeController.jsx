import {useState} from 'react';
import {nodeNetworkController,nodeNetworkBootstrap} from "./native-services.js";
import {Card,Detail,ErrorMessage,useResource,Resource} from "@synergy-network/portal-native/dapp-sdk";
import {R5_BASELINE,controllerOperation,installParameters} from './nodeNetwork.js';

export function NodeController({target,permitted,tab,master,localSupported}){
 const [operator,setOperator]=useState('');
 const [form,setForm]=useState({...R5_BASELINE,network_id:'',chain_id:'99999',node_name:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null),[confirmation,setConfirmation]=useState('');
 const key=JSON.stringify(target);
 const capabilities=useResource(()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return nodeNetworkController(target,'target');
 },`${key}:${permitted}`);
 const state=capabilities.data;
 async function run(operation,parameters={}){
  if(!permitted||busy)return;
  setBusy(true);setError('');setResult(null);
  try{setResult({operation,result:await nodeNetworkController(target,operation,parameters)});if(['install','commission','register','uninstall'].includes(operation))capabilities.reload();}
  catch(failure){setError(String(failure?.message||failure));}
  finally{setBusy(false);}
 }
 async function bootstrap(){
  if(!permitted||busy)return;
  setBusy(true);setError('');setResult(null);
  try{const response=await nodeNetworkBootstrap(target,operator,installParameters(form));if(response){setResult({operation:'bootstrap',result:response});capabilities.reload();}}
  catch(failure){setError(String(failure?.message||failure));}
  finally{setBusy(false);}
 }
 function button(operation,label,parameters=()=>({})){
  const gate=controllerOperation(state,operation);
  return <div className="native-controller-action" key={operation}><button disabled={!permitted||busy||!gate.available} onClick={()=>{try{run(operation,parameters());}catch(failure){setError(failure.message);}}}>{label}</button>{!gate.available&&<small>{gate.blocker}</small>}</div>;
 }
 const field=(key,label)=><label key={key}>{label}<input aria-label={label} value={form[key]} autoComplete="off" onChange={event=>setForm({...form,[key]:event.target.value})}/></label>;
 const release=()=>{const p=installParameters({...form,network_id:form.network_id||'preflight-network',node_name:form.node_name||'preflight-node'});return {release_id:p.release_id,manifest_sha256:p.manifest_sha256};};
 return <div className="native-controller">
  <Card title="Authenticated target controller" action={<button disabled={!permitted||busy} onClick={capabilities.reload}>Inspect selected target</button>}>
   <Resource value={capabilities}>{data=><Detail data={{platform:data.platform,architecture:data.architecture,root:data.root,installed:data.installed,localValidatorSupported:data.localValidatorSupported,controllerVersion:data.controllerVersion,communityEnrollment:data.communityEnrollment}}/>}</Resource>
   <p>Inspect an enrolled target, or bootstrap a clean target from the approved master below. Remote access uses an enrolled dedicated account, verified SSH host keys and agent credentials. No password or private key is sent to the dApp.</p>
  </Card>
  {tab==='Validator setup'&&<div className="native-grid">
   <Card title="Approved installation package">
    {field('release_id','Approved release ID')}{field('manifest_sha256','Approved manifest SHA-256')}{field('network_id','Approved network incarnation')}{field('chain_id','Approved chain ID')}{field('node_name','Validator node name')}
    {master&&<button onClick={()=>setForm({...form,release_id:master.release,manifest_sha256:master.manifestSha256})}>Use inspected manifest in preflight</button>}
    <label>Existing administrative SSH account<input aria-label="Existing administrative SSH account" value={operator} onChange={event=>setOperator(event.target.value)} autoComplete="off"/></label>
    <button disabled={!permitted||busy||!operator||(target.kind==='local'&&!localSupported)} onClick={bootstrap}>Bootstrap clean target from approved master</button>
    <p>Bootstrap uses native package and public-key pickers, verified SSH host identity and agent authentication. Its embedded canonical engine requires an empty /opt/Synergy and confirms the exact target and privilege scope before transmission.</p>
    <p>The R5 baseline is shown for comparison. Its digest alone does not approve this target, network or installation.</p>
    {button('install_preflight','Run installation preflight',()=>installParameters(form))}
    {button('install','Install approved node',()=>installParameters(form))}
    {button('commission','Verify and commission provisioned custody')}
    {button('register','Register contained service')}
   </Card>
   <Card title="Lifecycle and monitoring">
    {button('health','Read target health')}{button('start','Start node')}{button('stop','Stop node')}{button('restart','Restart node')}
    <p>Mutations require native operator confirmation and a matching one-time grant on the target. Software installation does not grant consensus membership.</p>
   </Card>
  </div>}
  {tab==='Management'&&<Card title="Node lifecycle and diagnostics">
   {button('health','Read target health')}{button('inventory','Inventory node-owned files')}
   {button('start','Start node')}{button('stop','Stop node')}{button('restart','Restart node')}
   {button('recovery_preflight','Diagnose recovery readiness')}
   <p>Health and diagnostics use the selected target controller. Public RPC observations describe their RPC node. Recovery executes only through a separately qualified procedure; this interface does not offer arbitrary checkpoint imports or shell access.</p>
  </Card>}
  {tab==='Updates'&&<Card title="Controlled master update">
   {field('release_id','Approved release ID')}{field('manifest_sha256','Approved manifest SHA-256')}
   <p>Stage the approved package inside Synergy before preflight. Host policy verifies release eligibility and compatibility. There is no automatic retry or unqualified rollback.</p>
   {button('upgrade_preflight','Verify staged update',release)}{button('upgrade','Apply approved update',release)}
  </Card>}
  {tab==='Installation isolation'&&<Card title="Containment and removal">
   {button('inventory','Inventory node-owned files')}{button('uninstall_preflight','Review uninstall scope')}
   <label>Confirm destructive root<input aria-label="Confirm destructive root" autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)} placeholder="/opt/Synergy"/></label>
   {button('uninstall','Uninstall reviewed node',()=>{if(confirmation!=='/opt/Synergy')throw new Error('Type /opt/Synergy to confirm the destructive root.');return {confirmation};})}
   <p>Uninstall removes node custody, signing-safety records and chain data. Review the host scope and preserve required material through an approved operational procedure first.</p>
  </Card>}
  {busy&&<p role="status">Waiting for the target controller. Do not repeat the operation.</p>}
  <ErrorMessage error={error}/>{result&&<Card title={`Controller result · ${result.operation}`}><Detail data={result.result}/></Card>}
 </div>;
}
