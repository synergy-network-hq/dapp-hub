import {Card, Detail, ErrorMessage, Table} from '@synergy-network/portal-native/dapp-sdk';
import {compareMaintenanceObservations, readMaintenanceObservationFile} from './validator-operations-observation.js';
import {useObservationFile} from './useObservationFile.js';

const columns = [
 {key: 'field', label: 'Changed release field'},
 {key: 'before', label: 'Before'},
 {key: 'after', label: 'After'},
];

function CaptureInput({label, capture}) {
 const {result, error, reading, clear, select} = capture;
 return <div>
  <label>{label} observation JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Reading {label.toLowerCase()} observation…</p>}
  {result && <p role="status">{label} observation selected.</p>}
  <ErrorMessage error={error}/>
  {(reading || result || error) && <button onClick={clear}>Clear {label.toLowerCase()} observation</button>}
 </div>;
}

function CaptureComparison() {
 const before = useObservationFile(readMaintenanceObservationFile);
 const after = useObservationFile(readMaintenanceObservationFile);
 let result = null;
 let error = '';
 if (before.result && after.result) {
  try {result = compareMaintenanceObservations(before.result, after.result);}
  catch (failure) {error = failure.message;}
 }

 return <>
  <p>Select two Validator Operations v1 files of up to 1 MiB each. The comparison needs an earlier and later capture with the same reported validator and chain context.</p>
  <div className="native-grid">
   <CaptureInput label="Before" capture={before}/>
   <CaptureInput label="After" capture={after}/>
  </div>
  <ErrorMessage error={error}/>
  {result && <section aria-label="Saved maintenance comparison">
   <div className="native-grid">
    <div><h3>Before capture</h3><Detail data={result.before}/></div>
    <div><h3>After capture</h3><Detail data={result.after}/></div>
   </div>
   <Table rows={result.changes} columns={columns} empty="The two captures report the same release identity fields."/>
  </section>}
  <p>These files report the binary SHA-256. The update request uses a separate manifest SHA-256. Backup integrity, downtime and safe rollback require authenticated maintenance evidence.</p>
 </>;
}

export function MaintenanceComparison({permitted}) {
 return <Card title="Compare saved maintenance observations">
  {permitted ? <CaptureComparison/> : <p>Allow NodeNetwork inspection in Security &amp; permissions to compare saved observations.</p>}
 </Card>;
}
