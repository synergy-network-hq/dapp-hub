import {WorkspaceSetup,WorkspaceMonitoring} from './WorkspaceTasks.jsx';
import {WorkspaceOverview} from './WorkspaceOverview.jsx';
import {WorkspaceDisclosure,WorkspaceCard,WorkspaceButton,WorkspaceIcon} from './WorkspaceUI.jsx';
import {RpcReadiness} from './RpcReadiness.jsx';
import {CanaryRuntime} from './CanaryRuntime.jsx';
import {NetworkComparison} from './NetworkComparison.jsx';
import {isCanonicalTestnetRpc,CURRENT_CANARY_READ_PROFILE as CANARY_PROFILE,currentCanaryRead as canaryRead,currentCanaryProcessingStatus as canaryProcessingStatus} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {emptyProvisioningDraft,readProvisioningSnapshot,saveProvisioningDraft} from './provisioning-draft.js';
import './monitor.css';
import {ValidatorMonitor} from './ValidatorMonitor.jsx';
import {NodeWatchlist} from './NodeWatchlist.jsx';
import {validatorLookupObservation, validatorLookupPath} from './validator-lookup.js';
import {readValidatorActiveListing,readValidatorGenesisPin} from './validator-active-list.js';
import {readValidatorRpcBlock} from './validator-rpc-block.js';
import {readValidatorRecord} from './validator-record.js';
import {ValidatorRegistration} from './ValidatorRegistration.jsx';
import {useEffect,useRef,useState} from 'react';
import {useNative} from "@synergy-network/portal-native/dapp-sdk";
import {atlas,rpc,rpcValidatorRecordObservation} from "@synergy-network/portal-native/dapp-sdk";
import {nodeNetworkHostStatus,nodeNetworkReviewMaster} from "./native-services.js";
import {Card,Detail,ErrorMessage,Resource,useResource} from "@synergy-network/portal-native/dapp-sdk";
import {NodeController} from './NodeController.jsx';
import {NetworkProvisioning, useNetworkProvisioning} from './NetworkProvisioning.jsx';
import {applyValidatorProfileToDraft} from './network-provisioning.js';
import {nodeRoleCatalog} from './operator-workflow.js';
import {InstallPreflight} from './InstallPreflight.jsx';
import {MasterReview} from './MasterReview.jsx';
import {IdentityPreflight} from './IdentityPreflight.jsx';
import {InstallationDraftReview} from './InstallationDraftReview.jsx';
import {OperatorPublicKeyReview} from './OperatorPublicKeyReview.jsx';
import {SavedControllerPolicy} from './SavedControllerPolicy.jsx';
import {SavedInstallationReceipt} from './SavedInstallationReceipt.jsx';
import {CommissioningPublicEvidence} from './CommissioningPublicEvidence.jsx';
import {installPreflightChecklist} from './install-preflight.js';
import {RequestHistory} from './RequestHistory.jsx';
import {SavedValidatorObservation} from './SavedValidatorObservation.jsx';
import {Troubleshooter} from './Troubleshooter.jsx';
import {TargetDiagnostics} from './TargetDiagnostics.jsx';
import {SavedValidatorLogs} from './SavedValidatorLogs.jsx';
import {SavedValidatorAudit} from './SavedValidatorAudit.jsx';
import {SavedValidatorFleet} from './SavedValidatorFleet.jsx';
import {ReplacementRecoveryReview} from './ReplacementRecoveryReview.jsx';
import {AuthorityRecoveryReview} from './AuthorityRecoveryReview.jsx';
import {SavedUpgradeIntent} from './SavedUpgradeIntent.jsx';
import {UpgradeConfiguration} from './UpgradeConfiguration.jsx';
import {SavedValidatorPerformance} from './SavedValidatorPerformance.jsx';
import {UpdatePackage} from './UpdatePackage.jsx';
import {MaintenanceComparison} from './MaintenanceComparison.jsx';
import {VpnStatus} from './VpnStatus.jsx';
import {CustodyStatus} from './CustodyStatus.jsx';
import {OffboardingChecklist} from './Offboarding.jsx';
import {TargetSettings, useTargetSelection} from './TargetSettings.jsx';
import {hostCompatibility,hostTargetSupported} from './host-compatibility.js';
import {NodeNetworkPanelFrame,NodeNetworkPanelCard} from "./NodeNetworkPanelFrame.jsx";
import {readNodeNetwork,provisioningChecks,nodeNetworkObservationScope,legacyTestnetObservationProfile} from './nodeNetwork.js';

function HistoricalArtifactReview({children}) {
 return <section aria-label="Historical saved artifact review"><p className="native-source">Historical artifact reader: this saved profile is separate from the current lowercase Synergy installation. Unsupported artifacts remain unavailable; use the authenticated native controller for current installation state. These file reviews grant no operation authority.</p>{children}</section>;
}

export function NodeNetworkApp(){
 const n=useNative(),[section,setSection]=useState('overview');
 const targetSettings=useTargetSelection(),target=targetSettings.target;
 const [savedDraft,setSavedDraft]=useState(()=>{try{return {...readProvisioningSnapshot(),error:''};}catch{return {form:emptyProvisioningDraft(),error:'Saved provisioning draft could not be read. Original storage is retained; saving is blocked until it is recovered.'};}});
 const [form,setForm]=useState(savedDraft.form),[draftError,setDraftError]=useState(savedDraft.error),[draftNotice,setDraftNotice]=useState('');
 const [master,setMaster]=useState(null),[masterError,setMasterError]=useState(''),[reviewing,setReviewing]=useState(false);
 const profile=n.endpoint;
 const networkProvisioning = useNetworkProvisioning(target);
 const selectedNetwork = networkProvisioning.selected;
 const [switchingNetwork,setSwitchingNetwork]=useState(false),[networkError,setNetworkError]=useState('');
 async function selectNetwork(id){
  setSwitchingNetwork(true);setNetworkError('');
  try{await n.changeEndpoint(id);}catch(error){setNetworkError(error?.message||'Portal could not select the network.');}
  finally{setSwitchingNetwork(false);}
 }
 const tab=({overview:'Network',operations:'Management',setup:'Validator setup',monitoring:'Management',updates:'Updates',security:'Installation isolation',settings:'Settings'})[section];
 const navigateSection=id=>setSection(id);
 const permitted=n.permit('node','readNetwork');
 const inspectMasterPermitted=permitted&&!n.recoverySuspended;
 const targetScopeCurrent=()=>!n.recoverySuspended&&n.permit('node','readNetwork')&&hostTargetSupported(hostControl,target)&&targetSettings.targetIsCurrent();
 const legacyProfile=legacyTestnetObservationProfile(profile,isCanonicalTestnetRpc(profile));
 const indexAvailable=permitted&&Boolean(legacyProfile);
 const monitorScope=JSON.stringify([profile.id,profile.rpc,profile.chainId,profile.networkKey,profile.genesisHash,permitted]);
 const masterScope=useRef({permitted:inspectMasterPermitted,generation:0});
 if(masterScope.current.permitted!==inspectMasterPermitted)masterScope.current={permitted:inspectMasterPermitted,generation:masterScope.current.generation+1};
 useEffect(()=>{setMaster(null);setMasterError('');setReviewing(false);return()=>{masterScope.current.generation++;};},[inspectMasterPermitted]);
 async function reviewMaster(){
  if(!inspectMasterPermitted||!n.permit('node','readNetwork'))return;
  const generation=++masterScope.current.generation;
  const current=()=>masterScope.current.permitted&&masterScope.current.generation===generation&&n.permit('node','readNetwork');
  setReviewing(true);setMasterError('');setMaster(null);
  try{const value=await nodeNetworkReviewMaster();if(current())setMaster(value);}
  catch(error){if(current())setMasterError(String(error?.message||error));}
  finally{if(masterScope.current.generation===generation)setReviewing(false);}
 }
 const local=useResource(()=>{
  if(!permitted)throw new Error('Allow NodeNetwork inspection in Security & permissions.');
  return nodeNetworkHostStatus();
 },`${permitted}`);
 const hostControl=hostCompatibility(local);
 const targetSupported=hostTargetSupported(hostControl,target);
 const processing=useResource(async signal=>{
  if(!permitted||profile.id!==CANARY_PROFILE.id)return null;
  return canaryProcessingStatus(await canaryRead('synergy_getProcessingContextV1',{}, {signal}));
 },JSON.stringify([profile.id,permitted]));
 const live=useResource(signal=>{
  if(!permitted)throw new Error('Allow NodeNetwork to read public network data in Security & permissions.');
  const read=profile.id===CANARY_PROFILE.id?(method,params,options)=>canaryRead(method,params,{signal:options?.signal}):rpc;
  return readNodeNetwork(read,profile,signal);
 },nodeNetworkObservationScope(profile,permitted));
 const validators=useResource(async signal=>{
  if(!indexAvailable)return null;
  const data=await readAtlasValidators('validators?limit=100',signal);
  return {data,updatedAt:Date.now()};
 },monitorScope);
 async function readAtlasValidators(path,signal){
  if(!indexAvailable)throw Error('Atlas validator observations require read permission and the canonical Synergy Testnet RPC.');
  signal?.throwIfAborted();
  await readValidatorGenesisPin(rpc,legacyProfile,signal);
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
  if (!indexAvailable) throw Error('Select the legacy Testnet profile to read its validator index.');
  return readValidatorActiveListing(rpc, legacyProfile, address, signal);
 }
 function lookupValidatorBlock(address, row, signal) {
  if (!indexAvailable) throw Error('Indexed block attribution requires read permission and the canonical Synergy Testnet RPC.');
  return readValidatorRpcBlock(rpc, legacyProfile, address, row, signal, () => !n.recoverySuspended && n.permit('node','readNetwork'));
 }
 function lookupValidatorRecord(address, signal) {
  if (!indexAvailable) throw Error('Select the legacy Testnet profile to read its validator registry.');
  return readValidatorRecord(rpc, rpcValidatorRecordObservation, legacyProfile, address, signal,
   () => !n.recoverySuspended && n.permit('node','readNetwork'));
 }
 const refreshPublic=()=>{live.reload();if(indexAvailable)validators.reload();processing.reload();};
 const refreshing=live.loading||(indexAvailable&&validators.loading);
 return <NodeNetworkPanelFrame section={section} onSectionChange={navigateSection} statusLabel={live.loading?'Checking observation network':live.error?'Observation network error':'Public network observed'} statusTone={live.data?'blue':'gray'} onRefresh={refreshPublic} refreshing={refreshing} nodeLabel={!targetSettings.snapshot?'Target settings need review':!target?'Choose a machine':target.kind==='local'?'This machine':`${target.host}:${target.port||22}`} headerActions={<div className="native-actions"><label>Observation network<select className="scenario-select" aria-label="NodeNetwork observation network" value={profile.id} disabled={switchingNetwork} onChange={e=>selectNetwork(e.target.value)}>{n.endpoints.map(p=><option key={p.id} value={p.id}>{p.name} · {p.chainId}</option>)}</select></label><button disabled={refreshing} onClick={refreshPublic}>Refresh NodeNetwork</button></div>} statusItems={[{label:'Target root',value:target?.root||'No target selected'},{label:'Observation network',value:profile.name},{label:'Chain ID',value:profile.chainId},{label:'Enrollment policy',value:'Not verified'}]}>
  {section==='settings'&&<TargetSettings selection={targetSettings} local={local}/>}
  {section==='settings'&&<NetworkProvisioning profiles={networkProvisioning} target={target}/>}

  <ErrorMessage error={networkError}/>
  {section==='operations'&&<div className="workspace-task-intro"><WorkspaceIcon name="server" size={28}/><div><strong>{target?target.kind==='local'?'This computer':`${target.host}:${target.port||22}`:'No machine selected'}</strong><p>Inspect the exact target below before reviewing service, identity or VPN operations.</p></div><WorkspaceButton onClick={()=>navigateSection('settings')}>Target settings</WorkspaceButton></div>}
  {section==='performance'?<><SavedValidatorPerformance permitted={permitted}/><NodeNetworkPanelCard title="Validator performance telemetry">
   <p>Logs &amp; Diagnostics can read an enrolled controller's service counters and storage snapshot. Managed telemetry history and duty timing require a supported telemetry interface.</p>
   <button onClick={()=>setSection('logs')}>Open Logs &amp; Diagnostics</button>
   <p>Use public validator lookup in Overview to review attributed Atlas blocks and their receipt time.</p>
   <button onClick={()=>setSection('overview')}>Open public validator observations</button>
  </NodeNetworkPanelCard></>:section==='logs'?<>
   <TargetDiagnostics key={JSON.stringify([target,permitted])} target={target} permitted={permitted} targetScopeCurrent={targetScopeCurrent}/>
   <WorkspaceDisclosure title="Saved logs and audit evidence" description="Read files captured earlier; they are separate from current host diagnostics."><SavedValidatorLogs permitted={permitted}/>
   <SavedValidatorAudit permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/>
   <HistoricalArtifactReview><ReplacementRecoveryReview form={form} permitted={inspectMasterPermitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   <HistoricalArtifactReview><AuthorityRecoveryReview form={form} permitted={inspectMasterPermitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   </WorkspaceDisclosure>
   <Troubleshooter key={JSON.stringify([profile.id,profile.rpc,profile.chainId,permitted])} profile={profile} permitted={permitted} local={local} live={live} hasTarget={Boolean(target)} targetSettingsReadable={Boolean(targetSettings.snapshot)} onOpenMonitoring={()=>setSection('monitoring')} onOpenSettings={()=>setSection('settings')}/>
  </>:tab==='Network'?<WorkspaceOverview observation={live} permitted={permitted} target={target} profile={profile} onNavigate={navigateSection} onRefresh={refreshPublic}>
   <WorkspaceDisclosure title="Public network details" description="Review source identity, processing context and detailed RPC observations.">
   {profile.id===CANARY_PROFILE.id&&<Card title="Pinned Canary processing context"><Resource value={processing}>{value=>value&&<Detail data={value}/>}</Resource><p>Network and Genesis checks apply to gateway reads. This is not validator eligibility or release approval.</p></Card>}
   <Card title="Observation sources">
    <p>Public RPC observations use the selected endpoint. Atlas validator observations use the canonical Synergy Testnet transport.</p>
    {target
     ? <><p>A target is configured. Open Monitoring to inspect its native controller.</p><button onClick={()=>setSection('monitoring')}>Open target monitoring</button></>
     : <><p>Monitor-only · Host selection deferred.</p><button onClick={()=>setSection('settings')}>Review target settings</button></>}
   </Card>
   {profile.id===CANARY_PROFILE.id?<CanaryRuntime observation={live} permitted={permitted&&!n.recoverySuspended}/>:<RpcReadiness profile={profile} permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/>}
   <NetworkComparison profile={profile} profiles={n.endpoints} permitted={permitted} onOpenEndpoints={()=>n.navigate('network/endpoints')}/>
   {indexAvailable&&<div className="node-read-monitor"><Card title="Legacy Testnet validator index">
    <Resource value={validators}>{value=><><SourceAge updatedAt={value.updatedAt}/><ValidatorMonitor data={value.data}/></>}</Resource>
   </Card></div>}
   {indexAvailable&&<div className="node-read-monitor">
    <NodeWatchlist key={monitorScope} data={validators.data?.data} updatedAt={validators.data?.updatedAt} readValidator={lookupValidator} readActiveListing={lookupActiveListing} readValidatorBlock={lookupValidatorBlock}/>
   </div>}
   <p className="native-source">Public RPC observations from {profile.rpc}. These observations do not authenticate a provisioning target or approve enrollment.</p>
   <Resource value={live}>{data=><div className="native-grid"><Card title="Chain"><SourceAge updatedAt={data.chainReceivedAt} source="Selected public RPC chain-status read"/><Detail data={{network:profile.name,chainId:data.chain.chain_id,ready:data.chain.ready,lifecycle:data.chain.lifecycle,checkedAt:new Date(data.checkedAt).toLocaleString()}}/></Card>{['node','posy','sync'].map(name=><Card key={name} title={{node:'RPC node',posy:'PoSy consensus',sync:'Synchronization'}[name]}>{data.errors[name]?<ErrorMessage error={data.errors[name]}/>:<><SourceAge updatedAt={data.receivedAt?.[name]} source={`Selected public RPC ${name} observation`}/><Detail data={data.observations[name]}/></>}</Card>)}</div>}</Resource>
  </WorkspaceDisclosure></WorkspaceOverview>:tab==='Validator setup'?<WorkspaceSetup><TargetSettings selection={targetSettings} local={local}/>
   <WorkspaceDisclosure title="Choose a node role" description="Available roles come from the reviewed master; unsupported roles stay unavailable." open>
   <Card title="Node roles"><ul className="node-role-catalog">{nodeRoleCatalog(master?.roleCatalog).map(role=><li key={role.id}><strong>{role.label}</strong><span>{role.description}</span>{role.id==='validator'?<small>Guided setup below. Requires admission and target authorization.</small>:<small>Provisioning is unavailable.</small>}</li>)}</ul></Card>
   </WorkspaceDisclosure>
   <WorkspaceDisclosure title="Prepare a validator" description="Save a draft, review the exact package and confirm the installation prerequisites." open>
   {indexAvailable&&<ValidatorRegistration key={monitorScope} permitted={permitted} testnet readRecord={lookupValidatorRecord}/>}
   <Card title="Provisioning draft">{selectedNetwork && <button type="button" onClick={()=>{setForm(applyValidatorProfileToDraft(form,selectedNetwork));setDraftNotice('Selected network values applied to this draft. Review the native signed artifacts before installing.');}}>Use {selectedNetwork.network_name} profile</button>}<p>Prepare package and network references before choosing a host. A saved draft is local presentation data, not a signed plan, approval or queued job. It never resumes an operation automatically.</p>{[['release_id','Approved release ID'],['manifest_sha256','Approved manifest SHA-256'],['network_id','Approved network incarnation'],['chain_id','Approved chain ID'],['node_name','Validator node name']].map(([key,label])=><label key={key}>{label}<input value={form[key]} maxLength={128} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event=>{setForm({...form,[key]:event.target.value});setDraftNotice('');}}/></label>)}<p>Draft input checks validate formatting only. They do not approve the release, network, enrollment, host prerequisites or execution.</p><ul aria-label="Provisioning draft input checks">{provisioningChecks(form).map(check=><li key={check.field}>{check.label}: {check.valid?'Format accepted; approval not verified':check.message}</li>)}</ul><button onClick={()=>{try{if(savedDraft.error)throw Error(savedDraft.error);const saved=saveProvisioningDraft(form,savedDraft.raw);setSavedDraft({...saved,error:''});setDraftError('');setDraftNotice('Draft saved on this device. No host or operation was authorized.');}catch(error){setDraftNotice('');setDraftError(String(error?.message||'Draft could not be saved. Your edits and the prior saved record are retained.'));}}}>Save provisioning draft</button><p>Replacing your draft below discards the unsaved field values and reads the saved local copy. It does not choose a host or resume work.</p><button onClick={()=>{try{const saved=readProvisioningSnapshot();setSavedDraft({...saved,error:''});setForm(saved.form);setDraftError('');setDraftNotice('Saved copy loaded. No operation was resumed.');}catch(error){setDraftNotice('');setDraftError(String(error?.message||'Saved copy unavailable. Your draft is retained.'));}}}>Replace draft with saved copy</button><ErrorMessage error={draftError}/>{draftNotice&&<p role="status">{draftNotice}</p>}</Card>
   <Card title="Standardized validator installation">{!target&&<p>Host selection remains deferred.</p>}<p>Every validator must use the same qualified master package. Its identity, APQE custody, authenticated network configuration, blockchain data, recovery material and update staging belong inside /opt/synergy.</p><ol><li>Authenticate the operator, target host and approved release.</li><li>Check host prerequisites and installation isolation.</li><li>Provision independent APQE role keys into local custody.</li><li>Verify authenticated Genesis, membership and transport authority.</li><li>Install through the shared lifecycle and verify restart, synchronization and finality.</li></ol></Card>
   <InstallationDraftReview form={form}/>
   <OperatorPublicKeyReview target={target} permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')&&(!target||targetScopeCurrent())}/>
   </WorkspaceDisclosure>
   <WorkspaceDisclosure title="Advanced identity and saved evidence" description="Optional historical file reviews do not grant operation authority.">
   <HistoricalArtifactReview><SavedControllerPolicy form={form} permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   <HistoricalArtifactReview><SavedInstallationReceipt form={form} permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   <HistoricalArtifactReview><CommissioningPublicEvidence form={form} master={master} permitted={inspectMasterPermitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   {!target&&<InstallPreflight checklist={installPreflightChecklist({form,permitted,master})}
    action={<button disabled={!permitted} onClick={()=>setSection('monitoring')}>Review saved preflight evidence</button>}/>}
   {!target&&<IdentityPreflight permitted={permitted} canReviewFiles={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/>}
   </WorkspaceDisclosure>
   <WorkspaceDisclosure title="Master package and host compatibility" description="Inspect the approved software and local runtime support.">
   <MasterReview permitted={inspectMasterPermitted} reviewing={reviewing} master={master} error={masterError} onInspect={reviewMaster}/>
   <Card title="Local runtime compatibility"><Resource value={local}>{data=>data?<Detail data={data}/>:<p>No host inspection was returned.</p>}</Resource></Card>

   </WorkspaceDisclosure>
  </WorkspaceSetup>:tab==='Management'?null:tab==='Updates'?<>
   <UpdatePackage form={form} setForm={setForm}/>
   <MasterReview permitted={inspectMasterPermitted} reviewing={reviewing} master={master} error={masterError} onInspect={reviewMaster} updateDraft={form}/>
   <HistoricalArtifactReview><SavedUpgradeIntent form={form} permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   <UpgradeConfiguration form={form} permitted={permitted&&!n.recoverySuspended} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/>
   <HistoricalArtifactReview><ReplacementRecoveryReview form={form} permitted={inspectMasterPermitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   <HistoricalArtifactReview><AuthorityRecoveryReview form={form} permitted={inspectMasterPermitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></HistoricalArtifactReview>
   <MaintenanceComparison permitted={permitted}/>
  </>:tab==='Settings'?<WorkspaceCard title="Workspace preferences"><p className="small muted">The selected target above is saved locally. Selecting a network in the header changes observations; it never changes an installed node's chain.</p><div className="kv-row"><span>Observation network</span><strong>{profile.name} · {profile.chainId}</strong></div><div className="kv-row"><span>Managed target</span><strong>{target?target.kind==='local'?'This computer':target.host:'Not selected'}</strong></div><div className="row gap-12 wrap"><WorkspaceButton icon="download" onClick={()=>navigateSection('updates')}>Review updates</WorkspaceButton><WorkspaceButton icon="shield" onClick={()=>navigateSection('security')}>Security &amp; recovery</WorkspaceButton></div></WorkspaceCard>:<div className="workspace-flow">
   <WorkspaceDisclosure title="Installation isolation" description="Review the canonical root and attributed host integrations." open>
   <Card title="Single-root contract"><Detail data={{installationRoot:'/opt/synergy',software:'/opt/synergy/bin',configuration:'/opt/synergy/config',custody:'/opt/synergy/keys/apqe',network:'/opt/synergy/network',vpnState:'/opt/synergy/vpn',blockchainState:'/opt/synergy/data',recovery:'/opt/synergy/recovery',updateStaging:'/opt/synergy/tmp',temporaryFiles:'/opt/synergy/tmp',runtime:'/opt/synergy/run',serviceDefinitions:'/opt/synergy/systemd',logs:'/opt/synergy/logs'}}/><p>Every node-owned file and directory must stay inside this root on both local and remote targets. External release, custody, VPN, checkpoint, staging or diagnostic files fail installation qualification. Any operating-system registration must reference definitions inside this root and be included in the isolation audit.</p></Card>
   <Card title="Audit status"><p>A host isolation audit is required before installation and after every update. Inspect the target inventory and conformance results below; a configured target is not automatically marked compliant.</p><p>Removing NodeNetwork from Portal does not uninstall a validator or delete chain state, keys or signing journals.</p></Card>
   </WorkspaceDisclosure>
   <WorkspaceDisclosure title="Remove or retire a node" description="Destructive operations require exact native review and verified VPN retirement.">
   <OffboardingChecklist permitted={inspectMasterPermitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')} onOpenHistory={()=>setSection('logs')}/>
   </WorkspaceDisclosure>
  </div>}
  {section!=='monitoring'&&section!=='setup'&&tab&&tab!=='Network'&&!target&&<Card title="Host selection deferred"><p>No target controller will be contacted until you explicitly save a target in Settings. Public network observations do not select or authenticate a host.</p><button onClick={()=>setSection('settings')}>Review target settings</button></Card>}
  {section==='monitoring'&&<WorkspaceMonitoring target={target} permitted={permitted} onNavigate={navigateSection}/>}
  {tab==='Management'&&<WorkspaceDisclosure title="Saved fleet and observations" description="Review public saved files separately from current authenticated host observations."><SavedValidatorFleet permitted={permitted} canRead={()=>!n.recoverySuspended&&n.permit('node','readNetwork')}/></WorkspaceDisclosure>}
  {tab==='Management'&&<WorkspaceDisclosure title="Saved node observations" description="Imported evidence is separate from current host health."><SavedValidatorObservation permitted={permitted} onOpenDiagnostics={()=>setSection('logs')}/></WorkspaceDisclosure>}
  {['Management','Validator setup'].includes(tab)&&!target&&<WorkspaceDisclosure title="VPN observations" description="Check connectivity through an authenticated target."><VpnStatus onOpenDiagnostics={()=>setSection('logs')}/></WorkspaceDisclosure>}
  {tab==='Management'&&!target&&<WorkspaceDisclosure title="Identity and custody observations"><CustodyStatus onOpenHistory={()=>setSection('logs')}/></WorkspaceDisclosure>}
  {(tab==='Management'||section==='logs')&&<WorkspaceDisclosure title="Operation history" description="Original requests and uncertain outcomes remain available for reconciliation."><RequestHistory permitted={permitted} target={target} targetScopeCurrent={targetScopeCurrent}/></WorkspaceDisclosure>}
  {target&&tab&&tab!=='Network'&&!targetSupported&&<Card title="Target management unavailable"><p>{hostControl.message}</p><p>The saved target is retained. No target operation was resumed.</p></Card>}
  {target&&targetSupported&&tab&&tab!=='Network'&&tab!=='Settings'&&<WorkspaceDisclosure title="Native node operations" description="Inspect first, then review each operation against the exact target. Uncertain outcomes require reconciliation." open={tab==='Management'}><NodeController key={`${JSON.stringify(target)}:${permitted}`} target={target} form={form} setForm={setForm} validatorProfile={selectedNetwork} permitted={permitted} tab={tab} master={master} localSupported={hostControl.local} operatorCredentialSupported={local.data?.platform==='macos'} onOpenDiagnostics={()=>setSection('logs')}
   onSelectTarget={targetSettings.selectTarget} targetScopeCurrent={targetScopeCurrent}/></WorkspaceDisclosure>}
 </NodeNetworkPanelFrame>;
}
