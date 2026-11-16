import {useState} from 'react';
import {Resource,useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests,nodeNetworkReviewUpgradeReceipt} from './native-services.js';
import {releaseReferenceChecks,upgradeParameters} from './nodeNetwork.js';
import {retainsUnresolvedDispatch} from './request-history.js';

const findings={
 match:'The controller reports an installation receipt with the same manifest digest.',
 different:'The controller reports an installation receipt with a different manifest digest.',
 unavailable:'The controller could not provide a supported installation receipt comparison.',
};

export function UpgradeReceiptReview({target,record,fingerprint,targetScopeCurrent}) {
 const [references,setReferences]=useState({release_id:'',manifest_sha256:''});
 const [selection,setSelection]=useState(null);
 const report=useResource(async signal=>{
  if (!selection) return null;
  const requireCurrent=()=>{
   signal.throwIfAborted();
   if (!targetScopeCurrent()) throw Error('The target, recovery state or permission changed. Review the configured target again.');
  };
  const recheck=async()=>{
   requireCurrent();
   const history=await nodeNetworkRequests().catch(()=>{throw Error('The local upgrade dispatch could not be rechecked. Refresh local history.');});
   requireCurrent();
   if (!retainsUnresolvedDispatch(history.records,record,fingerprint)) {
    throw Error('The selected upgrade dispatch changed. Refresh local history and select it again.');
   }
  };
  await recheck();
  requireCurrent();
  const status=await nodeNetworkReviewUpgradeReceipt(target,record.id,selection);
  await recheck();
  requireCurrent();
  return status;
 },selection);

 function edit(key,value) {
  setSelection(null);
  setReferences(previous=>({...previous,[key]:value}));
 }

 return <section aria-label="Current upgrade receipt">
  <p>Enter the original release and manifest from this upgrade. This comparison checks the reported installation receipt. The prior dispatch remains unresolved and conformance requires separate evidence.</p>
  <div className="native-actions">
   <label>Recorded upgrade release ID <input value={references.release_id} autoComplete="off" maxLength={129}
    onChange={event=>edit('release_id',event.target.value)}/></label>
   <label>Recorded upgrade manifest SHA-256 <input value={references.manifest_sha256} autoComplete="off" maxLength={65}
    onChange={event=>edit('manifest_sha256',event.target.value)}/></label>
   <button disabled={releaseReferenceChecks(references).some(field=>!field.valid)||(selection&&report.loading)}
    onClick={()=>setSelection(upgradeParameters(references))}>Compare current upgrade receipt</button>
   {selection&&<button onClick={()=>setSelection(null)}>Dismiss upgrade evidence</button>}
  </div>
  {selection&&targetScopeCurrent()&&<Resource value={{...report,reload:null}}>{status=><p role="status">{findings[status]}</p>}</Resource>}
 </section>;
}
