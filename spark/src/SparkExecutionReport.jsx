import {useEffect, useRef, useState} from 'react';
import {executionReportLimit, inspectSparkExecution} from './execution-report.js';

export function SparkExecutionReport() {
 const [result, setResult] = useState(null);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const revision = useRef(0);
 useEffect(() => () => {revision.current++;}, []);

 function clear() {
  revision.current++;
  setResult(null);
  setError('');
  setBusy(false);
 }
 async function inspect(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const request = ++revision.current;
  setResult(null);
  setError('');
  setBusy(true);
  try {
   if (file.size > executionReportLimit) throw Error('Execution report exceeds 2 MB.');
   const snapshot = await inspectSparkExecution(await file.text());
   if (revision.current === request) setResult(snapshot);
  } catch (failure) {
   if (revision.current === request) setError(failure.message || 'The selected report could not be read.');
  } finally {
   if (revision.current === request) setBusy(false);
  }
 }

 return <section className="launch-list-panel">
  <h2>Inspect local execution report</h2>
  <p>Review a saved Spark constructor report on this device. The hashes check whether its contents match the recorded inputs. Anyone can edit and rehash an unsigned report.</p>
  <label className="field"><span>Spark execution report JSON</span>
   <input type="file" accept=".json,application/json" disabled={busy} onChange={inspect}/>
  </label>
  {(busy || result || error) && <button onClick={clear}>Clear report</button>}
  {busy && <p role="status">Checking report contents…</p>}
  {error && <p role="alert">{error}</p>}
  {result && <div role="status">
   <h3>Report contents and bindings match</h3>
   <p>Recorded outcome {result.status} · {result.planBound ? 'Launch plan included' : 'No launch plan included'}</p>
   <p>The report records no network submission.</p>
   <p style={{overflowWrap: 'anywhere'}}>Reported test caller {result.testCaller}</p>
   <p style={{overflowWrap: 'anywhere'}}>Source SHA-256 {result.sourceSha256}</p>
   <p>Report origin, execution, and wallet control remain unverified.</p>
  </div>}
 </section>;
}
