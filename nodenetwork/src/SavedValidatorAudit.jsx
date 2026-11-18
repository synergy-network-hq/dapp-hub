import {useState} from 'react';
import {ErrorMessage,ModalDialog,Table} from '@synergy-network/portal-native/dapp-sdk';
import {downloadJson} from './download-json.js';
import {NodeNetworkPanelCard} from './NodeNetworkPanelFrame.jsx';
import {auditActions,auditExportLimit,auditOutcomes,filterSavedValidatorAudit,readSavedValidatorAudit,reviewSavedValidatorAudit} from './saved-validator-audit.js';
import {useObservationFile} from './useObservationFile.js';

const pageSize = 50;

function AuditReview({records,canRead}) {
 const [filters,setFilters] = useState({action:'',outcome:'',from:'',through:''});
 const [page,setPage] = useState(0);
 const [selected,setSelected] = useState(() => new Set());
 const [review,setReview] = useState(null);
 const [downloadError,setDownloadError] = useState('');
 let filtered = [];
 let filterError = '';
 try {filtered = filterSavedValidatorAudit(records,filters);} catch (error) {filterError = error.message;}
 const pages = Math.ceil(filtered.length/pageSize);
 const visible = filtered.slice(page*pageSize,(page+1)*pageSize);

 function resetSelection() {
  setSelected(new Set());
  setReview(null);
  setDownloadError('');
 }

 function change(key,value) {
  setFilters({...filters,[key]:value});
  setPage(0);
  resetSelection();
 }

 function toggle(id,checked) {
  setSelected(current=>{
   const next = new Set(current);
   if (checked && next.size < auditExportLimit) next.add(id);
   if (!checked) next.delete(id);
   return next;
  });
 }

 const columns = [
  {key:'time',label:'Recorded UTC'},
  {key:'action',label:'Management action',render:row=>auditActions[row.action]},
  {key:'outcome',label:'Recorded outcome',render:row=>auditOutcomes[row.outcome]},
  {key:'selected',label:'Export',render:row=><input type="checkbox" checked={selected.has(row.id)}
   disabled={selected.size >= auditExportLimit && !selected.has(row.id)} aria-label={`Select saved audit line ${row.id}`}
   onChange={event=>toggle(row.id,event.target.checked)}/>},
 ];

 return <section aria-label="Saved validator management audit evidence">
  <p>Entries come from the selected agent audit. Authorization and reported outcomes are separate records. Current job state requires separate evidence.</p>
  <div className="native-actions">
   <label>Audit action <select value={filters.action} onChange={event=>change('action',event.target.value)}>
    <option value="">All actions</option>
    {Object.entries(auditActions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label>Audit outcome <select value={filters.outcome} onChange={event=>change('outcome',event.target.value)}>
    <option value="">All outcomes</option>
    {Object.entries(auditOutcomes).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label>First UTC day <input type="date" value={filters.from} onChange={event=>change('from',event.target.value)}/></label>
   <label>Last UTC day <input type="date" value={filters.through} onChange={event=>change('through',event.target.value)}/></label>
  </div>
  <ErrorMessage error={filterError}/>
  {!filterError && <p role="status">{filtered.length} matching records in {records.length} saved · {selected.size} selected for export</p>}
  <Table columns={columns} rows={visible} empty="No saved audit records match the current filters."/>
  {pages > 1 && <div className="native-actions" aria-label="Saved audit pages">
   <button disabled={page===0} onClick={()=>setPage(page-1)}>Previous audit page</button>
   <span>Page {page+1} of {pages}</span>
   <button disabled={page+1===pages} onClick={()=>setPage(page+1)}>Next audit page</button>
  </div>}
  <div className="native-actions">
   <button disabled={!selected.size} onClick={()=>{
    if (!canRead()) return;
    setDownloadError('');
    setReview(reviewSavedValidatorAudit(filtered,selected));
   }}>Review selected audit records</button>
   {selected.size > 0 && <button onClick={resetSelection}>Clear audit selection</button>}
  </div>
  {review && <ModalDialog label="Review saved audit export" onClose={()=>setReview(null)}>
   <h2>Review saved audit export</h2>
   <pre>{JSON.stringify(review,null,2)}</pre>
   <ErrorMessage error={downloadError}/>
   <div className="native-actions">
    <button data-initial-focus onClick={()=>setReview(null)}>Cancel</button>
    <button onClick={()=>{
     if (!canRead()) {resetSelection();return;}
     try {downloadJson('nodenetwork-saved-validator-management-audit.json',review);resetSelection();}
     catch {setDownloadError('The device could not save the audit review.');}
    }}>Save reviewed audit records</button>
   </div>
  </ModalDialog>}
 </section>;
}

function AuditFile({canRead}) {
 const {result,error,reading,revision,clear,select} = useObservationFile((file,current)=>
  readSavedValidatorAudit(file,()=>current() && canRead()));
 return <>
  <p>Choose a saved validator-operations-api.jsonl file to review UTC activity, management actions and outcomes.</p>
  <div className="native-actions">
   <label>Saved validator management audit JSONL <input type="file" accept=".jsonl,.ndjson,application/x-ndjson" onChange={select}/></label>
   {(reading || error || result) && <button onClick={clear}>Clear saved audit review</button>}
  </div>
  {reading && <p role="status">Reading the selected audit…</p>}
  <ErrorMessage error={error}/>
  {result && <AuditReview key={revision} records={result} canRead={canRead}/>}
 </>;
}

export function SavedValidatorAudit({permitted,canRead = () => permitted}) {
 return <NodeNetworkPanelCard title="Saved validator management audit">
  {permitted ? <AuditFile canRead={canRead}/>
   : <p>Allow NodeNetwork inspection in Security &amp; permissions to review the saved audit.</p>}
 </NodeNetworkPanelCard>;
}
