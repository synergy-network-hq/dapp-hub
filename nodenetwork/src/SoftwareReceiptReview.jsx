import {useState} from 'react';
import {Resource,useResource} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkRequests,nodeNetworkReviewSoftwareReceipt} from './native-services.js';
import {releaseReferenceChecks,validInstallNetworkId,validInstallNodeName} from './nodeNetwork.js';
import {retainsUnresolvedDispatch} from './request-history.js';

const releaseFields=[['release_id','release ID',129],['manifest_sha256','manifest SHA-256',65]];
const installFields=[['network_id','network incarnation',129],['chain_id','chain ID',21],['node_name','node name',65]];
const exactChain=value=>value.length<=20&&/^[1-9]/.test(value)&&!/[^0-9]/.test(value)&&BigInt(value)<=18446744073709551615n;

export function SoftwareReceiptReview({target,record,fingerprint,targetScopeCurrent}) {
 const {operation}=record;
 const install=operation==='install';
 const fields=install?[...releaseFields,...installFields]:releaseFields;
 const [references,setReferences]=useState(()=>Object.fromEntries(fields.map(([key])=>[key,''])));
 const [selection,setSelection]=useState(null);
 const identityValid=!install||(validInstallNetworkId(references.network_id)&&validInstallNodeName(references.node_name)&&exactChain(references.chain_id));
 const findings={
  match:install?'The controller reports an installation receipt with the same validator identity and manifest digest.':'The controller reports an installation receipt with the same manifest digest.',
  different:install?'The controller reports a different installation identity or manifest digest.':'The controller reports an installation receipt with a different manifest digest.',
  unavailable:'The controller could not provide a supported installation receipt comparison.',
 };
 const report=useResource(async signal=>{
  if (!selection) return null;
  const requireCurrent=()=>{
   signal.throwIfAborted();
   if (!targetScopeCurrent()) throw Error('The target, recovery state or permission changed. Review the configured target again.');
  };
  const recheck=async()=>{
   requireCurrent();
   const history=await nodeNetworkRequests().catch(()=>{throw Error(`The local ${operation} dispatch could not be rechecked. Refresh local history.`);});
   requireCurrent();
   if (!retainsUnresolvedDispatch(history.records,record,fingerprint)) {
    throw Error(`The selected ${operation} dispatch changed. Refresh local history and select it again.`);
   }
  };
  await recheck();
  requireCurrent();
  const status=await nodeNetworkReviewSoftwareReceipt(target,record.id,operation,selection);
  await recheck();
  requireCurrent();
  return status;
 },selection);

 function edit(key,value) {
  setSelection(null);
  setReferences(previous=>({...previous,[key]:value}));
 }

 return <section aria-label={`Current ${operation} receipt`}>
  <p>{install?'Enter the original release, manifest, network, chain and node name from this install.':'Enter the original release and manifest from this upgrade.'} This comparison checks the reported installation receipt. The prior dispatch remains unresolved and conformance requires separate evidence.</p>
  <div className="native-actions">
   {fields.map(([key,label,length])=><label key={key}>Recorded {operation} {label} <input value={references[key]} autoComplete="off" maxLength={length}
    onChange={event=>edit(key,event.target.value)}/></label>)}
   <button disabled={!identityValid||releaseReferenceChecks(references).some(field=>!field.valid)||(selection&&report.loading)}
    onClick={()=>setSelection({...references})}>Compare current {operation} receipt</button>
   {selection&&<button onClick={()=>setSelection(null)}>Dismiss {operation} evidence</button>}
  </div>
  {selection&&targetScopeCurrent()&&<Resource value={{...report,reload:null}}>{status=><p role="status">{findings[status]}</p>}</Resource>}
 </section>;
}
