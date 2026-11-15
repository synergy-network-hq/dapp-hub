import {useState} from 'react';
import {Card, Detail, Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests} from './native-services.js';
import {filterRequests, requestOperations, requestStatusLabel, requestStatusOptions} from './request-history.js';

const allRequests = {status: 'all', operation: 'all', target: null};

export function RequestHistory({permitted}) {
 const [filters, setFilters] = useState(allRequests);
 const [selected, setSelected] = useState(null);
 const history = useResource(() => {
  if (!permitted) throw Error('Allow NodeNetwork inspection in Security & permissions to read local request history.');
  return nodeNetworkRequests();
 }, String(permitted));

 function changeFilters(next) {
  setFilters(next);
  setSelected(null);
 }

 return <Card title="Local request history" action={
  <button disabled={!permitted || history.loading} onClick={() => {setSelected(null); history.reload();}}>
   Refresh local history
  </button>
 }>
  <p>Review dispatch attempts from this device. Refresh reads the local journal. Target jobs and service state require separate evidence.</p>
  <Resource value={history}>{value => {
   const rows = filterRequests(value.records, filters);
   const current = rows.find(record => record.id === selected);
   const unresolved = value.records.filter(record => record.state !== 'response_received').length;
   return <>
    <p>{value.records.length} of {value.limit} local journal entries · {unresolved} unknown or uncertain outcomes.</p>
    {value.records.length === value.limit && <p role="status">The journal is full. New mutations require an approved retention procedure.</p>}
    {unresolved > 0 && <button onClick={() => changeFilters({...allRequests, status: 'unresolved'})}>
     Review unresolved dispatches
    </button>}
    <div className="native-actions">
     <label>Request history status
      <select value={filters.status} onChange={event => changeFilters({...filters, status: event.target.value})}>
       {requestStatusOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
     </label>
     <label>Operation
      <select value={filters.operation} onChange={event => changeFilters({...filters, operation: event.target.value})}>
       <option value="all">All operations</option>
       {requestOperations.map(operation => <option key={operation} value={operation}>{operation}</option>)}
      </select>
     </label>
    </div>
    {filters.target && <div>
     <p>Showing journal entries with the recorded target fingerprint <code style={{overflowWrap: 'anywhere'}}>{filters.target}</code>.</p>
     <button onClick={() => changeFilters({...filters, target: null})}>Clear target filter</button>
    </div>}
    <p role="status">{rows.length} matching {rows.length === 1 ? 'record' : 'records'}.</p>
    {!rows.length ? <p>{value.records.length
     ? 'No local records match these filters.'
     : 'This journal contains no recorded dispatches. It covers current Portal dispatches on this device.'}</p>
     : <ul>{rows.map(record => <li key={record.id}>
      <button aria-pressed={selected === record.id} onClick={() => setSelected(record.id)}>
       {record.operation} · {requestStatusLabel(record)} · {new Date(record.recorded_at_ms).toISOString()}
      </button>
     </li>)}</ul>}
    {current && <div aria-live="polite">
     <Detail data={{
      localRequestId: current.id,
      operation: current.operation,
      state: requestStatusLabel(current),
      targetFingerprint: current.target_digest,
      requestFingerprint: current.request_digest,
      dispatchRecordedAt: new Date(current.recorded_at_ms).toISOString(),
      outcomeRecordedAt: current.observed_at_ms === null ? 'No outcome recorded' : new Date(current.observed_at_ms).toISOString(),
     }}/>
     {!filters.target && <button onClick={() => setFilters({...filters, target: current.target_digest})}>
      Filter by this target fingerprint
     </button>}
     <p>Fingerprints correlate recorded configurations. Host identity and remote job completion require separate evidence.</p>
     {current.state !== 'response_received' && <p>
      The journal blocks further mutations for this configured target while the dispatch remains unresolved. Ask the node operator for qualified reconciliation before making another change.
     </p>}
    </div>}
   </>;
  }}</Resource>
 </Card>;
}
