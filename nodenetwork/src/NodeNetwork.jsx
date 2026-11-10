import './monitor.css';
import {ValidatorMonitor} from './ValidatorMonitor.jsx';
import {NodeWatchlist} from './NodeWatchlist.jsx';
import {useState} from 'react';
import {useNative} from "@synergy-network/portal-native/dapp-sdk";
import {atlas,rpc} from "@synergy-network/portal-native/dapp-sdk";
import {nodeNetworkHostStatus,nodeNetworkReviewMaster} from "./native-services.js";
import {readStore} from "@synergy-network/portal-native/dapp-sdk";
import {Card,Detail,ErrorMessage,Resource,useResource} from "@synergy-network/portal-native/dapp-sdk";
import {NodeController} from './NodeController.jsx';
import {NodeNetworkPanelFrame,NodeNetworkPanelCard} from "./NodeNetworkPanelFrame.jsx";
import {CANARY_PROFILE,readNodeNetwork,nodeNetworkTarget} from './nodeNetwork.js';

export function NodeNetworkApp(){
 const n=useNative(),[section,setSection]=useState('overview'),[settingsTab,setSettingsTab]=useState('Installation isolation');
 const [target,setTarget]=useState(()=>{try{return nodeNetworkTarget(readStore('portal-native-v1:nodeNetworkTarget',{kind:'local'}));}catch{return nodeNetworkTarget({kind:'local'});}});
 const [kind,setKind]=useState(target.kind),[host,setHost]=useState(target.host||''),[port,setPort]=useState(String(target.port||22)),[targetError,setTargetError]=useState('');
 const [master,setMaster]=useState(null),[masterError,setMasterError]=useState(''),[reviewing,setReviewing]=useState(false);
 const profiles=[CANARY_PROFILE,...n.endpoints.filter(p=>p.id!==CANARY_PROFILE.id)];
 const [profileId,setProfileId]=useState(CANARY_PROFILE.id);
 const profile=profiles.find(p=>p.id===profileId)||CANARY_PROFILE;
 const tab=({overview:'Network',operations:'Validator setup',monitoring:'Management',logs:'Management',settings:settingsTab})[section];
 const permitted=n.permit('node','readNetwork');
 async function reviewMaster(){
  setReviewing(true);setMasterError('');setMaster(null);
  try{setMaster(await nodeNetworkReviewMaster());}catch(error){setMasterError(String(error?.message||error));}
  finally{setReviewing(false);}
 }
 const local=useResource(()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return nodeNetworkHostStatus();
 },`${permitted}`);
 const live=useResource(signal=>{
  if(!permitted)throw new Error('Allow NodeNetwork to read public network data in Security & permissions.');
  return readNodeNetwork(rpc,profile,signal);
 },`${profile.id}:${profile.rpc}:${profile.chainId}:${permitted}`);
 const validators=useResource(async signal=>{if(!permitted||Number(profile.chainId)!==1266)throw Error('Public Atlas validator monitoring requires read permission and chain 1266.');if(Number(await rpc('synergy_getChainId',[],{endpoint:profile.rpc,signal}))!==1266)throw Error('RPC chain identity does not match Atlas chain 1266.');const data=await atlas('validators?limit=100',{signal});return {data,updatedAt:Date.now()};},`${profile.id}:${profile.rpc}:${profile.chainId}:${permitted}`);
 return <NodeNetworkPanelFrame section={section} onSectionChange={setSection} subtitle="Genesis operator workspace · Community validator enrollment is closed." statusLabel={live.loading?'Checking observation network':live.error?'Observation network error':'Public network observed'} statusTone={live.data?'blue':'gray'} onRefresh={live.reload} refreshing={live.loading} nodeLabel={target.kind==='local'?'This machine':`${target.host}:${target.port||22}`} statusItems={[{label:'Target root',value:target.root},{label:'Observation network',value:profile.name},{label:'Chain ID',value:profile.chainId},{label:'Enrollment',value:'Genesis operators only'}]}>
  {section==='settings'&&<Card title="Validator target"><form onSubmit={e=>{e.preventDefault();try{const next=nodeNetworkTarget({kind,host,port});setTarget(next);n.store('nodeNetworkTarget',next);setTargetError('');}catch(error){setTargetError(error.message);}}}><label>Install and manage on<select aria-label="Validator target type" value={kind} onChange={e=>setKind(e.target.value)}><option value="local" disabled={local.data?.localValidatorSupported===false}>This machine · Linux x86_64 required</option><option value="remote">Remote headless machine</option></select></label>{kind==='remote'&&<><label>Remote host<input aria-label="Remote validator host" value={host} onChange={e=>setHost(e.target.value)} placeholder="Hostname or IP address" autoComplete="off"/></label><label>SSH port<input aria-label="Remote validator SSH port" value={port} onChange={e=>setPort(e.target.value)} inputMode="numeric" autoComplete="off"/></label></>}<button>Save validator target</button><ErrorMessage error={targetError}/></form><Detail data={{target:target.kind==='local'?'This machine':target.host,root:target.root}}/><p>Saving a target does not authenticate it or authorize installation. Both target types require the same approved package and lifecycle.</p>{local.data?.localValidatorSupported===false&&<p>{local.data.reason}</p>}</Card>}
  <div className="native-actions"><label>Observation network<select aria-label="NodeNetwork observation network" value={profileId} onChange={e=>setProfileId(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.chainId}</option>)}</select></label><button onClick={live.reload}>Refresh NodeNetwork</button></div>
  {section==='settings'&&<div className="native-tabs" role="tablist" aria-label="Node settings sections">{['Updates','Installation isolation'].map(name=><button role="tab" key={name} aria-selected={tab===name} onClick={()=>setSettingsTab(name)}>{name}</button>)}</div>}
  {section==='performance'?<NodeNetworkPanelCard title="Validator performance telemetry"><p>The qualified target controller does not yet expose CPU, memory, disk, network throughput or APQE timing samples. Performance history requires an authenticated, bounded telemetry interface; no synthetic values are displayed.</p></NodeNetworkPanelCard>:section==='logs'?<NodeNetworkPanelCard title="Validator log access"><p>The qualified controller does not yet provide bounded, redacted log access. Inventory and health diagnostics are available below; arbitrary shell execution and filesystem access are excluded.</p></NodeNetworkPanelCard>:tab==='Network'?<>
   <div className="node-read-monitor"><Card title="Public validator index"><Resource value={validators}>{value=><><ValidatorMonitor data={value.data}/><NodeWatchlist data={value.data} updatedAt={value.updatedAt}/></>}</Resource></Card></div>
   <p className="native-source">Public RPC observations from {profile.rpc}. These observations do not authenticate a provisioning target or approve enrollment.</p>
   <Resource value={live}>{data=><div className="native-grid"><Card title="Chain"><Detail data={{network:profile.name,chainId:data.chain.chain_id,ready:data.chain.ready,lifecycle:data.chain.lifecycle,checkedAt:new Date(data.checkedAt).toLocaleString()}}/></Card>{['node','posy','sync'].map(name=><Card key={name} title={{node:'RPC node',posy:'PoSy consensus',sync:'Synchronization'}[name]}>{data.errors[name]?<ErrorMessage error={data.errors[name]}/>:<Detail data={data.observations[name]}/>}</Card>)}</div>}</Resource>
  </>:tab==='Validator setup'?<div className="native-grid">
   <Card title="Standardized validator installation"><p>Host selection remains deferred. No host is enrolled or provisioned by opening this view.</p><p>Every validator must use the same qualified master package. Its identity, APQE custody, authenticated network configuration, blockchain data, recovery material and update staging belong inside /opt/Synergy.</p><ol><li>Authenticate the operator, target host and approved release.</li><li>Check host prerequisites and installation isolation.</li><li>Provision independent APQE role keys into local custody.</li><li>Verify authenticated Genesis, membership and transport authority.</li><li>Install through the shared lifecycle and verify restart, synchronization and finality.</li></ol></Card>
   <Card title="Node architecture master"><button disabled={!permitted||reviewing} onClick={reviewMaster}>{reviewing?'Inspecting…':'Inspect Synergy master folder'}</button><ErrorMessage error={masterError}/>{permitted&&master&&<Detail data={{release:master.release,architecture:master.architecture,declaredFiles:master.fileCount,manifestSha256:master.manifestSha256}}/>}<p>Compare the manifest digest with the approved release before using it. This preview does not authorize installation.</p></Card>
   <Card title="Local runtime compatibility"><Resource value={local}>{data=>data?<Detail data={data}/>:<p>No host inspection was returned.</p>}</Resource></Card>

  </div>:tab==='Management'?null:tab==='Updates'?<Card title="Managed validator updates"><p>NodeNetwork must apply one authenticated, qualified master release through the shared lifecycle. Per-validator architecture edits are prohibited.</p><p>The selected target controller authenticates update eligibility and a one-time operator grant before applying a staged package.</p></Card>:<div className="native-grid">
   <Card title="Single-root contract"><Detail data={{installationRoot:'/opt/Synergy',software:'/opt/Synergy/bin',configuration:'/opt/Synergy/config',custody:'/opt/Synergy/keys/apqe',network:'/opt/Synergy/network',vpnState:'/opt/Synergy/vpn',blockchainState:'/opt/Synergy/data',recovery:'/opt/Synergy/recovery',updateStaging:'/opt/Synergy/tmp',temporaryFiles:'/opt/Synergy/tmp',runtime:'/opt/Synergy/run',serviceDefinitions:'/opt/Synergy/systemd',logs:'/opt/Synergy/logs'}}/><p>Every node-owned file and directory must stay inside this root on both local and remote targets. External release, custody, VPN, checkpoint, staging or diagnostic files fail installation qualification. Any operating-system registration must reference definitions inside this root and be included in the isolation audit.</p></Card>
   <Card title="Audit status"><p>A host isolation audit is required before installation and after every update. Inspect the target inventory and conformance results below; a configured target is not automatically marked compliant.</p><p>Removing NodeNetwork from Portal does not uninstall a validator or delete chain state, keys or signing journals.</p></Card>
  </div>}
  {tab&&tab!=='Network'&&<NodeController key={JSON.stringify(target)} target={target} permitted={permitted} tab={tab} master={master} localSupported={local.data?.localValidatorSupported===true}/>}
 </NodeNetworkPanelFrame>;
}
