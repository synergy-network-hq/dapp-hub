import {useState} from 'react';
import {Card, ErrorMessage, ModalDialog, Table} from '@synergy-network/portal-native/dapp-sdk';
import {downloadJson} from './download-json.js';
import {reviewTroubleshooting, symptoms, troubleshoot} from './troubleshooter.js';

const columns = [
 {key: 'status', label: 'Status'},
 {key: 'label', label: 'Source'},
 {key: 'evidence', label: 'Evidence'},
 {key: 'receivedAt', label: 'Received'},
 {key: 'next', label: 'Next step'},
];

export function Troubleshooter({profile, permitted, local, live, hasTarget, targetSettingsReadable, onOpenMonitoring, onOpenSettings}) {
 const [symptom, setSymptom] = useState('rpc');
 const [review, setReview] = useState(null);
 const [error, setError] = useState('');
 const input = {symptom, profile, permitted, local, live, hasTarget, targetSettingsReadable};
 const findings = troubleshoot(input);
 const source = symptom === 'local' ? local : symptom === 'target' ? null : live;

 function reviewReport() {
  setError('');
  setReview(reviewTroubleshooting(input));
 }

 return <Card title="Troubleshooter">
  <p>Use local and public observations to narrow the issue. Managed host, VPN, disk and clock checks require the enrolled controller.</p>
  <label>Symptom
   <select value={symptom} onChange={event => setSymptom(event.target.value)}>
    {symptoms.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
   </select>
  </label>
  <Table rows={findings} columns={columns}/>
  <div className="native-actions">
   {source && <button disabled={!permitted || source.loading} onClick={source.reload}>Rerun {symptom === 'local' ? 'local check' : 'public reads'}</button>}
   {symptom === 'target' && <button onClick={onOpenSettings}>Review target settings</button>}
   <button onClick={onOpenMonitoring}>Open Monitoring</button>
   <button disabled={!permitted || source?.loading || !findings.length} onClick={reviewReport}>Review diagnostic summary</button>
  </div>
  {review && <ModalDialog label="Review NodeNetwork diagnostic summary" onClose={() => setReview(null)}>
   <h2>Review diagnostic summary</h2>
   <p>Use this summary when contacting the endpoint or node operator. Hostnames, filesystem paths and raw responses are excluded.</p>
   <pre>{JSON.stringify(review, null, 2)}</pre>
   <ErrorMessage error={error}/>
   <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
   <button onClick={() => {
    try {
     downloadJson('nodenetwork-diagnostics.json', review);
     setReview(null);
    } catch {
     setError('The device could not save the summary. Try again or review this text with the operator.');
    }
   }}>Save summary as JSON</button>
  </ModalDialog>}
 </Card>;
}
