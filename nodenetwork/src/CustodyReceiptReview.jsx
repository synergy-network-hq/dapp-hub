import {useState} from 'react';
import {Resource,useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests,nodeNetworkReviewCustodyReceipt} from './native-services.js';
import {retainsUnresolvedDispatch} from './request-history.js';

const stagingFindings = {
 match:'The controller verified retained staged files for the same request content.',
 different:'The controller verified retained staged files for a different request.',
 absent:'The controller returned supported Genesis evidence without a staging receipt.',
 unsupported:'The selected target could not provide supported Genesis staging receipt evidence.',
};
const bindingFindings = {
 match:'The controller verified bound custody with the same Genesis binding request content.',
 different:'The controller verified bound custody for a different Genesis binding request.',
 absent:'The controller reported unbound custody without a binding receipt.',
 unsupported:'The selected target could not provide supported Genesis binding receipt evidence.',
};
const formationFindings = {
 match:'The controller verified pending custody for the same formation preparation request.',
 different:'The controller verified pending custody for a different formation preparation request.',
 absent:'The controller reported no pending formation custody.',
 unsupported:'The selected target could not provide supported formation preparation receipt evidence.',
};

const views = {
 genesis_stage:{label:'Genesis staging',action:'staging',findings:stagingFindings,
  description:'Compare the controller’s retained staging receipt with the selected local dispatch. A match corroborates the staged content.'},
 genesis_bind:{label:'Genesis binding',action:'binding',findings:bindingFindings,
  description:'Compare the retained binding receipt with the selected local dispatch. A match corroborates the Genesis input.'},
 formation_prepare:{label:'formation preparation',action:'formation',findings:formationFindings,
  description:'Compare retained formation preparation evidence with the selected local dispatch. A match corroborates the formation input.'},
};

export function CustodyReceiptReview({target,record,fingerprint,targetScopeCurrent}) {
 const [requested,setRequested] = useState(false);
 const {label,action,findings,description}=views[record.operation];
 const report = useResource(async signal => {
  if (!requested) return null;
  const requireCurrent = () => {
   signal.throwIfAborted();
   if (!targetScopeCurrent()) throw Error('The target, recovery state or permission changed. Review the configured target again.');
  };
  const recheck = async () => {
   requireCurrent();
   const journal = await nodeNetworkRequests().catch(() => {throw Error(`The local ${label} dispatch could not be rechecked. Refresh local history.`);});
   requireCurrent();
   if (!retainsUnresolvedDispatch(journal.records,record,fingerprint)) {
    throw Error(`The selected ${label} dispatch changed. Refresh local history and select it again.`);
   }
  };
  await recheck();
  requireCurrent();
  const status = await nodeNetworkReviewCustodyReceipt(target,record.id,record.operation);
  await recheck();
  requireCurrent();
  return status;
 }, requested);

 return <section aria-label={`Current ${label} receipt`}>
  <p>{description} The prior dispatch stays unresolved.</p>
  <div className="native-actions">
   <button disabled={requested && report.loading} onClick={() => requested ? report.reload() : setRequested(true)}>Compare current {action} receipt</button>
   {requested && <button onClick={() => setRequested(false)}>Dismiss {action} evidence</button>}
  </div>
  {requested && <Resource value={{...report,reload:null}}>{status => <p role="status">{findings[status]}</p>}</Resource>}
 </section>;
}
