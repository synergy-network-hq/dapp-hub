import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkFleetReadiness} from './native-services.js';
import {fleetTargets,addFleetTarget,readinessFailureMessage} from './fleet-readiness.js';
const KEY='portal-native-v1:nodeNetworkFleetTargets';
export function FleetReadiness({target,disabled,onMutation=()=>{}}){
 const [initial]=useState(()=>{try{const raw=localStorage.getItem(KEY);if(raw&&raw.length>32768)throw Error();return {targets:fleetTargets(raw?JSON.parse(raw):[]),error:''};}catch{return {targets:[],error:'Saved fleet targets are unreadable. Original public selection is retained; no readiness is inferred.'};}});
 const [targets,setTargets]=useState(initial.targets),[review,setReview]=useState(null),[pending,setPending]=useState(''),[error,setError]=useState(initial.error),[staged,setStaged]=useState(null);
 const lock=useRef(false),epoch=useRef(0),mounted=useRef(true);const key=JSON.stringify(target);
 useEffect(()=>{epoch.current++;setReview(null);setStaged(null);},[key]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function save(next){try{if(initial.error)throw Error(initial.error);localStorage.setItem(KEY,JSON.stringify(next));setTargets(next);setReview(null);setStaged(null);setError('');}catch(e){setError(e.message);}}
 async function perform(operation){
  if(disabled||lock.current)return;lock.current=true;const generation=epoch.current;setPending(operation);setError('');
  try{const value=await nodeNetworkFleetReadiness(target,operation,operation==='collect'?targets:null,operation==='stage'?review?.review_sha256:null);if(value===null)return;
   if(operation==='stage')onMutation();if(!mounted.current||generation!==epoch.current)return;
   if(operation==='collect'){setReview(value);setStaged(null);}else{setStaged(value);setReview(null);}
  }catch(e){if(mounted.current&&generation===epoch.current){setError(readinessFailureMessage(e));setReview(null);}}
  finally{lock.current=false;if(mounted.current)setPending('');}
 }
 return <Card title="Review selected-controller commissioning readiness">
  <p>Add each independently enrolled controller or authenticated managed guest using the selected target above. Select four or five controllers to observe. Collection verifies the full signed roster and its strict count and voting-weight quorum, then checks cross-observed VPN peer keys and every directed probe within the selected subset. Excluded roster members remain unobserved; their membership is unchanged. A saved target list grants no trust.</p>
  <div className="button-row"><button disabled={disabled||!!pending||targets.length>=5||!!initial.error} onClick={()=>{try{save(addFleetTarget(targets,target));}catch(e){setError(e.message);}}}>Add selected controller to fleet</button><button disabled={disabled||!!pending||!targets.length||!!initial.error} onClick={()=>save([])}>Clear public fleet selection</button></div>
  <Detail data={{selectedControllers:targets}}/>
  {targets.map((entry,index)=><button key={JSON.stringify(entry)} disabled={disabled||!!pending||!!initial.error} onClick={()=>save(targets.filter((_,i)=>i!==index))}>Exclude {entry.guest?.guest_id||entry.host||entry.kind} from observations</button>)}
  <div className="button-row"><button disabled={disabled||!!pending||targets.length<4} onClick={()=>perform('collect')}>Collect authenticated prestart observations</button><button disabled={disabled||!!pending} onClick={()=>perform('reconcile')}>Read or reconcile original readiness staging</button><button disabled={disabled||!!pending} onClick={()=>perform('verify_not_applied')}>Verify original readiness stage not applied</button><button disabled={disabled||!!pending} onClick={()=>perform('verify_commission_not_applied')}>Verify original commission not applied</button><button disabled={disabled||!!pending||!review} onClick={()=>perform('stage')}>Review and stage exact readiness for selected target</button></div>
  {pending&&<p role="status">Waiting for native {pending}. No operation is automatically retried.</p>}{error&&<ErrorMessage error={error}/>} {review&&<Detail data={review}/>} {staged&&<Detail data={staged}/>}
  <p>This proves only current commissioning and prestart VPN readiness. It does not prove stake, APQE sessions, active PoSy participation, synchronization, finalized transactions or production approval. Those require independent observations after startup.</p>
 </Card>;
}
