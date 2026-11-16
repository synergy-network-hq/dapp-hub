import {useState} from 'react';
import {Card, Detail, ErrorMessage, ModalDialog, Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {downloadJson} from './download-json.js';
import {nodeNetworkRequests} from './native-services.js';
import {configuredTargetFingerprint, custodyReceiptOperations, filterRequests, matchesUnresolvedCustodyReceipt, matchesUnresolvedServiceDispatch, requestOperations, requestStatusLabel, requestStatusOptions, reviewRequestSelection} from './request-history.js';
import {ServiceDispatchDiagnosticsReview} from './TargetDiagnostics.jsx';
import {CustodyReceiptReview} from './CustodyReceiptReview.jsx';

const allRequests = {status: 'all', operation: 'all', target: null};
const configuredTarget = 'configured';

export function RequestHistory({permitted, target, targetScopeCurrent = () => permitted}) {
 return <RequestHistoryView key={JSON.stringify([permitted,target])} permitted={permitted} target={target} targetScopeCurrent={targetScopeCurrent}/>;
}

function RequestHistoryView({permitted, target, targetScopeCurrent}) {
 const [filters, setFilters] = useState(allRequests);
 const [selected, setSelected] = useState(null);
 const [exportIds, setExportIds] = useState(() => new Set());
 const [review, setReview] = useState(null);
 const [exportError, setExportError] = useState('');
 const history = useResource(() => {
  if (!permitted) throw Error('Allow NodeNetwork inspection in Security & permissions to read local request history.');
  return nodeNetworkRequests();
 }, String(permitted));
 const filterConfigured = filters.target === configuredTarget;
 const configured = useResource(() => filterConfigured && permitted && target ? configuredTargetFingerprint(target) : null,
  String(filterConfigured));
 const filterReady = !filterConfigured || Boolean(configured.data);

 function resetExport() {
  setExportIds(new Set());
  setReview(null);
  setExportError('');
 }

 function toggleExport(id, checked) {
  setExportError('');
  setExportIds(current => {
   const next = new Set(current);
   if (checked) next.add(id);
   else next.delete(id);
   return next;
  });
 }

 function changeFilters(next) {
  setFilters(next);
  setSelected(null);
  resetExport();
 }

 const currentReview = permitted && review && history.data === review.source ? review : null;

 return <Card title="Local request history" action={
  <button disabled={!permitted || history.loading} onClick={() => {setSelected(null); resetExport(); history.reload();}}>
   Refresh local history
  </button>
 }>
  <p>Review dispatch attempts from this device. Refresh reads the local journal. Target jobs and service state require separate evidence.</p>
  <Resource value={history}>{value => {
   const rows = filterReady ? filterRequests(value.records, {...filters,target:filterConfigured ? configured.data : filters.target}) : [];
   const current = rows.find(record => record.id === selected);
   const visibleExportIds = rows.filter(record => exportIds.has(record.id)).map(record => record.id);
   const unresolved = value.records.filter(record => record.state !== 'response_received').length;
   return <>
    <p>{value.records.length} of {value.limit} local journal entries · {unresolved} unknown or uncertain outcomes.</p>
    {value.records.length === value.limit && <p role="status">The journal is full. New mutations require an approved retention procedure.</p>}
    {unresolved > 0 && <button onClick={() => changeFilters({...allRequests, status: 'unresolved'})}>
     Review unresolved dispatches
    </button>}
    {target && <button onClick={() => {
     changeFilters({...allRequests,status:'unresolved',target:configuredTarget});
     if (filterConfigured) configured.reload();
     history.reload();
    }}>
     Review unresolved dispatches for configured target
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
     {filterConfigured ? <>
      {configured.loading && <p role="status">Checking the configured target fingerprint…</p>}
      <ErrorMessage error={configured.error}/>
      {configured.data && <p>Local dispatches matching the current configured target. This compares saved configuration fingerprints.</p>}
     </> : <p>Showing journal entries with the recorded target fingerprint <code style={{overflowWrap: 'anywhere'}}>{filters.target}</code>.</p>}
     <button onClick={() => changeFilters({...filters, target: null})}>Clear target filter</button>
    </div>}
    {filterReady && <p role="status">{rows.length} matching {rows.length === 1 ? 'record' : 'records'}.</p>}
    {rows.length > 0 && <div className="native-actions">
     <button disabled={!visibleExportIds.length} onClick={() => {
      setExportError('');
      try {setReview({source: value, snapshot: reviewRequestSelection(value, visibleExportIds)});}
      catch (error) {setExportError(error.message);}
     }}>Review selected journal records</button>
     {visibleExportIds.length > 0 && <>
      <span role="status">{visibleExportIds.length} selected for export</span>
      <button onClick={resetExport}>Clear export selection</button>
     </>}
    </div>}
    {!currentReview && <ErrorMessage error={exportError}/>}
    {filterReady && (!rows.length ? <p>{value.records.length
     ? 'No local records match these filters.'
     : 'This journal contains no recorded dispatches. It covers current Portal dispatches on this device.'}</p>
     : <ul>{rows.map(record => <li key={record.id}>
      <button aria-pressed={selected === record.id} onClick={() => setSelected(record.id)}>
       {record.operation} · {requestStatusLabel(record)} · {new Date(record.recorded_at_ms).toISOString()}
      </button>
      <label>
       <input type="checkbox" checked={exportIds.has(record.id)}
        aria-label={`Select ${record.operation} journal record ${record.id.slice(0, 8)} for export`}
        onChange={event => toggleExport(record.id, event.target.checked)}/>
       Select for export
      </label>
     </li>)}</ul>)}
    {current && <div aria-live="polite">
     <Detail data={{
      localRequestId: current.id,
      operation: current.operation,
      state: requestStatusLabel(current),
      targetFingerprint: current.target_digest,
      requestFingerprint: custodyReceiptOperations.includes(current.operation) ? undefined : current.request_digest,
      dispatchRecordedAt: new Date(current.recorded_at_ms).toISOString(),
      outcomeRecordedAt: current.observed_at_ms === null ? 'No outcome recorded' : new Date(current.observed_at_ms).toISOString(),
     }}/>
     {!filters.target && <button onClick={() => {setFilters({...filters, target: current.target_digest}); resetExport();}}>
      Filter by this target fingerprint
     </button>}
     <p>Fingerprints correlate recorded configurations. Host identity and remote job completion require separate evidence.</p>
     {current.state !== 'response_received' && <p>
      The journal blocks further mutations for this configured target while the dispatch remains unresolved. Ask the node operator for qualified reconciliation before making another change.
     </p>}
     {target && filterConfigured && matchesUnresolvedServiceDispatch(current, configured.data) && <ServiceDispatchDiagnosticsReview
      key={current.id} target={target} record={current} fingerprint={configured.data} targetScopeCurrent={targetScopeCurrent}/>}
     {target && filterConfigured && matchesUnresolvedCustodyReceipt(current, configured.data) && <CustodyReceiptReview
      key={current.id} target={target} record={current} fingerprint={configured.data} targetScopeCurrent={targetScopeCurrent}/>}
    </div>}
   </>;
  }}</Resource>
  {currentReview && <ModalDialog label="Review local journal export" onClose={() => setReview(null)}>
   <h2>Review local journal export</h2>
   <p>The file contains the displayed local request IDs, outcomes and times. Target and request fingerprints are omitted.</p>
   <pre>{JSON.stringify(currentReview.snapshot, null, 2)}</pre>
   <ErrorMessage error={exportError}/>
   <div className="native-actions">
    <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
    <button onClick={() => {
     try {
      downloadJson('nodenetwork-request-summary.json', currentReview.snapshot);
      resetExport();
     } catch {
      setExportError('The device could not save the summary.');
     }
    }}>Save reviewed journal summary</button>
   </div>
  </ModalDialog>}
 </Card>;
}
