import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkTransport} from './native-services.js';
import {transportStagingView} from './transport-workflow.js';

export function TransportFormation({target,disabled,onMutation}){
 const [review,setReview]=useState(null),[pending,setPending]=useState(null),[error,setError]=useState(''),[exported,setExported]=useState(null),[staged,setStaged]=useState(null);
 const epoch=useRef(0),lock=useRef(false),mounted=useRef(true);
 const targetKey=JSON.stringify(target);
 useEffect(()=>{epoch.current++;setReview(null);setExported(null);setStaged(null);setError('');},[targetKey]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function perform(operation){
  if(disabled||lock.current)return;
  lock.current=true;const generation=epoch.current;setPending(operation);setError('');if(operation==='stage')setStaged(null);
  try{
   const result=await nodeNetworkTransport(target,operation,review?.review_sha256??null);
   if(result===null)return;
   if(operation==='prepare'||operation==='sign'||operation==='stage')onMutation();
   if(!mounted.current||epoch.current!==generation)return;
   if(operation==='stage')setStaged(transportStagingView(result));
   else if(operation==='export')setExported(result);
   else{
    if(result?.schema!=='nodenetwork-network-transport-v1'||typeof result.pending!=='boolean'||(result.pending&&(typeof result.signed!=='boolean'||result.runtime_admission!==false||result.fleet_readiness_verified!==false)))throw Error('Unsupported transport review. No readiness is inferred.');
    setReview(result);setExported(null);
   }
  }catch(failure){if(mounted.current&&epoch.current===generation)setError(failure?.message||'Transport result unavailable. Read status before retrying.');}
  finally{lock.current=false;if(mounted.current){setPending(null);}}
 }
 return <Card title="Prepare authenticated validator transport">
  <p>After binding all five identities and connecting their VPNs, select the public transport request for this signed formation. Review the exact registry before signing it with the separate APQE issuer.</p>
  <div className="button-row">
   <button type="button" disabled={disabled||!!pending} onClick={()=>perform('status')}>Read transport status</button>
   <button type="button" disabled={disabled||!!pending||review?.pending!==false} onClick={()=>perform('prepare')}>Prepare transport registry</button>
   <button type="button" disabled={disabled||!!pending||review?.pending!==true||review?.signed!==false} onClick={()=>perform('sign')}>Review and sign transport registry</button>
   <button type="button" disabled={disabled||!!pending||review?.signed!==true} onClick={()=>perform('export')}>Export public commissioning drafts</button>
   <button type="button" disabled={disabled||!!pending} onClick={()=>perform('stage')}>Review and stage signed transport for selected target</button>
  </div>
  <p>To stage a validator, select its controller above. Portal retrieves and verifies the retained coordinator's signed formation and transport records, matches this validator's bound identity, and asks for native confirmation of the eight exact public files. Exported renderer data cannot authorize staging.</p>
  {pending&&<p role="status">{pending==='status'?'Reading authenticated transport state…':'Waiting for the native operation. Inspect status after an uncertain result; do not repeat it.'}</p>}
  {error&&<ErrorMessage message={error}/>}
  {review&&<Detail data={review}/>}
  {exported&&<Detail data={exported}/>}
  {staged&&<Detail data={staged}/>}
  <p>Transport issuance does not prove peer connectivity, staking, runtime admission or consensus participation. Commissioning remains blocked until the actual readiness checks pass.</p>
 </Card>;
}
