import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkConsensus} from './native-services.js';
import {collectFleetConsensus,consensusFailureMessage,savedConsensusTargets} from './fleet-consensus.js';

const targetName=target=>target.kind==='local'?'This machine':`${target.host}:${target.port||22}${target.guest?` / ${target.guest.guest_id}`:''}`;

export function CurrentFleetConsensus({disabled}){
 const [result,setResult]=useState(null),[pending,setPending]=useState(null),[error,setError]=useState('');
 const busy=useRef(false),mounted=useRef(true),generation=useRef(0),permission=useRef(disabled);
 permission.current=disabled;
 useEffect(()=>{generation.current++;setResult(null);setError('');},[disabled]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 async function collect(){
  if(disabled||busy.current)return;
  busy.current=true;const token=generation.current;setResult(null);setError('');
  try{
   const targets=savedConsensusTargets(localStorage),key=JSON.stringify(targets);
   const active=()=>mounted.current&&!permission.current&&generation.current===token;
   const isCurrent=()=>{try{return active()&&JSON.stringify(savedConsensusTargets(localStorage))===key;}catch{return false;}};
   const value=await collectFleetConsensus(targets,nodeNetworkConsensus,{isCurrent,onProgress:value=>{if(active())setPending(value);}});
   if(isCurrent())setResult(value);
  }catch(e){if(mounted.current&&generation.current===token&&!permission.current)setError(consensusFailureMessage(e));}
  finally{busy.current=false;if(mounted.current)setPending(null);}
 }
 return <Card title="Compare selected controllers at one finalized height">
  <p>Uses the public controller selection saved in the commissioning review. Reads each controller's current finalized tip, then requests the lowest observed height from every selected controller. Each read is authenticated by the native controller. No service, identity, network or consensus state is changed.</p>
  <button disabled={disabled||!!pending} onClick={collect}>Read selected-controller consensus</button>
  {pending&&<p role="status">Collecting {pending.operation==='telemetry'?'current tips':'same-height finality observations'}: {pending.completed} of {pending.total} reads completed. Native exchanges are queued; no read is automatically retried.</p>}
  <ErrorMessage error={error}/>
  {result&&<>
   <p role="status">{result.status==='commitments_match'?`Node-reported finalized commitments match at H${result.common_height}.`:result.status==='commitments_differ'?`Node-reported finalized commitments differ at H${result.common_height}.`:result.status==='scope_mismatch'?'Selected controllers reported different network, Genesis, formation or release scopes. No common-height comparison was made.':'Complete same-height observations are unavailable. No agreement is inferred.'}</p>
   <Detail data={{selectedControllers:result.observations.length,commonFinalizedHeight:result.common_height??'Not observed',completedAt:new Date(result.completed_at_unix_ms).toISOString(),...(result.scope||{})}}/>
   {result.commitment&&<Detail data={result.commitment}/>}
   {result.evidence_documents&&<Detail data={{nodeReportedFinalityDocumentDigests:result.evidence_documents.same_digest?'Match':'Differ',completeDocuments:result.evidence_documents.all_complete?'Observed in every bounded first page':'Not all documents fit in the bounded first page'}}/>}
   {result.observations.map(row=>{
    const view=row.finality||row.telemetry;
    return <div key={JSON.stringify(row.target)}><h4>{targetName(row.target)}</h4>
     {row.error&&<ErrorMessage error={row.error}/>}
     {view&&<Detail data={{processId:view.process_id,observedAt:new Date(view.observed_at_unix_ms).toISOString(),latestFinalizedHeight:view.finalized_height,observedEpoch:view.epoch??'Not observed',epochContext:view.epoch_context_root??'Not observed',authenticatedPeerSessions:view.transport.authenticated_peer_count,...(result.status==='scope_mismatch'?view.scope:{})}}/>}
     {row.finality&&<Detail data={{...row.finality.commitment,finalityDocumentSha256:row.finality.evidence.sha256,completeDocument:row.finality.evidence.complete}}/>}
    </div>;
   })}
  </>}
  <p>This compares authenticated local-node observations. It does not independently verify certificates, quorum, physical host separation, account balances or transaction inclusion. Live epoch and tip readings may differ while the chain advances. Saved targets grant no trust; changing the selection requires a fresh collection.</p>
 </Card>;
}
