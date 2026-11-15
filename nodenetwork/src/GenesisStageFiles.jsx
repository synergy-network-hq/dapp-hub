import {useEffect, useRef, useState} from 'react';
import {Table} from '@synergy-network/portal-native/dapp-sdk';
import {genesisStageFiles, inspectGenesisStageFile} from './genesis-stage-files.js';

const columns = [
 {key: 'id', label: 'Input'}, {key: 'observed', label: 'Local SHA-256'},
 {key: 'expected', label: 'Target-reported pin'}, {key: 'status', label: 'Comparison'},
];

export function GenesisStageFiles({permitted, policy}) {
 const [measurements, setMeasurements] = useState({});
 const attempts = useRef({});
 useEffect(() => () => {attempts.current = {};}, []);

 async function select(input, file) {
  const attempt = Symbol();
  attempts.current[input.name] = attempt;
  const publish = value => {
   if (attempts.current[input.name] === attempt) {
    setMeasurements(current => ({...current, [input.name]: value}));
   }
  };
  publish({status: 'Reading…'});
  try {
   publish({digest: await inspectGenesisStageFile(input, file)});
  } catch (error) {
   publish({status: error.message || 'Could not calculate the file digest.'});
  }
 }

 const rows = genesisStageFiles.map(({name, pin}) => {
  const measured = measurements[name];
  const expected = policy?.[pin];
  let status = measured?.status ?? 'Select a file';
  if (measured?.digest) status = expected ? (measured.digest === expected ? 'Match' : 'Mismatch') : 'No target pin reviewed';
  return {id: name, observed: measured?.digest, expected, status};
 });
 return <details>
  <summary>Compare Genesis input files</summary>
  <p>Portal calculates each file’s SHA-256 from its exact bytes on this device. Approved pins appear after a compatible controller reports its staging policy. Matching bytes and signed Genesis verification are separate checks.</p>
  {!permitted && <p>Allow NodeNetwork inspection in Security &amp; permissions to review local inputs.</p>}
  {genesisStageFiles.map(input => <label key={input.name}>
   {input.name}
   <input type="file" disabled={!permitted} aria-label={`Select ${input.name}`} onChange={event => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (permitted && file) select(input, file);
   }}/>
  </label>)}
  <Table columns={columns} rows={rows}/>
  <button disabled={!permitted || Object.keys(measurements).length === 0} onClick={() => {
   attempts.current = {};
   setMeasurements({});
  }}>Clear selected file results</button>
 </details>;
}
