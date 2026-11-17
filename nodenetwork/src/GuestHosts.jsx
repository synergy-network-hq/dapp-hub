import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';

// invokeGuest must be the host SDK's serialized native operation wrapper. No
// browser fallback, generic command executor, or direct SSH is supported here.
export function GuestHosts({target,disabled,invokeGuest,invokeConfigureGuest,onSelectGuest,onMutation=()=>{}}){
 const [guestId,setGuestId]=useState(''),[observed,setObserved]=useState(null),[pending,setPending]=useState(''),[error,setError]=useState(''),[uncertain,setUncertain]=useState('');
 const generation=useRef(0),locked=useRef(false),mounted=useRef(true);
 const key=JSON.stringify(target);
 useEffect(()=>{generation.current++;setObserved(null);setError('');setUncertain('');},[key,guestId]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const validId=/^[a-z][a-z0-9-]{0,31}$/.test(guestId);
 const available=typeof invokeGuest==='function'&&!disabled&&validId&&!pending;
 async function configure(){
  if(disabled||locked.current||(uncertain&&uncertain!=='configure')||!invokeConfigureGuest)return;
  locked.current=true;const epoch=generation.current;setPending('configure');setError('');
  try{const result=await invokeConfigureGuest(target);if(result===null)return;
   onMutation();if(!mounted.current||generation.current!==epoch)return;
   if(result.schema!=='nodenetwork-guest-configuration-v1'||result.configured!==true||result.guest_created!==false)throw Error('Invalid native guest configuration receipt.');
   setGuestId(result.guest_id);setObserved(null);
  }catch(failure){if(mounted.current&&generation.current===epoch){setError(failure?.message||'Guest policy outcome uncertain.');setUncertain('configure');}}
  finally{locked.current=false;if(mounted.current)setPending('');}
 }
 async function perform(operation){
  if(!available||locked.current||(uncertain&&!['status','preflight'].includes(operation)))return;
  locked.current=true;const epoch=generation.current;setPending(operation);setError('');
  const mutation=['create','stop','remove'].includes(operation);
  try{
   if(operation==='select'){await onSelectGuest(target,guestId);return;}
   const result=await invokeGuest(target,operation,guestId);
   if(result===null)return;
   if(mutation)onMutation();
   if(!mounted.current||generation.current!==epoch)return;
   const expected=operation==='preflight'?'nodenetwork-guest-preflight-v1':'nodenetwork-guest-status-v1';
   if(result?.schema!==expected||(operation==='preflight'?result.selection?.guest_id:result.guest_id)!==guestId)throw Error('Native guest result does not match the selected target and guest.');
   setObserved(result);
   // Status permits inspection, not an automatic replay. An uncertain mutation
   // remains fenced until the native journal establishes its verified outcome.
   if(mutation||(operation==='status'&&uncertain==='create'&&result.phase==='created'))setUncertain('');
  }catch(failure){if(mounted.current&&generation.current===epoch){setError(failure?.message||'Guest outcome unavailable. Read status before proceeding.');if(mutation)setUncertain(operation);}}
  finally{locked.current=false;if(mounted.current)setPending('');}
 }
 const exists=observed?.schema==='nodenetwork-guest-status-v1'&&observed.exists===true;
 return <Card title="Managed isolated Linux guest">
  <p>Select the physical host above, then enter its independently approved guest identifier. The master verifies the exact contained OS image, tools, firmware and resource quota. No image download or validator installation is performed.</p>
  <label>Approved guest identifier <input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={guestId} maxLength={32} disabled={disabled||!!pending} onChange={event=>setGuestId(event.target.value)} autoComplete="off"/></label>
  <div className="button-row">
   <button type="button" disabled={disabled||!!pending||(!!uncertain&&uncertain!=='configure')||!invokeConfigureGuest} onClick={configure}>{uncertain==='configure'?'Reconcile exact guest configuration':'Review master-owned guest configuration'}</button>
   <button type="button" disabled={!available} onClick={()=>perform('status')}>Read guest status</button>
   <button type="button" disabled={!available||exists} onClick={()=>perform('preflight')}>Verify approved guest inputs</button>
   <button type="button" disabled={!available||uncertain||observed?.schema!=='nodenetwork-guest-preflight-v1'} onClick={()=>perform('create')}>Review and create guest</button>
   <button type="button" disabled={!available||uncertain||!onSelectGuest||observed?.phase!=='created'||observed?.service_state!=='active'||!observed?.ssh_identity_verified} onClick={()=>perform('select')}>Review host-relative guest connection</button>
   <button type="button" disabled={!available||uncertain||!exists} onClick={()=>perform('stop')}>Review and stop guest</button>
   <button type="button" disabled={!available||uncertain||!exists||observed.pid!==0||!['inactive','failed'].includes(observed.service_state)} onClick={()=>perform('remove')}>Review and remove guest disk</button>
  </div>
  {!invokeGuest&&<p>Managed guest operations require the registered native Portal adapter.</p>}
  {pending&&<p role="status">Waiting for authenticated native {pending}. No operation is replayed automatically.</p>}
  {uncertain&&<p role="alert">An operation has an uncertain outcome. Mutations are fenced. Read status and reconcile its exact native request before continuing.</p>}
  {error&&<ErrorMessage message={error}/>}
  {observed&&<Detail data={observed}/>}
  <p>The displayed loopback SSH endpoint belongs to the selected physical host. It is not a direct connection from this computer. A verified host-relative native connection is required before guest bootstrap. Guest creation does not establish VPN enrollment, APQE identity, bond or consensus membership.</p>
 </Card>;
}
