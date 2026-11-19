import React,{useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {gatewayCapability,gatewayPrepareParameters,gatewaySignParameters} from './gateway-admission.js';

export function GatewayAdmission({state,disabled,pending,results,perform}){
 const [enrollmentJson,setEnrollment]=useState(''),[purposeJson,setPurpose]=useState(''),[requestId,setRequest]=useState(''),[error,setError]=useState(''),[checking,setChecking]=useState(false);
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 if(!state?.operations?.some(row=>row.operation==='gateway_admission_status'&&row.kind==='read'))return null;
 const rows=Object.values(results).filter(row=>row.operation?.startsWith('gateway_admission_'));
 const latest=rows.sort((a,b)=>b.receivedAt-a.receivedAt)[0];
 const review=latest?.response;
 const blocked=disabled||checking;
 async function prepare(){setError('');setChecking(true);try{const parameters=await gatewayPrepareParameters({enrollmentJson,purposeJson});if(active.current)await perform('gateway_admission_prepare',parameters);}catch(e){if(active.current)setError(e.message);}finally{if(active.current)setChecking(false);}}
 function sign(){try{setError('');perform('gateway_admission_sign',gatewaySignParameters(review));}catch(e){setError(e.message);}}
 return <Card title="Engineering gateway admission">
  <p>Admission authorizes only the reviewed gateway identity and signed network origin. It does not commission or start a gateway, expose validator RPC, or change Wallet trust. Production remains unqualified.</p>
  <button type="button" disabled={blocked||!gatewayCapability(state,'gateway_admission_status')} onClick={()=>perform('gateway_admission_status')}>Read gateway admission</button>
  {gatewayCapability(state,'gateway_admission_prepare')&&<>
   <label>Public gateway enrollment JSON<textarea rows={5} maxLength={128*1024} value={enrollmentJson} disabled={blocked} onChange={e=>setEnrollment(e.target.value)}/></label>
   <label>Independent public gateway purpose approval JSON<textarea rows={5} maxLength={16384} value={purposeJson} disabled={blocked} onChange={e=>setPurpose(e.target.value)}/></label>
   <button type="button" disabled={blocked||!enrollmentJson||!purposeJson} onClick={prepare}>Review and prepare exact gateway admission</button>
  </>}
  {gatewayCapability(state,'gateway_admission_sign')&&review?.pending&&!review.signed&&<button type="button" disabled={blocked} onClick={sign}>Review and sign gateway admission once</button>}
  {gatewayCapability(state,'gateway_admission_export')&&review?.signed&&<button type="button" disabled={blocked} onClick={()=>perform('gateway_admission_export')}>Read verified public gateway admission export</button>}
  {gatewayCapability(state,'gateway_admission_reconcile')&&<>
   <label>Original gateway request SHA256<input value={requestId} maxLength={64} disabled={blocked} onChange={e=>setRequest(e.target.value)}/></label>
   <button type="button" disabled={blocked||!/^[0-9a-f]{64}$/.test(requestId)} onClick={()=>perform('gateway_admission_reconcile',{request_sha256:requestId})}>Reconcile exact original gateway request</button>
  </>}
  {pending?.startsWith('gateway_admission_')&&<p>Waiting for the exact target. No automatic retry is sent.</p>}
  {review&&<Detail data={{receivedAt:new Date(latest.receivedAt).toISOString(),pending:review.pending,signed:review.signed,blocker:review.blocker,networkId:review.network_id,gatewayAddress:review.gateway_address,genesisSha256:review.genesis_sha256,reviewSha256:review.review_sha256,purposeApprovalSha256:review.purpose_approval_sha256,prepareRequestSha256:review.request_sha256,signRequestSha256:review.sign_request_sha256,admissionSha256:review.admission_sha256,validFromUnix:review.valid_from_unix,expiresAtUnix:review.expires_at_unix,gatewayCommissioned:false,servicesStarted:false,publicListener:false,productionQualified:false}}/>}
  {latest?.operation==='gateway_admission_export'&&review?.admission_json&&<label>Verified public admission JSON<textarea readOnly rows={6} value={review.admission_json}/></label>}
  <ErrorMessage error={error}/>
 </Card>;
}
