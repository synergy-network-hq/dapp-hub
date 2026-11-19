import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkConsensus} from './native-services.js';
export function ConsensusObservation({target,disabled}){
 const [view,setView]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[height,setHeight]=useState(''),[epoch,setEpoch]=useState('2'),[transactionId,setTransactionId]=useState(''),[sender,setSender]=useState(''),[receiver,setReceiver]=useState('');
 const scope=JSON.stringify([target,disabled]),current=useRef(scope),busy=useRef(false),mounted=useRef(true);current.current=scope;
 useEffect(()=>{setView(null);setError('');},[scope]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function read(operation){if(disabled||busy.current)return;const token=scope;busy.current=true;setPending(true);setError('');
 try{const value=operation==='transaction'?{transaction_id:transactionId.trim(),sender:sender.trim(),receiver:receiver.trim(),height:Number(height)}:operation==='telemetry'?null:Number(operation==='finality'?height:epoch);if(operation!=='transaction'&&value!==null&&(!Number.isSafeInteger(value)||value<=0))throw Error('Enter a positive height or epoch.');const result=await nodeNetworkConsensus(target,operation,value);if(mounted.current&&current.current===token)setView(result);}
 catch(e){if(mounted.current&&current.current===token){const message=typeof e==='string'?e:e instanceof Error?e.message:'';setError(message&&message.length<=512&&!/[\u0000-\u001f\u007f]/.test(message)?message:'Consensus observation unavailable.');}}
 finally{busy.current=false;if(mounted.current)setPending(false);}}
 return <Card title="Current-network consensus observations">
 <p>Reads the selected installed network through its owned local RPC. Peer sessions exclude this validator. These observations do not change the signed roster or independently certify consensus.</p>
 <button disabled={disabled||pending} onClick={()=>read('telemetry')}>Read current consensus observations</button>
 <label>Finalized height <input disabled={disabled||pending} inputMode="numeric" value={height} onChange={e=>{setHeight(e.target.value);setView(null);}}/></label><button disabled={disabled||pending} onClick={()=>read('finality')}>Observe finality evidence</button>
 <label>Epoch <input disabled={disabled||pending} inputMode="numeric" value={epoch} onChange={e=>{setEpoch(e.target.value);setView(null);}}/></label><button disabled={disabled||pending} onClick={()=>read('epoch')}>Observe epoch evidence</button>
 <label>Transaction ID <input disabled={disabled||pending} value={transactionId} onChange={e=>{setTransactionId(e.target.value);setView(null);}} spellCheck={false}/></label>
 <label>Observed sender <input disabled={disabled||pending} value={sender} onChange={e=>{setSender(e.target.value);setView(null);}} spellCheck={false}/></label>
 <label>Observed recipient <input disabled={disabled||pending} value={receiver} onChange={e=>{setReceiver(e.target.value);setView(null);}} spellCheck={false}/></label>
 <button disabled={disabled||pending} onClick={()=>read('transaction')}>Observe transaction and balances at selected height</button>
 <ErrorMessage error={error}/>
 {view&&<>
 <Detail data={{network:view.scope.network_id,chain:view.scope.chain_id,signedLogicalGenesis:view.scope.genesis_hash,authenticatedPeerSessions:view.transport.authenticated_peer_count,observedFinalizedHeight:view.finalized_height,observedEpoch:view.epoch??'Not observed',epochContext:view.epoch_context_root??'Not observed',observationTimestamp:new Date(view.observed_at_unix_ms).toISOString()}}/>
 {view.commitment?<Detail data={{commitmentHeight:view.commitment.height,block:view.commitment.block_id,stateRoot:view.commitment.state_root,finalityCertificateId:view.commitment.finality_certificate_id}}/>:<p>Finalized commitment not observed.</p>}
 {view.evidence?.kind==='transaction'?<>
 <p>{view.evidence.transaction===null?'Transaction not observed by this node. This is not proof of absence or a reason to submit again.':`Transaction observed ${view.evidence.transaction.status} at H${view.evidence.selector.height}.`}</p>
 {view.evidence.transaction&&<Detail data={view.evidence.transaction}/>}
 {view.evidence.transaction?.status==='applied'&&view.evidence.accounts===null&&<p>Exact-height account evidence unavailable. The retained transaction receipt does not establish account absence or a reason to submit again.</p>}
 {view.evidence.accounts&&<><p>Selected sender and recipient accounts observed at the same finalized block. These are local-node observations, not independently verified account proofs or proof of encrypted transaction participants.</p><Detail data={view.evidence.accounts}/></>}
 </>:view.evidence?<><Detail data={{publicEvidenceKind:view.evidence.kind,requestedEvidenceHeightOrEpoch:view.evidence.selector,publicEvidenceSha256:view.evidence.sha256,...(view.evidence.kind==='finality'?{completeDocument:view.evidence.complete?'Reassembled and SHA-256 checked':'Not complete',threeQcCertificateVerified:view.evidence.certificate_verified?'Existing native verifier passed':'Not verified'}:{})}}/><p>Where marked verified, finality certificates are checked by the existing native three-QC verifier against authenticated authority history. Other displayed evidence and state roots are node observations, not independently proven here.</p></>:<p>No epoch or finality evidence observed in this read.</p>}</>}

 </Card>;
}
