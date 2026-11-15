import {useState} from 'react';
import {Card, ErrorMessage, ModalDialog, Table} from '@synergy-network/portal-native/dapp-sdk';
import {downloadJson} from './download-json.js';
import {performanceCaptureLimit, readPerformanceObservationFiles} from './validator-operations-observation.js';
import {useObservationFile} from './useObservationFile.js';

const columns = [
 {key:'observedAtUtc', label:'Capture time UTC'},
 {key:'headHeight', label:'Head'},
 {key:'finalizedHeight', label:'Finalized'},
 {key:'syncTargetHeight', label:'Reported sync target'},
 {key:'headLagBlocks', label:'Blocks behind target', render:row => row.headLagBlocks ?? 'Target below head'},
 {key:'serviceState', label:'Service state'},
 {key:'serviceUptimeSeconds', label:'Service uptime (s)'},
 {key:'serviceRestartCount', label:'Service restarts'},
 {key:'connectedPeers', label:'Connected peers'},
 {key:'authenticatedValidatorPeers', label:'Authenticated validator peers', render:row => `${row.authenticatedValidatorPeers} of ${row.expectedValidatorPeers} expected (threshold ${row.peerQuorumThreshold})`},
 {key:'finalityProgress', label:'Finality progress'},
];

function CaptureSeries({result}) {
 const {samples} = result;
 const [first, setFirst] = useState(0);
 const [last, setLast] = useState(samples.length - 1);
 const [review, setReview] = useState(null);
 const [error, setError] = useState('');
 const selected = samples.slice(first, last + 1);
 const options = (from, through) => samples.map((sample,index) => (
  <option key={sample.observedAtUtc} value={index} disabled={index < from || index > through}>{sample.observedAtUtc}</option>
 ));

 function selectBound(event, from, through, update) {
  const index = Number.parseInt(event.target.value, 10);
  if (!Number.isInteger(index) || index < from || index > through) return;
  update(index);
  setReview(null);
  setError('');
 }

 return <section aria-label="Saved validator performance series">
  <p>Reported validator {result.validator} · {result.network} · Chain {result.chainId} · Incarnation {result.incarnation}</p>
  <div className="native-actions">
   <label>First capture UTC <select value={first} onChange={event => selectBound(event, 0, last, setFirst)}>{options(0,last)}</select></label>
   <label>Last capture UTC <select value={last} onChange={event => selectBound(event, first, samples.length - 1, setLast)}>{options(first,samples.length-1)}</select></label>
  </div>
  <p role="status">Showing {selected.length} of {samples.length} selected file captures.</p>
  <Table columns={columns} rows={selected}/>
  <button onClick={() => {
   setError('');
   setReview({schema:'nodenetwork-saved-performance-v1', source:'saved-validator-operations-v1', samples:selected});
  }}>Review saved performance export</button>
  {review && <ModalDialog label="Review saved performance export" onClose={() => setReview(null)}>
   <h2>Review saved performance export</h2>
   <p>The export contains the capture times and performance fields shown below.</p>
   <pre style={{maxHeight:'50vh', overflow:'auto'}}>{JSON.stringify(review,null,2)}</pre>
   <ErrorMessage error={error}/>
   <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
   <button onClick={() => {
    try {
     downloadJson('nodenetwork-saved-performance.json', review);
     setReview(null);
    } catch {
     setError('The device could not save the reviewed performance samples.');
    }
   }}>Save reviewed performance samples</button>
  </ModalDialog>}
 </section>;
}

function CapturePicker() {
 const {result, error, reading, revision, select, clear} = useObservationFile(readPerformanceObservationFiles, {maxFiles:performanceCaptureLimit});
 return <>
  <p>Choose up to {performanceCaptureLimit} Validator Operations v1 JSON files, each at most 1 MiB, for one validator and chain binding. Captures show only their reported points in time. Continuous uptime, per-validator duties and the gaps between samples require telemetry.</p>
  <label>Validator performance observation files <input type="file" multiple accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Reading saved performance captures…</p>}
  <ErrorMessage error={error}/>
  {(reading || result || error) && <button onClick={clear}>Clear saved performance captures</button>}
  {result && <CaptureSeries key={revision} result={result}/>}
 </>;
}

export function SavedValidatorPerformance({permitted}) {
 return <Card title="Saved validator performance">
  {permitted ? <CapturePicker/> : <p>Allow NodeNetwork inspection in Security &amp; permissions to view saved performance captures.</p>}
 </Card>;
}
