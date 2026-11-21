import {useLayoutEffect, useRef, useState} from 'react';
import {ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {compareSavedVpnRetirement, savedVpnRetirementPins} from './saved-vpn-retirement.js';

const pinVerdicts = {
 matched:'digest matches the supplied SHA-256.',
 'pin-mismatch':'digest differs from the supplied SHA-256.',
 'format-unsupported':'digest matches the supplied SHA-256. The record format is unsupported.',
 unavailable:'digest could not be checked.',
};

function VpnRetirementFindings({report}) {
 return <section aria-label="Saved VPN retirement findings">
  <ul>
   <li>Binding record {pinVerdicts[report.bindingStatus]}</li>
   <li>Retirement record {pinVerdicts[report.retirementStatus]}</li>
   <li>{report.peerMatches === null ? 'Peer comparison unavailable.'
    : report.peerMatches ? 'The records name the same peer.' : 'The records name different peers.'}</li>
   <li>{report.retired === null ? 'Peer retirement was not reported by a supported retirement record.'
    : report.retired ? 'The retirement record reports that the peer was retired.' : 'The retirement record reports that the peer was not retired.'}</li>
   <li>{report.absenceVerified === null ? 'Peer absence verification was not reported by a supported retirement record.'
    : report.absenceVerified ? 'The retirement record reports that peer absence was verified.' : 'The retirement record reports that peer absence was not verified.'}</li>
  </ul>
 </section>;
}

function VpnRetirementFiles({pins,canRead}) {
 const [files,setFiles] = useState({});
 const [report,setReport] = useState(null), [error,setError] = useState(''), [reading,setReading] = useState(false);
 const revision = useRef(0);
 const currentPermission = useRef(canRead);
 useLayoutEffect(()=>{currentPermission.current=canRead;},[canRead]);
 useLayoutEffect(()=>()=>{revision.current++;},[]);

 function invalidate() {
  revision.current++;
  setReading(false);
  setReport(null);
  setError('');
 }

 function select(event, role) {
  const file=event.target.files?.[0];
  event.target.value='';
  if (!file || !currentPermission.current()) return;
  invalidate();
  setFiles(previous=>({...previous,[role]:file}));
 }

 async function compare() {
  if (reading || !files.binding || !files.retirement || !currentPermission.current()) return;
  const request=++revision.current;
  const current=()=>revision.current===request&&currentPermission.current();
  setReport(null);
  setError('');
  setReading(true);
  try {
   const findings=await compareSavedVpnRetirement(files,pins,current);
   if (current()) setReport(findings);
  } catch {
   if (current()) setError('The saved VPN records could not be compared.');
  } finally {
   if (revision.current===request) {
    if (!currentPermission.current()) setFiles({});
    setReading(false);
   }
  }
 }

 return <>
  <div className="native-actions">
   <label>Saved VPN binding JSON <input type="file" accept=".json,application/json" onChange={event=>select(event,'binding')}/></label>
   <label>Saved VPN retirement JSON <input type="file" accept=".json,application/json" onChange={event=>select(event,'retirement')}/></label>
  </div>
  {(files.binding||files.retirement)&&<p>{files.binding?'Binding record selected.':'Select a binding record.'} {files.retirement?'Retirement record selected.':'Select a retirement record.'}</p>}
  <div className="native-actions">
   <button disabled={reading||!files.binding||!files.retirement||!canRead()} onClick={compare}>Compare saved VPN records</button>
   {(files.binding||files.retirement)&&<button onClick={()=>{invalidate();setFiles({});}}>Clear saved VPN records</button>}
  </div>
  {reading&&<p role="status">Checking the two saved VPN records…</p>}
  <ErrorMessage error={error}/>
  {report&&canRead()&&<VpnRetirementFindings report={report}/>}
 </>;
}

export function SavedVpnRetirementReview({canRead}) {
 const [binding,setBinding] = useState(''), [retirement,setRetirement] = useState('');
 const pins = savedVpnRetirementPins(binding,retirement);
 return <section aria-label="Saved VPN retirement comparison">
  <h3>Saved VPN retirement comparison</h3>
  <p>Enter the independently supplied SHA-256 for each record, then select the two JSON files. This review describes the saved records. Verify current peer absence with the approved VPN control plane before requesting removal.</p>
  <div className="native-grid">
   <label>Expected VPN binding SHA-256 <input autoComplete="off" maxLength={128} value={binding} onChange={event=>setBinding(event.target.value)}/></label>
   <label>Expected VPN retirement SHA-256 <input autoComplete="off" maxLength={128} value={retirement} onChange={event=>setRetirement(event.target.value)}/></label>
  </div>
  {pins ? <VpnRetirementFiles key={`${binding}:${retirement}`} pins={pins} canRead={canRead}/>
   : <p>Enter both 64-character hexadecimal digests to select the files.</p>}
 </section>;
}
