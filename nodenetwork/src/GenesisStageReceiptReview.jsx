import {useState} from 'react';
import {Resource,useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests,nodeNetworkReviewGenesisStageReceipt} from './native-services.js';
import {retainsUnresolvedDispatch} from './request-history.js';

const findings = {
 match:'The controller verified retained staged files for the same request content.',
 different:'The controller verified retained staged files for a different request.',
 absent:'The controller returned supported Genesis evidence without a staging receipt.',
 unsupported:'The selected target could not provide supported Genesis staging receipt evidence.',
};

export function GenesisStageReceiptReview({target,record,fingerprint,targetScopeCurrent}) {
 const [requested,setRequested] = useState(false);
 const report = useResource(async signal => {
  if (!requested) return null;
  const requireCurrent = () => {
   signal.throwIfAborted();
   if (!targetScopeCurrent()) throw Error('The target, recovery state or permission changed. Review the configured target again.');
  };
  const recheck = async () => {
   requireCurrent();
   const journal = await nodeNetworkRequests().catch(() => {throw Error('The local Genesis staging dispatch could not be rechecked. Refresh local history.');});
   requireCurrent();
   if (!retainsUnresolvedDispatch(journal.records,record,fingerprint)) {
    throw Error('The selected Genesis staging dispatch changed. Refresh local history and select it again.');
   }
  };
  await recheck();
  requireCurrent();
  const status = await nodeNetworkReviewGenesisStageReceipt(target,record.id);
  await recheck();
  requireCurrent();
  return status;
 }, requested);

 return <section aria-label="Current Genesis staging receipt">
  <p>Compare the controller’s retained staging receipt with the selected local dispatch. A match corroborates the staged content. The prior dispatch stays unresolved.</p>
  <div className="native-actions">
   <button disabled={requested && report.loading} onClick={() => requested ? report.reload() : setRequested(true)}>Compare current staging receipt</button>
   {requested && <button onClick={() => setRequested(false)}>Dismiss staging evidence</button>}
  </div>
  {requested && <Resource value={{...report,reload:null}}>{status => <p role="status">{findings[status]}</p>}</Resource>}
 </section>;
}
