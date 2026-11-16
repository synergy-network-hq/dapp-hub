import {useState} from 'react';
import {Detail, ErrorMessage, ModalDialog, Table} from '@synergy-network/portal-native/dapp-sdk';
import {downloadJson} from './download-json.js';

const columns = [{key:'check',label:'Required check'}, {key:'status',label:'Result at capture'}, {key:'next',label:'Follow-up'}];

export function SavedDiagnosticFindings({capturedAt, diagnostics}) {
 const [review, setReview] = useState(null);
 const [error, setError] = useState('');
 if (!diagnostics) return <p role="status">This snapshot has no supported combined status and preflight finding. Review its log metadata below.</p>;
 const {statusObservedAt, reportedHealth, serviceState, headHeight, finalizedHeight, syncTargetHeight,
  missingTransition, releaseFields, passingChecks, requiredChecks, blocked} = diagnostics;
 return <section aria-label="Saved diagnostic findings">
  <h3>Saved diagnostic findings</h3>
  <p>Status observed {statusObservedAt}. Current target health requires a fresh authenticated check.</p>
  <Detail data={{reportedHealth,serviceState,headHeight,finalizedHeight,syncTargetHeight}}/>
  {missingTransition && <p>First missing transition at capture <code>{missingTransition.from}</code> → <code>{missingTransition.to}</code>. {missingTransition.evidence}</p>}
  {releaseFields.length ? <p>Reported release differences in {releaseFields.map(field=>field.replaceAll('_',' ')).join(', ')}.</p>
   : <p>The snapshot records no release difference. Verify approval against an independent release reference.</p>}
  <details>
   <summary>{passingChecks} of {requiredChecks} required host checks reported pass</summary>
   <Table rows={blocked} columns={columns} empty="Every required host check reported pass in this capture."/>
  </details>
  <button onClick={() => {
   setError('');
   setReview({schema:'nodenetwork-diagnostic-snapshot-review-v1',source:'Saved diagnostic snapshot',capturedAt,...diagnostics});
  }}>Review saved diagnostic findings</button>
  {review && <ModalDialog label="Review saved diagnostic findings" onClose={() => setReview(null)}>
   <h2>Review saved diagnostic findings</h2>
   <pre>{JSON.stringify(review,null,2)}</pre>
   <ErrorMessage error={error}/>
   <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
   <button onClick={() => {
    try {
     downloadJson('nodenetwork-diagnostic-snapshot-review.json',review);
     setReview(null);
    } catch {
     setError('The device could not save the diagnostic findings.');
    }
   }}>Save reviewed diagnostic findings</button>
  </ModalDialog>}
 </section>;
}
