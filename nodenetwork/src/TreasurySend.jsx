import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkTreasurySend} from './native-services.js';
import {treasuryTransfer,treasuryQuote,treasuryPrepared,treasuryObservation,treasuryPhase,treasurySendError,treasuryNotApplied} from './treasury-send.js';
export function TreasurySend({target,disabled}){
 const [receiver,setReceiver]=useState(''),[amount,setAmount]=useState(''),[nonce,setNonce]=useState(''),[quote,setQuote]=useState(null),[prepared,setPrepared]=useState(null),[observation,setObservation]=useState(null),[accounts,setAccounts]=useState(null),[phase,setPhase]=useState(null),[pending,setPending]=useState(null),[error,setError]=useState('');
 const generation=useRef(0),lock=useRef(false),mounted=useRef(true);const key=JSON.stringify(target);
 useEffect(()=>{generation.current++;setQuote(null);setPrepared(null);setObservation(null);setAccounts(null);setPhase(null);setError('');setNonce('');},[key]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function edit(set,value){generation.current++;set(value);setQuote(null);setPrepared(null);setObservation(null);setAccounts(null);setPhase(null);setError('');}
 async function perform(operation){
  if(disabled||lock.current)return;lock.current=true;const scope=generation.current;setPending(operation);setError('');setPhase(null);
  try{
   let parameters;
   if(operation==='quote')parameters=treasuryTransfer(receiver,amount);
   else if(operation==='prepare'){if(!quote)throw Error('Read a fresh native quote first.');parameters={quote_sha256:quote.quote_sha256};}
   else{if(!/^(0|[1-9][0-9]*)$/.test(nonce)||!Number.isSafeInteger(Number(nonce)))throw Error('Enter the original immutable intent nonce.');parameters={nonce:Number(nonce)};}
   const value=await nodeNetworkTreasurySend(target,operation,parameters);if(value===null||!mounted.current||scope!==generation.current)return;
   if(operation==='quote'){const v=treasuryQuote(value);setQuote(v);setNonce(String(v.nonce));setPrepared(null);setObservation(null);setAccounts(null);}
   else if(operation==='prepare'){const v=treasuryPrepared(value);if(v.request_sha256!==quote.quote_sha256)throw Error('Prepared intent differs from reviewed native quote.');setPrepared(v);setQuote(null);}
   else if(operation==='phase'){setPhase(treasuryPhase(value));setQuote(null);}
   else if(operation==='verify_not_applied'){setPhase(treasuryNotApplied(value));setQuote(null);setPrepared(null);setObservation(null);setAccounts(null);}
   else{const v=treasuryObservation(value);setPrepared(v.prepared);setObservation(v.finalized_observation);setAccounts(v.account_observations);setQuote(null);}
  }catch(e){if(mounted.current&&scope===generation.current){if(operation==='prepare')setQuote(null);setError(treasurySendError(e));}}
  finally{lock.current=false;if(mounted.current)setPending(null);}
 }
 const blocked=disabled||!!pending;
 return <Card title="Ordinary engineering test transfer">
  <p>Use the funded ordinary syna treasury on its formation coordinator after the validator has finalized account state. Encryption authority is verified from signed formation Genesis and its authenticated autonomous epoch lineage. Missing lineage fails closed. This is not a protected SynW account or rewards activation.</p>
  <label>Ordinary recipient<input value={receiver} disabled={blocked} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e=>edit(setReceiver,e.target.value)}/></label>
  <label>Test amount (integer nWei)<input value={amount} disabled={blocked} inputMode="numeric" onChange={e=>edit(setAmount,e.target.value)}/></label>
  <div className="button-row"><button disabled={blocked} onClick={()=>perform('quote')}>Read authenticated treasury quote</button><button disabled={blocked||!quote} onClick={()=>perform('prepare')}>Review and prepare encrypted intent</button></div>
  {quote&&<Detail data={quote}/>}
  <label>Original intent nonce<input value={nonce} disabled={blocked} inputMode="numeric" onChange={e=>{generation.current++;setNonce(e.target.value);setPrepared(null);setObservation(null);setAccounts(null);setPhase(null);setQuote(null);}}/></label>
  <div className="button-row"><button disabled={blocked} onClick={()=>perform('status')}>Reconcile original treasury intent</button><button disabled={blocked} onClick={()=>perform('phase')}>Inspect original treasury phase</button><button disabled={blocked} onClick={()=>perform('verify_not_applied')}>Verify original preparation not applied</button><button disabled={blocked||prepared?.state!=='prepared'||String(prepared.nonce)!==nonce} onClick={()=>perform('submit')}>Review one-use test transfer dispatch</button></div>
  {pending&&<p role="status">Waiting for authenticated native {pending}. No automatic retry.</p>}
  {prepared&&<><p>{observation?`Finalized RPC observation: ${observation.status} at H${observation.block_height}.`:prepared.state==='dispatch_unknown'?'Dispatch is uncertain or pending. Read the original transaction status; do not send again.':'Encrypted immutable intent prepared; no broadcast yet.'}</p><Detail data={prepared}/></>}
  {phase&&<><p>{phase.schema==='nodenetwork-native-treasury-not-applied-v1'?'Original preparation verified not applied; its unused grant is preserved. If still live, wait for grant expiry before a fresh authenticated quote and separate preparation confirmation. No automatic retry.':'Read-only inventory observation only. Complete inventory is unverified; this does not clear uncertainty or permit a retry. Nonce is operator-declared unless the retained original request matches.'}</p><Detail data={phase}/></>}
  {observation&&<Detail data={observation}/>}
  {accounts&&<><p>Sender and recipient balances observed at the same finalized transaction block by the authenticated local node. These are account observations, not independent account proofs.</p><Detail data={accounts}/></>}<ErrorMessage error={error}/>
 </Card>;
}
