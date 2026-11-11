import {useState} from 'react';
import {Card,Detail,Resource,useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests} from './native-services.js';

const labels={dispatch_intent:'Outcome unknown · dispatch recorded',uncertain:'Outcome uncertain',response_received:'Controller response received'};
export function RequestHistory({permitted}){
 const [filter,setFilter]=useState('all'),[selected,setSelected]=useState(null);
 const history=useResource(()=>{if(!permitted)throw Error('Allow NodeNetwork inspection in Security & permissions to read local request history.');return nodeNetworkRequests();},String(permitted));
 return <Card title="Local request history" action={<button disabled={!permitted||history.loading} onClick={()=>{setSelected(null);history.reload();}}>Refresh local history</button>}>
  <p>These records describe Portal dispatch attempts on this device. They are not target jobs, signed plans, service readiness or consensus proof. Refreshing reads local files only; no target is contacted and no operation is replayed.</p>
  <Resource value={history}>{value=>{
   const rows=value.records.filter(r=>filter==='all'||(filter==='uncertain'?r.state!=='response_received':r.state==='response_received'));
   const current=rows.find(r=>r.id===selected);
   return <>
    <p>{value.records.length} local records · {value.records.filter(r=>r.state!=='response_received').length} with unknown or uncertain outcomes. Capacity {value.limit}; records are never automatically discarded.</p>
    <label>Request history status<select value={filter} onChange={event=>{setFilter(event.target.value);setSelected(null);}}><option value="all">All requests</option><option value="uncertain">Unknown or uncertain</option><option value="responses">Responses received</option></select></label>
    {!rows.length?<p>{value.records.length?'No local records match this filter.':'No local mutation dispatches are recorded in this journal. Earlier versions and remote activity are not covered.'}</p>:<ul>{rows.map(record=><li key={record.id}><button aria-pressed={selected===record.id} onClick={()=>setSelected(record.id)}>{record.operation} · {labels[record.state]} · {new Date(record.recorded_at_ms).toISOString()}</button></li>)}</ul>}
    {current&&<div aria-live="polite"><Detail data={{localRequestId:current.id,operation:current.operation,state:labels[current.state],targetFingerprint:current.target_digest,requestFingerprint:current.request_digest,dispatchRecordedAt:new Date(current.recorded_at_ms).toISOString(),responseObservedAt:current.observed_at_ms===null?'Not observed':new Date(current.observed_at_ms).toISOString(),controllerResponse:current.response_ok===null?'Not observed':current.response_ok?'Reported ok':'Reported refusal'}}/><p>Fingerprints correlate local inputs; they do not authenticate host identity. A received response does not establish durable completion. An uncertain dispatch blocks further mutations for the same configured target until a qualified reconciliation procedure is available. Changing a hostname alias is not reconciliation.</p></div>}
   </>;
  }}</Resource>
 </Card>;
}
