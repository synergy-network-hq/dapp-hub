import {RpcReadiness} from './RpcReadiness.jsx';
import {NetworkComparison} from './NetworkComparison.jsx';
import {chainIdNumber,isCanonicalTestnetRpc} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {emptyProvisioningDraft,readProvisioningSnapshot,saveProvisioningDraft} from './provisioning-draft.js';
import './monitor.css';
import {ValidatorMonitor} from './ValidatorMonitor.jsx';
import {NodeWatchlist} from './NodeWatchlist.jsx';
import {validatorLookupObservation, validatorLookupPath} from './validator-lookup.js';
import {readValidatorActiveListing} from './validator-active-list.js';
import {useEffect,useRef,useState} from 'react';
import {useNative} from "@synergy-network/portal-native/dapp-sdk";
import {atlas,rpc} from "@synergy-network/portal-native/dapp-sdk";
import {nodeNetworkHostStatus,nodeNetworkReviewMaster} from "./native-services.js";
import {Card,Detail,ErrorMessage,Resource,useResource} from "@synergy-network/portal-native/dapp-sdk";
import {NodeController} from './NodeController.jsx';
import {InstallPreflight} from './InstallPreflight.jsx';
import {InstallationDraftReview} from './InstallationDraftReview.jsx';
import {installPreflightChecklist} from './install-preflight.js';
import {RequestHistory} from './RequestHistory.jsx';
import {SavedValidatorObservation} from './SavedValidatorObservation.jsx';
import {Troubleshooter} from './Troubleshooter.jsx';
import {UpdatePackage} from './UpdatePackage.jsx';
import {MaintenanceComparison} from './MaintenanceComparison.jsx';
import {VpnStatus} from './VpnStatus.jsx';
import {OffboardingChecklist} from './Offboarding.jsx';
import {TargetSettings, useTargetSelection} from './TargetSettings.jsx';
import {NodeNetworkPanelFrame,NodeNetworkPanelCard} from "./NodeNetworkPanelFrame.jsx";
import {CANARY_PROFILE,readNodeNetwork,provisioningChecks} from './nodeNetwork.js';

export function NodeNetworkApp(){
 const n=useNative(),[section,setSection]=useState('overview'),[settingsTab,setSettingsTab]=useState('Installation isolation');
 const targetSettings=useTargetSelection(),target=targetSettings.target;
 const [savedDraft,setSavedDraft]=useState(()=>{try{return {...readProvisioningSnapshot(),error:''};}catch{return {form:emptyProvisioningDraft(),error:'Saved provisioning draft could not be read. Original storage is retained; saving is blocked until it is recovered.'};}});
 const [form,setForm]=useState(savedDraft.form),[draftError,setDraftError]=useState(savedDraft.error),[draftNotice,setDraftNotice]=useState('');
 const [master,setMaster]=useState(null),[masterError,setMasterError]=useState(''),[reviewing,setReviewing]=useState(false);
 const profiles=[CANARY_PROFILE,...n.endpoints.filter(p=>p.id!==CANARY_PROFILE.id)];
 const [profileId,setProfileId]=useState(CANARY_PROFILE.id);
 const profile=profiles.find(p=>p.id===profileId)||CANARY_PROFILE;
 const tab=({overview:'Network',operations:'Validator setup',monitoring:'Management',settings:settingsTab})[section];
 const permitted=n.permit('node','readNetwork');
 const indexAvailable=permitted&&isCanonicalTestnetRpc(profile);
 const monitorScope=JSON.stringify([profile.id,profile.rpc,profile.chainId,profile.networkKey,permitted]);
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
 const live=useResource(signal=>{
  if(!permitted)throw new Error('Allow NodeNetwork to read public network data in Security & permissions.');
  return readNodeNetwork(rpc,profile,signal);
 },`${profile.id}:${profile.rpc}:${profile.chainId}:${permitted}`);
 const validators=useResource(async signal=>{
  if(!indexAvailable)return null;
  const data=await readAtlasValidators('validators?limit=100',signal);
  return {data,updatedAt:Date.now()};
 },monitorScope);
 async function readAtlasValidators(path,signal){
  if(!indexAvailable)throw Error('Atlas validator observations require read permission and the canonical Synergy Testnet RPC.');
  signal?.throwIfAborted();
  if(chainIdNumber(await rpc('synergy_getChainId',[],{endpoint:profile.rpc,signal}))!==1266)throw Error('RPC chain identity does not match Atlas chain 1266.');
  signal?.throwIfAborted();
  const data=await atlas(path,{signal});
  signal?.throwIfAborted();
  return data;
 }
 async function lookupValidator(address,signal){
  const path=validatorLookupPath(address);
  const detail=await readAtlasValidators(path,signal);
  return validatorLookupObservation(detail,address);
 }
 function lookupActiveListing(address, signal) {
  if (!permitted) throw Error('Allow NodeNetwork to read public network data in Security & permissions.');
  return readValidatorActiveListing(rpc, profile, address, signal);
 }
 const refreshPublic=()=>{live.reload();if(indexAvailable)validators.reload();};
 const refreshing=live.loading||(indexAvailable&&validators.loading);
 return <NodeNetworkPanelFrame section={section} onSectionChange={setSection} subtitle="Operator workspace · Enrollment policy has not been verified." statusLabel={live.loading?'Checking observation network':live.error?'Observation network error':'Public network observed'} statusTone={live.data?'blue':'gray'} onRefresh={refreshPublic} refreshing={refreshing} nodeLabel={!targetSettings.snapshot?'Target settings need review':!target?'Host selection deferred':target.kind==='local'?'This machine':`${target.host}:${target.port||22}`} statusItems={[{label:'Target root',value:target?.root||'No target selected'},{label:'Observation network',value:profile.name},{label:'Chain ID',value:profile.chainId},{label:'Enrollment policy',value:'Not verified'}]}>
  {section==='settings'&&<TargetSettings selection={targetSettings} local={local}/>}
  <div className="native-actions"><label>Observation network<select aria-label="NodeNetwork observation network" value={profileId} onChange={e=>setProfileId(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.chainId}</option>)}</select></label><button disabled={refreshing} onClick={refreshPublic}>Refresh NodeNetwork</button></div>
  {section==='settings'&&<div className="native-tabs" role="tablist" aria-label="Node settings sections">{['Updates','Installation isolation'].map(name=><button role="tab" key={name} aria-selected={tab===name} onClick={()=>setSettingsTab(name)}>{name}</button>)}</div>}
  {section==='performance'?<NodeNetworkPanelCard title="Validator performance telemetry">
   <p>Managed CPU, memory, disk and duty timing require an authenticated telemetry interface.</p>
   <p>Use public validator lookup in Overview to review attributed Atlas blocks and their receipt time.</p>
   <button onClick={()=>setSection('overview')}>Open public validator observations</button>
  </NodeNetworkPanelCard>:section==='logs'?<>
   <NodeNetworkPanelCard title="Validator log access"><p>Bounded, redacted log access needs a qualified controller integration. For an enrolled target, open Monitoring to inspect health or inventory.</p></NodeNetworkPanelCard>
   <Troubleshooter key={JSON.stringify([profile.id,profile.rpc,profile.chainId,permitted])} profile={profile} permitted={permitted} local={local} live={live} hasTarget={Boolean(target)} targetSettingsReadable={Boolean(targetSettings.snapshot)} onOpenMonitoring={()=>setSection('monitoring')} onOpenSettings={()=>setSection('settings')}/>
  </>:tab==='Network'?<>
   <Card title="Observation sources">
    <p>Public RPC observations use the selected endpoint. Atlas validator observations use the canonical Synergy Testnet transport.</p>
    {target
     ? <><p>A target is configured. Open Monitoring to inspect its native controller.</p><button onClick={()=>setSection('monitoring')}>Open target monitoring</button></>
     : <><p>Monitor-only · Host selection deferred.</p><button onClick={()=>setSection('settings')}>Review target settings</button></>}
   </Card>
   <RpcReadiness profile={profile} permitted={permitted}/>
   <NetworkComparison profile={profile} profiles={profiles} permitted={permitted} onOpenEndpoints={()=>n.navigate('network/endpoints')}/>
   <div className="node-read-monitor"><Card title="Public validator index">
    {indexAvailable ? <Resource value={validators}>{value=><><SourceAge updatedAt={value.updatedAt}/><ValidatorMonitor data={value.data}/></>}</Resource>
     : <p>{permitted?'Select the canonical Synergy Testnet RPC to view the Atlas validator index.':'Allow NodeNetwork public-network reads in Security & permissions.'}</p>}
   </Card></div>
   {permitted&&Number(profile.chainId)===1266&&<div className="node-read-monitor">
    <NodeWatchlist key={monitorScope} data={validators.data?.data} updatedAt={validators.data?.updatedAt} readValidator={indexAvailable?lookupValidator:null} readActiveListing={lookupActiveListing}/>
   </div>}
   <p className="native-source">Public RPC observations from {profile.rpc}. These observations do not authenticate a provisioning target or approve enrollment.</p>
   <Resource value={live}>{data=><div className="native-grid"><Card title="Chain"><SourceAge updatedAt={data.chainReceivedAt} source="Selected public RPC chain-status read"/><Detail data={{network:profile.name,chainId:data.chain.chain_id,ready:data.chain.ready,lifecycle:data.chain.lifecycle,checkedAt:new Date(data.checkedAt).toLocaleString()}}/></Card>{['node','posy','sync'].map(name=><Card key={name} title={{node:'RPC node',posy:'PoSy consensus',sync:'Synchronization'}[name]}>{data.errors[name]?<ErrorMessage error={data.errors[name]}/>:<><SourceAge updatedAt={data.receivedAt?.[name]} source={`Selected public RPC ${name} observation`}/><Detail data={data.observations[name]}/></>}</Card>)}</div>}</Resource>
  </>:tab==='Validator setup'?<div className="native-grid">
   <Card title="Provisioning draft"><p>Prepare package and network references before choosing a host. A saved draft is local presentation data, not a signed plan, approval or queued job. It never resumes an operation automatically.</p>{[['release_id','Approved release ID'],['manifest_sha256','Approved manifest SHA-256'],['network_id','Approved network incarnation'],['chain_id','Approved chain ID'],['node_name','Validator node name']].map(([key,label])=><label key={key}>{label}<input value={form[key]} maxLength={128} autoComplete="off" onChange={event=>{setForm({...form,[key]:event.target.value});setDraftNotice('');}}/></label>)}<p>Draft input checks validate formatting only. They do not approve the release, network, enrollment, host prerequisites or execution.</p><ul aria-label="Provisioning draft input checks">{provisioningChecks(form).map(check=><li key={check.field}>{check.label}: {check.valid?'Format accepted; approval not verified':check.message}</li>)}</ul><button onClick={()=>{try{if(savedDraft.error)throw Error(savedDraft.error);const saved=saveProvisioningDraft(form,savedDraft.raw);setSavedDraft({...saved,error:''});setDraftError('');setDraftNotice('Draft saved on this device. No host or operation was authorized.');}catch(error){setDraftNotice('');setDraftError(String(error?.message||'Draft could not be saved. Your edits and the prior saved record are retained.'));}}}>Save provisioning draft</button><p>Replacing your draft below discards the unsaved field values and reads the saved local copy. It does not choose a host or resume work.</p><button onClick={()=>{try{const saved=readProvisioningSnapshot();setSavedDraft({...saved,error:''});setForm(saved.form);setDraftError('');setDraftNotice('Saved copy loaded. No operation was resumed.');}catch(error){setDraftNotice('');setDraftError(String(error?.message||'Saved copy unavailable. Your draft is retained.'));}}}>Replace draft with saved copy</button><ErrorMessage error={draftError}/>{draftNotice&&<p role="status">{draftNotice}</p>}</Card>
   <Card title="Standardized validator installation">{!target&&<p>Host selection remains deferred.</p>}<p>Every validator must use the same qualified master package. Its identity, APQE custody, authenticated network configuration, blockchain data, recovery material and update staging belong inside /opt/Synergy.</p><ol><li>Authenticate the operator, target host and approved release.</li><li>Check host prerequisites and installation isolation.</li><li>Provision independent APQE role keys into local custody.</li><li>Verify authenticated Genesis, membership and transport authority.</li><li>Install through the shared lifecycle and verify restart, synchronization and finality.</li></ol></Card>
   <InstallationDraftReview form={form}/>
   {!target&&<InstallPreflight checklist={installPreflightChecklist({form,permitted,master})}
    action={<button disabled={!permitted} onClick={()=>setSection('monitoring')}>Review saved preflight evidence</button>}/>}
   <Card title="Node architecture master"><button disabled={!permitted||reviewing} onClick={reviewMaster}>{reviewing?'Inspecting…':'Inspect Synergy master folder'}</button><ErrorMessage error={masterError}/>{permitted&&master&&<Detail data={{release:master.release,architecture:master.architecture,declaredFiles:master.fileCount,manifestSha256:master.manifestSha256}}/>}<p>Compare the manifest digest with the approved release before using it. This preview does not authorize installation.</p></Card>
   <Card title="Local runtime compatibility"><Resource value={local}>{data=>data?<Detail data={data}/>:<p>No host inspection was returned.</p>}</Resource></Card>

  </div>:tab==='Management'?null:tab==='Updates'?<>
   <UpdatePackage form={form} setForm={setForm}/>
   <MaintenanceComparison permitted={permitted}/>
  </>:<div className="native-grid">
   <Card title="Single-root contract"><Detail data={{installationRoot:'/opt/Synergy',software:'/opt/Synergy/bin',configuration:'/opt/Synergy/config',custody:'/opt/Synergy/keys/apqe',network:'/opt/Synergy/network',vpnState:'/opt/Synergy/vpn',blockchainState:'/opt/Synergy/data',recovery:'/opt/Synergy/recovery',updateStaging:'/opt/Synergy/tmp',temporaryFiles:'/opt/Synergy/tmp',runtime:'/opt/Synergy/run',serviceDefinitions:'/opt/Synergy/systemd',logs:'/opt/Synergy/logs'}}/><p>Every node-owned file and directory must stay inside this root on both local and remote targets. External release, custody, VPN, checkpoint, staging or diagnostic files fail installation qualification. Any operating-system registration must reference definitions inside this root and be included in the isolation audit.</p></Card>
   <Card title="Audit status"><p>A host isolation audit is required before installation and after every update. Inspect the target inventory and conformance results below; a configured target is not automatically marked compliant.</p><p>Removing NodeNetwork from Portal does not uninstall a validator or delete chain state, keys or signing journals.</p></Card>
   <OffboardingChecklist permitted={permitted} onOpenHistory={()=>setSection('logs')}/>
  </div>}
  {tab&&tab!=='Network'&&!target&&<Card title="Host selection deferred"><p>No target controller will be contacted until you explicitly save a target in Settings. Public network observations do not select or authenticate a host.</p><button onClick={()=>setSection('settings')}>Review target settings</button></Card>}
  {tab==='Management'&&<SavedValidatorObservation permitted={permitted} onOpenDiagnostics={()=>setSection('logs')}/>}
  {tab==='Management'&&!target&&<VpnStatus onOpenDiagnostics={()=>setSection('logs')}/>}
  {(tab==='Management'||section==='logs')&&<RequestHistory permitted={permitted}/>}
  {target&&tab&&tab!=='Network'&&<NodeController key={`${JSON.stringify(target)}:${permitted}`} target={target} form={form} setForm={setForm} permitted={permitted} tab={tab} master={master} localSupported={local.data?.localValidatorSupported===true} onOpenDiagnostics={()=>setSection('logs')}/>}
 </NodeNetworkPanelFrame>;
}
