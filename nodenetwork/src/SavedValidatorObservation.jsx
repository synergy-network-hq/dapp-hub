import {useEffect, useRef, useState} from 'react';
import {Card, Detail, ErrorMessage, Table} from '@synergy-network/portal-native/dapp-sdk';
import {readValidatorObservationFile} from './validator-operations-observation.js';

const preflightColumns = [
 {key: 'check', label: 'Required check'},
 {key: 'status', label: 'Result at capture'},
 {key: 'next', label: 'Follow-up'},
];

export function SavedValidatorObservation({permitted, onOpenDiagnostics}) {
 return <Card title="Saved validator operations observation">
  {permitted ? <ObservationReview onOpenDiagnostics={onOpenDiagnostics}/> : <p>Allow NodeNetwork inspection in Security &amp; permissions to review a saved observation.</p>}
 </Card>;
}

function ObservationReview({onOpenDiagnostics}) {
 const [result, setResult] = useState(null);
 const [error, setError] = useState('');
 const [reading, setReading] = useState(false);
 const revision = useRef(0);
 useEffect(() => () => {revision.current++;}, []);

 function clear() {
  revision.current++;
  setResult(null);
  setError('');
  setReading(false);
 }

 async function inspect(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const requested = ++revision.current;
  setResult(null);
  setError('');
  setReading(true);
  try {
   const report = await readValidatorObservationFile(file);
   if (revision.current === requested) setResult(report);
  } catch (failure) {
   if (revision.current === requested) setError(failure.message);
  } finally {
   if (revision.current === requested) setReading(false);
  }
 }

 return <>
  <p>Review a local Validator Operations v1 observation, up to 1 MiB. It describes what the file reports at capture time. Host identity, current health and release approval require separate evidence.</p>
  <div className="native-actions">
   <label>Validator Operations observation JSON
    <input type="file" accept=".json,application/json" onChange={inspect}/>
   </label>
   {(reading || result || error) && <button onClick={clear}>Clear observation</button>}
  </div>
  {reading && <p role="status">Reading the selected observation…</p>}
  <ErrorMessage error={error}/>
  {result && <ObservationDetails result={result} onOpenDiagnostics={onOpenDiagnostics}/>}
 </>;
}

function ObservationDetails({result, onOpenDiagnostics}) {
 const {releaseMismatches, missingTransition, savedPreflight, ...savedStatus} = result;
 return <section aria-label="Saved observation evidence">
  <h3>Reported status at capture</h3>
  <Detail data={savedStatus}/>
  <h3>Release comparison</h3>
  {releaseMismatches === null ? <p>The file supplies no expected release. Comparison is unavailable.</p>
   : releaseMismatches.length ? <>
    <p>The reported release differs from the reference included in the file.</p>
    <ul>{releaseMismatches.map(field => <li key={field}>{field.replaceAll('_', ' ')}</li>)}</ul>
   </> : <p>The reported release matches the reference included in the file.</p>}
  <h3>First missing transition at capture</h3>
  {missingTransition ? <>
   <p><code>{missingTransition.from}</code> → <code>{missingTransition.to}</code></p>
   <p>{missingTransition.evidence}</p>
  </> : <p>The saved fields satisfy the checks in the transition sequence.</p>}
  <p>The finding is derived from this file. Review a newer observation to compare progress.</p>
  <details>
   <summary>Saved host preflight · {savedPreflight.passCount} of {savedPreflight.rows.length} required checks reported pass</summary>
   <p>These results record the file’s captured evidence. Current host preflight and lifecycle approval require an authenticated controller.</p>
   <Table rows={savedPreflight.rows} columns={preflightColumns}/>
   {savedPreflight.additionalCount > 0 && <p>{savedPreflight.additionalCount} additional {savedPreflight.additionalCount === 1 ? 'entry' : 'entries'} outside the required check list omitted.</p>}
   {onOpenDiagnostics && <button onClick={onOpenDiagnostics}>Open Logs &amp; Diagnostics</button>}
  </details>
 </section>;
}
