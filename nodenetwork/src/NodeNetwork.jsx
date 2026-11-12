import {RpcReadiness} from './RpcReadiness.jsx';
import {chainIdNumber,CANARY_PROFILE,canaryRead,canaryProcessingStatus} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {emptyProvisioningDraft,readProvisioningSnapshot,saveProvisioningDraft} from './provisioning-draft.js';
import './monitor.css';
import {ValidatorMonitor} from './ValidatorMonitor.jsx';
import {NodeWatchlist} from './NodeWatchlist.jsx';
import {useEffect,useRef,useState} from 'react';
import {useNative} from "@synergy-network/portal-native/dapp-sdk";
import {atlas,rpc} from "@synergy-network/portal-native/dapp-sdk";
import {nodeNetworkHostStatus,nodeNetworkReviewMaster} from "./native-services.js";
import {Card,Detail,ErrorMessage,Resource,useResource} from "@synergy-network/portal-native/dapp-sdk";
import {NodeController} from './NodeController.jsx';
import {RequestHistory} from './RequestHistory.jsx';
import {NodeNetworkPanelFrame,NodeNetworkPanelCard} from "./NodeNetworkPanelFrame.jsx";
import {readNodeNetwork,nodeNetworkTarget,provisioningChecks} from './nodeNetwork.js';
import {nodeRoleCatalog} from './operator-workflow.js';

export function NodeNetworkApp(){
 const n=useNative(),[section,setSection]=useState('overview'),[settingsTab,setSettingsTab]=useState('Installation isolation'),[operationsTab,setOperationsTab]=useState('Validator setup');
 const [savedTarget]=useState(()=>{try{const raw=localStorage.getItem('portal-native-v1:nodeNetworkTarget');if(raw!==null&&raw.length>4096)throw Error('Saved target exceeds supported size.');const saved=raw===null?null:JSON.parse(raw);return {target:saved===null?null:nodeNetworkTarget(saved),error:''};}catch{return {target:null,error:'Saved target configuration is unreadable or unsupported. Original storage is retained; saving is blocked until it is recovered through a reviewed procedure.'};}});
 const [target,setTarget]=useState(savedTarget.target);
 const [kind,setKind]=useState(target?.kind||'local'),[host,setHost]=useState(target?.host||''),[port,setPort]=useState(String(target?.port||22)),[targetError,setTargetError]=useState(savedTarget.error);
 const [savedDraft,setSavedDraft]=useState(()=>{try{return {...readProvisioningSnapshot(),error:''};}catch{return {form:emptyProvisioningDraft(),error:'Saved provisioning draft could not be read. Original storage is retained; saving is blocked until it is recovered.'};}});
 const [form,setForm]=useState(savedDraft.form),[draftError,setDraftError]=useState(savedDraft.error),[draftNotice,setDraftNotice]=useState('');
 const [master,setMaster]=useState(null),[masterError,setMasterError]=useState(''),[reviewing,setReviewing]=useState(false);
 const profiles=[CANARY_PROFILE,...n.endpoints.filter(p=>p.id!==CANARY_PROFILE.id)];
 const [profileId,setProfileId]=useState(null);
 const profile=profiles.find(p=>p.id===(profileId??n.endpoint.id))||n.endpoint;
 const tab=({overview:'Network',operations:operationsTab,monitoring:'Management',logs:'Logs',performance:'Performance',settings:settingsTab})[section];
 const permitted=n.permit('node','readNetwork');
 const masterScope=useRef({permitted,generation:0});
 if(masterScope.current.permitted!==permitted)masterScope.current={permitted,generation:masterScope.current.generation+1};
 useEffect(()=>{setMaster(null);setMasterError('');setReviewing(false);return()=>{masterScope.current.generation++;};},[permitted]);
 async function reviewMaster(){
  if(!permitted)return;
  const generation=++masterScope.current.generation;
  setReviewing(true);setMasterError('');setMaster(null);
  try{const value=await nodeNetworkReviewMaster();if(masterScope.current.permitted&&masterScope.current.generation===generation)setMaster(value);}
  catch(error){if(masterScope.current.permitted&&masterScope.current.generation===generation)setMasterError(String(error?.message||error));}
  finally{if(masterScope.current.generation===generation)setReviewing(false);}
 }
 const local=useResource(()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return nodeNetworkHostStatus();
 },`${permitted}`);
 const processing=useResource(async signal=>{
  if(!permitted||profile.id!==CANARY_PROFILE.id)return null;
  return canaryProcessingStatus(await canaryRead('synergy_getProcessingContextV1',{}, {signal}));
 },JSON.stringify([profile.id,permitted]));
 const live=useResource(signal=>{
  if(!permitted)throw new Error('Allow NodeNetwork to read public network data in Security & permissions.');
  return readNodeNetwork(rpc,profile,signal);
 },`${profile.id}:${profile.rpc}:${profile.chainId}:${permitted}`);
 const validators=useResource(async signal=>{if(!permitted||Number(profile.chainId)!==1266)throw Error('Public Atlas validator monitoring requires read permission and chain 1266.');if(chainIdNumber(await rpc('synergy_getChainId',[],{endpoint:profile.rpc,signal}))!==1266)throw Error('RPC chain identity does not match Atlas chain 1266.');const data=await atlas('validators?limit=100',{signal});return {data,updatedAt:Date.now()};},`${profile.id}:${profile.rpc}:${profile.chainId}:${permitted}`);
 const refreshPublic=()=>{live.reload();validators.reload();processing.reload();};
 return <NodeNetworkPanelFrame section={section} onSectionChange={setSection} subtitle="Provision and manage an authorized validator." statusLabel={live.loading?'Checking observation network':live.error?'Observation network error':'Public network observed'} statusTone={live.data?'blue':'gray'} onRefresh={refreshPublic} refreshing={live.loading||validators.loading} nodeLabel={!target?'Host selection deferred':target.kind==='local'?'This machine':`${target.host}:${target.port||22}`} statusItems={[{label:'Target root',value:target?.root||'No target selected'},{label:'Observation network',value:profile.name},{label:'Chain ID',value:profile.chainId},{label:'Enrollment policy',value:'Not verified'}]}>
  {(section==='settings'||tab==='Validator setup')&&<Card title="Validator target"><form onSubmit={e=>{e.preventDefault();try{if(savedTarget.error)throw Error(savedTarget.error);if(kind==='local'&&local.data?.localValidatorSupported===false)throw Error('This machine does not support a local validator. Keep selection deferred or configure a supported remote target.');const next=nodeNetworkTarget({kind,host,port});if(n.store('nodeNetworkTarget',next)===false)throw Error('Target could not be saved. The current selection is unchanged.');setTarget(next);setTargetError('');}catch(error){setTargetError(error.message);}}}><label>Install and manage on<select aria-label="Validator target type" value={kind} onChange={e=>setKind(e.target.value)}><option value="local" disabled={local.data?.localValidatorSupported===false}>This machine · Linux x86_64 required</option><option value="remote">Remote headless machine</option></select></label>{kind==='remote'&&<><label>Remote host<input aria-label="Remote validator host" value={host} onChange={e=>setHost(e.target.value)} placeholder="Hostname or IP address" autoComplete="off"/></label><label>SSH port<input aria-label="Remote validator SSH port" value={port} onChange={e=>setPort(e.target.value)} inputMode="numeric" autoComplete="off"/></label></>}<button disabled={!!savedTarget.error||(kind==='local'&&local.data?.localValidatorSupported===false)}>Save validator target</button><ErrorMessage error={targetError}/></form><Detail data={{target:!target?'Host selection deferred':target.kind==='local'?'This machine':target.host,root:target?.root}}/><p>Saving a target does not authenticate it or authorize installation. Both target types require the same approved package and lifecycle.</p>{local.data?.localValidatorSupported===false&&<p>{local.data.reason}</p>}</Card>}
  {section==='operations'&&<nav className="native-tabs" aria-label="Validator operations">{['Validator setup','Management','Updates','Installation isolation'].map(name=><button type="button" key={name} aria-pressed={tab===name} onClick={()=>setOperationsTab(name)}>{name}</button>)}</nav>}
  {tab==='Network'&&<div className="native-actions"><label>Observation network<select aria-label="NodeNetwork observation network" value={profile.id} onChange={e=>setProfileId(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.chainId}</option>)}</select></label><button disabled={live.loading||validators.loading} onClick={refreshPublic}>Refresh observations</button></div>}
  {section==='settings'&&<div className="native-tabs" role="tablist" aria-label="Node settings sections">{['Updates','Installation isolation'].map(name=><button role="tab" key={name} aria-selected={tab===name} onClick={()=>setSettingsTab(name)}>{name}</button>)}</div>}
  {tab==='Performance'||tab==='Logs'?null:tab==='Network'?<>
   {profile.id===CANARY_PROFILE.id&&<Card title="Pinned Canary processing context"><Resource value={processing}>{value=>value&&<Detail data={value}/>}</Resource><p>Network and Genesis checks apply to gateway reads. This is not validator eligibility or release approval.</p></Card>}{profile.id!==CANARY_PROFILE.id&&<RpcReadiness profile={profile} permitted={permitted}/>}<div className="node-read-monitor"><Card title="Public validator index"><Resource value={validators}>{value=><><SourceAge updatedAt={value.updatedAt}/><ValidatorMonitor data={value.data}/><NodeWatchlist data={value.data} updatedAt={value.updatedAt}/></>}</Resource></Card></div>
   <p className="native-source">Public RPC observations from {profile.rpc}. These observations do not authenticate a provisioning target or approve enrollment.</p>
   <Resource value={live}>{data=><div className="native-grid"><Card title="Chain"><SourceAge updatedAt={data.chainReceivedAt} source="Selected public RPC chain-status read"/><Detail data={{network:profile.name,chainId:data.chain.chain_id,ready:data.chain.ready,lifecycle:data.chain.lifecycle,checkedAt:new Date(data.checkedAt).toLocaleString()}}/></Card>{['node','posy','sync'].map(name=><Card key={name} title={{node:'RPC node',posy:'PoSy consensus',sync:'Synchronization'}[name]}>{data.errors[name]?<ErrorMessage error={data.errors[name]}/>:<><SourceAge updatedAt={data.receivedAt?.[name]} source={`Selected public RPC ${name} observation`}/><Detail data={data.observations[name]}/></>}</Card>)}</div>}</Resource>
  </>:tab==='Validator setup'?<div className="native-grid">
   <Card title="1. Prepare validator references"><p>Prepare package and network references before choosing a host. A saved draft is local presentation data, not a signed plan, approval or queued job. It never resumes an operation automatically.</p>{[['release_id','Approved release ID'],['manifest_sha256','Approved manifest SHA-256'],['network_id','Approved network incarnation'],['chain_id','Approved chain ID'],['node_name','Validator node name']].map(([key,label])=><label key={key}>{label}<input value={form[key]} maxLength={128} autoComplete="off" onChange={event=>{setForm({...form,[key]:event.target.value});setDraftNotice('');}}/></label>)}<p>Draft input checks validate formatting only. They do not approve the release, network, enrollment, host prerequisites or execution.</p><ul aria-label="Provisioning draft input checks">{provisioningChecks(form).map(check=><li key={check.field}>{check.label}: {check.valid?'Format accepted; approval not verified':check.message}</li>)}</ul><button onClick={()=>{try{if(savedDraft.error)throw Error(savedDraft.error);const saved=saveProvisioningDraft(form,savedDraft.raw);setSavedDraft({...saved,error:''});setDraftError('');setDraftNotice('Draft saved on this device. No host or operation was authorized.');}catch(error){setDraftNotice('');setDraftError(String(error?.message||'Draft could not be saved. Your edits and the prior saved record are retained.'));}}}>Save provisioning draft</button><p>Replacing your draft below discards the unsaved field values and reads the saved local copy. It does not choose a host or resume work.</p><button onClick={()=>{try{const saved=readProvisioningSnapshot();setSavedDraft({...saved,error:''});setForm(saved.form);setDraftError('');setDraftNotice('Saved copy loaded. No operation was resumed.');}catch(error){setDraftNotice('');setDraftError(String(error?.message||'Saved copy unavailable. Your draft is retained.'));}}}>Replace draft with saved copy</button><ErrorMessage error={draftError}/>{draftNotice&&<p role="status">{draftNotice}</p>}</Card>
   <Card title="Node roles">
    <ul className="node-role-catalog">{nodeRoleCatalog(master?.roleCatalog).map(role=><li key={role.id}><strong>{role.label}</strong><span>{role.description}</span>{role.id==='validator'?<small>Guided setup below; admission and target authorization required.</small>:<button type="button" disabled>Unavailable</button>}</li>)}</ul>
   </Card>
   <Card title="Node architecture master"><button disabled={!permitted||reviewing} onClick={reviewMaster}>{reviewing?'Inspecting…':'Inspect Synergy master folder'}</button><ErrorMessage error={masterError}/>{permitted&&master&&<Detail data={{release:master.release,architecture:master.architecture,declaredFiles:master.fileCount,apqeProfile:master.apqeProfile,apqeReportSha256:master.apqeReportSha256,matchedApqeLibraries:master.apqeLibraryCount,manifestSha256:master.manifestSha256}}/>}<p>Compare the manifest digest with the approved release before using it. This preview does not authorize installation.</p></Card>
   <Card title="Local runtime compatibility"><Resource value={local}>{data=>data?<Detail data={data}/>:<p>No host inspection was returned.</p>}</Resource></Card>

  </div>:tab==='Management'?null:tab==='Updates'?<Card title="Managed validator updates"><p>NodeNetwork must apply one authenticated, qualified master release through the shared lifecycle. Per-validator architecture edits are prohibited.</p><p>The selected target controller authenticates update eligibility and a one-time operator grant before applying a staged package.</p></Card>:<div className="native-grid">
   <Card title="Single-root contract"><Detail data={{installationRoot:'/opt/Synergy',software:'/opt/Synergy/bin',configuration:'/opt/Synergy/config',custody:'/opt/Synergy/keys/apqe',network:'/opt/Synergy/network',vpnState:'/opt/Synergy/vpn',blockchainState:'/opt/Synergy/data',recovery:'/opt/Synergy/recovery',updateStaging:'/opt/Synergy/tmp',temporaryFiles:'/opt/Synergy/tmp',runtime:'/opt/Synergy/run',serviceDefinitions:'/opt/Synergy/systemd',logs:'/opt/Synergy/logs'}}/><p>Every node-owned file and directory must stay inside this root on both local and remote targets. External release, custody, VPN, checkpoint, staging or diagnostic files fail installation qualification. Any operating-system registration must reference definitions inside this root and be included in the isolation audit.</p></Card>
   <Card title="Audit status"><p>A host isolation audit is required before installation and after every update. Inspect the target inventory and conformance results below; a configured target is not automatically marked compliant.</p><p>Removing NodeNetwork from Portal does not uninstall a validator or delete chain state, keys or signing journals.</p></Card>
  </div>}
  {tab&&tab!=='Network'&&!target&&<Card title="Host selection deferred"><p>Save a local or remote target, then inspect it before using its controller. Public network observations do not select or authenticate a host.</p><button onClick={()=>{setOperationsTab('Validator setup');setSection('operations');}}>Choose validator target</button></Card>}
  {tab==='Management'&&<RequestHistory permitted={permitted}/>}
  {target&&tab&&tab!=='Network'&&<NodeController key={`${JSON.stringify(target)}:${permitted}`} target={target} form={form} setForm={setForm} permitted={permitted} tab={tab} master={master} localSupported={local.data?.localValidatorSupported===true}/>}
 </NodeNetworkPanelFrame>;
}
