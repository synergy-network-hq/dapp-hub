import React,{useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {gatewayTargetCapability,gatewayInstallParameters,gatewayGenerateParameters,gatewayCommissionParameters} from './gateway-target.js';

export function GatewayTarget({state,form,disabled,pending,results,perform}){
 const [admissionJson,setAdmission]=useState(''),[configurationJson,setConfiguration]=useState(''),[requestId,setRequest]=useState(''),[error,setError]=useState(''),[checking,setChecking]=useState(false);
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 if(!state?.operations?.some(row=>row.operation==='gateway_target_status'||row.operation==='gateway_install'))return null;
 const rows=Object.values(results).filter(row=>row.operation?.startsWith('gateway_target_'));
 const latest=rows.sort((a,b)=>b.receivedAt-a.receivedAt)[0],view=latest?.response;
 const blocked=disabled||checking;
 function install(operation){try{setError('');perform(operation,gatewayInstallParameters(form));}catch(e){setError(e.message);}}
 function generate(){try{setError('');perform('gateway_target_generate',gatewayGenerateParameters(view));}catch(e){setError(e.message);}}
 async function commission(){setError('');setChecking(true);try{const parameters=await gatewayCommissionParameters({admissionJson,configurationJson});if(active.current)await perform('gateway_target_commission',parameters);}catch(e){if(active.current)setError(e.message);}finally{if(active.current)setChecking(false);}}
 return <Card title="Engineering gateway target">
  <p>The gateway creates its own APQE custody on the selected host. Only public enrollment and admission data move between hosts. Commissioning keeps services stopped and public RPC closed.</p>
  {!state.installed&&<>
   <button type="button" disabled={blocked||!gatewayTargetCapability(state,'gateway_install_preflight')} onClick={()=>install('gateway_install_preflight')}>Verify staged gateway software</button>
   <button type="button" disabled={blocked||!gatewayTargetCapability(state,'gateway_install')} onClick={()=>install('gateway_install')}>Review and install gateway software</button>
  </>}
  <button type="button" disabled={blocked||!gatewayTargetCapability(state,'gateway_target_preflight')} onClick={()=>perform('gateway_target_preflight')}>Verify signed gateway origin</button>
  <button type="button" disabled={blocked||!gatewayTargetCapability(state,'gateway_target_status')} onClick={()=>perform('gateway_target_status')}>Read or recover gateway custody</button>
  {gatewayTargetCapability(state,'gateway_target_generate')&&view?.state==='ready'&&<button type="button" disabled={blocked} onClick={generate}>Review and generate gateway custody once</button>}
  {gatewayTargetCapability(state,'gateway_target_export')&&['identity_ready','commissioned'].includes(view?.state)&&<button type="button" disabled={blocked} onClick={()=>perform('gateway_target_export')}>Read public gateway enrollment</button>}
  {gatewayTargetCapability(state,'gateway_target_commission')&&view?.state==='identity_ready'&&<>
   <label>Signed public gateway admission JSON<textarea rows={5} maxLength={128*1024} value={admissionJson} disabled={blocked} onChange={e=>setAdmission(e.target.value)}/></label>
   <label>Reviewed public gateway configuration JSON<textarea rows={5} maxLength={64*1024} value={configurationJson} disabled={blocked} onChange={e=>setConfiguration(e.target.value)}/></label>
   <button type="button" disabled={blocked||!admissionJson||!configurationJson} onClick={commission}>Verify and commission gateway custody once</button>
  </>}
  {(gatewayTargetCapability(state,'gateway_target_reconcile')||gatewayTargetCapability(state,'gateway_install_status'))&&<>
   <label>Original gateway target request SHA256<input maxLength={64} value={requestId} disabled={blocked} onChange={e=>setRequest(e.target.value)}/></label>
   {gatewayTargetCapability(state,'gateway_target_reconcile')&&<button type="button" disabled={blocked||!/^[0-9a-f]{64}$/.test(requestId)} onClick={()=>perform('gateway_target_reconcile',{request_sha256:requestId})}>Reconcile exact gateway target request</button>}
   {gatewayTargetCapability(state,'gateway_install_status')&&<button type="button" disabled={blocked||!/^[0-9a-f]{64}$/.test(requestId)} onClick={()=>perform('gateway_install_status',{request_sha256:requestId})}>Verify original gateway installation</button>}
  </>}
  {(pending?.startsWith('gateway_target_')||pending==='gateway_install')&&<p>Waiting for the selected host. No automatic retry or custody regeneration is sent.</p>}
  {view&&<Detail data={{receivedAt:new Date(latest.receivedAt).toISOString(),state:view.state,available:view.available,blocker:view.blocker,networkId:view.network_id,chainId:view.chain_id,rawGenesisSha256:view.genesis_sha256,gatewayAddress:view.gateway_address,enrollmentSha256:view.enrollment_sha256,generationRequestSha256:view.generation_request_sha256,commissionRequestSha256:view.commission_request_sha256,admissionSha256:view.admission_sha256,configurationSha256:view.configuration_sha256,transportCustodyVerified:view.transport_custody_verified,servicesStarted:false,publicListener:false,productionQualified:false}}/>}
  {latest?.operation==='gateway_target_export'&&view?.enrollment_json&&<label>Verified public enrollment JSON<textarea rows={6} readOnly value={view.enrollment_json}/></label>}
  <ErrorMessage error={error}/>
 </Card>;
}
