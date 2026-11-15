import {useState} from 'react';
import {ErrorMessage, ModalDialog, Table} from '@synergy-network/portal-native/dapp-sdk';
import {NodeNetworkPanelCard} from './NodeNetworkPanelFrame.jsx';
import {downloadJson} from './download-json.js';
import {useObservationFile} from './useObservationFile.js';
import {
 filterSavedValidatorLogs, readSavedValidatorLogs, reviewSavedValidatorLogs, savedLogSeverities, savedLogSubsystems,
} from './saved-validator-logs.js';

export function SavedValidatorLogs({permitted}) {
 return <NodeNetworkPanelCard title="Saved validator logs">
  {permitted ? <FileReview/> : <p>Allow NodeNetwork inspection in Security &amp; permissions to review saved logs.</p>}
 </NodeNetworkPanelCard>;
}

function FileReview() {
 const {result, error, reading, clear, select} = useObservationFile(readSavedValidatorLogs);
 return <>
  <p>Choose a saved Validator Operations v1 log response or diagnostic snapshot. Portal shows only log metadata from the file.</p>
  <div className="native-actions">
   <label>Saved validator logs JSON<input type="file" accept=".json,application/json" onChange={select}/></label>
   {(reading || result || error) && <button onClick={clear}>Clear saved logs</button>}
  </div>
  {reading && <p role="status">Reading the selected logs…</p>}
  <ErrorMessage error={error}/>
  {result && <LogReview observation={result}/>}
 </>;
}

function LogReview({observation}) {
 const [severity, setSeverity] = useState('all');
 const [subsystem, setSubsystem] = useState('all');
 const [selected, setSelected] = useState(() => new Set());
 const [review, setReview] = useState(null);
 const [error, setError] = useState('');
 const currentReview = review?.source === observation ? review.snapshot : null;
 const rows = filterSavedValidatorLogs(observation.rows, severity, subsystem);
 const selectedRows = rows.filter(row => selected.has(row.sequence));

 function resetSelection() {
  setSelected(new Set());
  setReview(null);
  setError('');
 }

 function choose(sequence, checked) {
  setSelected(current => {
   const next = new Set(current);
   if (checked) next.add(sequence); else next.delete(sequence);
   return next;
  });
 }

 const columns = [
  {key:'sequence',label:'Sequence'},
  {key:'severity',label:'Severity',render:row => savedLogSeverities[row.severity]},
  {key:'subsystem',label:'Subsystem',render:row => savedLogSubsystems[row.subsystem]},
  {key:'ownerMarkedRedacted',label:'Owner redaction',render:row => row.ownerMarkedRedacted ? 'Marked' : 'Unmarked'},
  {key:'selected',label:'Export',render:row => <input type="checkbox" checked={selected.has(row.sequence)}
   aria-label={`Select saved log sequence ${row.sequence}`} onChange={event => choose(row.sequence,event.target.checked)}/>},
 ];
 return <section aria-label="Saved validator log evidence">
  <p>{observation.source} · Collection time {observation.collectedAt}</p>
  {observation.capturedAt && <p>Snapshot time {observation.capturedAt}</p>}
  <p>Collection time applies to this set. Sequence numbers identify rows within the saved response.</p>
  {observation.truncated && <p role="status">The source reported a truncated log window.</p>}
  <div className="native-actions">
   <label>Log severity<select value={severity} onChange={event => {setSeverity(event.target.value); resetSelection();}}>
    <option value="all">All severities</option>
    {Object.entries(savedLogSeverities).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
   </select></label>
   <label>Log subsystem<select value={subsystem} onChange={event => {setSubsystem(event.target.value); resetSelection();}}>
    <option value="all">All subsystems</option>
    {Object.entries(savedLogSubsystems).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
   </select></label>
  </div>
  <p role="status">{rows.length} matching rows in {observation.rows.length} captured.</p>
  <Table columns={columns} rows={rows.map(row => ({...row,id:row.sequence}))} empty="No saved log rows match these filters."/>
  <div className="native-actions">
   <button disabled={!selectedRows.length} onClick={() => {
    setError('');
    setReview({source:observation,snapshot:reviewSavedValidatorLogs(observation,selectedRows.map(row => row.sequence))});
   }}>Review selected log metadata</button>
   {selectedRows.length > 0 && <button onClick={resetSelection}>Clear log selection</button>}
  </div>
  {currentReview && <ModalDialog label="Review saved validator log export" onClose={() => setReview(null)}>
   <h2>Review saved validator log export</h2>
   <pre>{JSON.stringify(currentReview, null, 2)}</pre>
   <ErrorMessage error={error}/>
   <div className="native-actions">
    <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
    <button onClick={() => {
     try {
      downloadJson('nodenetwork-saved-validator-logs.json', currentReview);
      resetSelection();
     } catch {
      setError('The device could not save the log review.');
     }
    }}>Save reviewed log metadata</button>
   </div>
  </ModalDialog>}
 </section>;
}
