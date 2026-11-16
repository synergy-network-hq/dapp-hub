import {useEffect,useRef,useState} from 'react';
import {Card,Detail,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {nodeNetworkReviewOperatorKey} from './native-services.js';

const empty = {fingerprint:null,error:'',reading:false};

function PublicKeyPicker({canRead}) {
 const [result,setResult] = useState(empty);
 const generation = useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);

 async function inspect() {
  if (!canRead() || result.reading) return;
  const request = ++generation.current;
  const current = ()=>request===generation.current && canRead();
  setResult({...empty,reading:true});
  try {
   const fingerprint = await nodeNetworkReviewOperatorKey();
   if (current()) setResult({...empty,fingerprint});
  } catch (error) {
   if (current()) setResult({...empty,error:error.message});
  }
 }

 return <>
  <button disabled={result.reading} onClick={inspect}>{result.reading?'Inspecting public key…':'Inspect operator SSH public key'}</button>
  {result.fingerprint && <section aria-label="Reviewed operator public key">
   <p role="status">The file contains a supported OpenSSH Ed25519 public key.</p>
   <Detail data={{'canonical key SHA-256':result.fingerprint}}/>
  </section>}
  <ErrorMessage error={result.error}/>
 </>;
}

export function OperatorPublicKeyReview({permitted,canRead=()=>permitted}) {
 return <Card title="Bootstrap operator public key">
  <p>Choose the Ed25519 .pub file that the operator plans to use. Compare this SHA-256 with the fingerprint in the native bootstrap confirmation.</p>
  {permitted ? <PublicKeyPicker canRead={canRead}/>
   : <p>Allow NodeNetwork inspection in Security &amp; permissions to review an operator public key.</p>}
 </Card>;
}
