import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkTreasury} from './native-services.js';

export function TreasuryFormation({target,disabled,onMutation}){
 const [review,setReview]=useState(null),[exported,setExported]=useState(null),[pending,setPending]=useState(null),[error,setError]=useState('');
 const lock=useRef(false),generation=useRef(0),mounted=useRef(true);const key=JSON.stringify(target);
 useEffect(()=>{generation.current++;setReview(null);setExported(null);setError('');},[key]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function perform(operation){
  if(disabled||lock.current)return;lock.current=true;const current=generation.current;setPending(operation);setError('');
  try{const result=await nodeNetworkTreasury(target,operation);if(result===null)return;
   if(operation==='prepare')onMutation();if(!mounted.current||current!==generation.current)return;
   if(operation==='export')setExported(result.canary_testing_treasury);else{setReview(result);setExported(null);}
  }catch(e){if(mounted.current&&current===generation.current)setError(e?.message||'Treasury outcome unavailable. Read status before any further action.');}
  finally{lock.current=false;if(mounted.current)setPending(null);}
 }
 return <Card title="Ordinary engineering treasury">
  <p>On the formation coordinator, create one ordinary syna test treasury before preparing Genesis. Native review binds its network, formation and effective time. Encrypted FN-DSA-1024 and ML-DSA-87 custody stays inside that coordinator’s Synergy root.</p>
  <div className="button-row">
   <button type="button" disabled={disabled||!!pending} onClick={()=>perform('status')}>Read or recover treasury status</button>
   <button type="button" disabled={disabled||!!pending||review?.pending!==false} onClick={()=>perform('prepare')}>Review and prepare ordinary treasury</button>
   <button type="button" disabled={disabled||!!pending||review?.possession_verified!==true} onClick={()=>perform('export')}>Export public Genesis treasury field</button>
  </div>
  {pending&&<p role="status">{pending==='status'?'Reading verified coordinator custody…':'Waiting for native review. Uncertain operations are reconciled, never automatically repeated.'}</p>}
  {error&&<ErrorMessage message={error}/>}{review&&<Detail data={review}/>}
  {exported&&<><p>Saved public recipe JSON. Add its exact canary_testing_treasury field to the recipe before the separate Genesis review and signing step.</p><Detail data={{canary_testing_treasury:exported}}/></>}
  <p>This is a single-authority test account, not protected SynW. The 5,000,000,000,000,000 nWei test allocation exists only after that exact public carrier is included in verified signed Genesis. No spending operation is exposed here.</p>
 </Card>;
}
