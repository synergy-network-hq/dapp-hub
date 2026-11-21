import {useState} from 'react';
import {Card, Detail, ErrorMessage, Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {validatorLookupAddress} from './validator-lookup.js';

const snrg = value => `${amount(value)} SNRG (${value} nWei)`;
const unknown = value => value ?? 'Not reported';

function ValidatorRecord({observation}) {
 const {address, record, incarnation, receivedAt} = observation;
 return <section aria-label="Selected RPC validator record">
  <SourceAge updatedAt={receivedAt} source="Selected Testnet RPC validator record"/>
  <Detail data={{validatorAddress:address,reportedIncarnation:incarnation}}/>
  {record === null ? <p role="status">The selected RPC returned no record for this validator.</p> : <>
   <Detail data={{reportedStatus:record.status,reportedStake:snrg(record.stakeNwei),reportedMinimum:snrg(record.minimumNwei)}}/>
   <h4>Reported activation and assignment</h4>
   <Detail data={{
    activationReference:record.activationReference === 'genesis' ? 'Genesis marker' : unknown(record.activationReference),
    shadowStartedAtHeight:unknown(record.shadow_started_at_height),
    activationRecordedHeight:unknown(record.activation_recorded_height),
    activationEffectiveHeight:unknown(record.activation_effective_height),
    cluster:unknown(record.cluster_id),
    clusterAssignmentEpoch:unknown(record.cluster_assignment_epoch),
    clusterAssignmentEffectiveHeight:unknown(record.cluster_assignment_effective_height),
   }}/>
  </>}
 </section>;
}

function Lookup({readRecord}) {
 const [address, setAddress] = useState('');
 const [selected, setSelected] = useState(null);
 const [error, setError] = useState('');
 const observation = useResource(signal => selected ? readRecord(selected, signal) : null, selected);

 function submit(event) {
  event.preventDefault();
  if (selected && observation.loading) return;
  setError('');
  try {
   const requested = validatorLookupAddress(address);
   if (selected === requested) observation.reload();
   else setSelected(requested);
  } catch (failure) {
   setSelected(null);
   setError(failure.message);
  }
 }

 return <>
  <form onSubmit={submit}>
   <label>SYNV validator address
    <input value={address} maxLength={128} autoComplete="off" onChange={event => {
     setAddress(event.target.value);
     setSelected(null);
     setError('');
    }}/>
   </label>
   <button disabled={!address.trim() || (selected && observation.loading)}>Check validator record</button>
  </form>
  <ErrorMessage error={error}/>
  {selected && <Resource value={observation}>{value => <ValidatorRecord observation={value}/>}</Resource>}
 </>;
}

export function ValidatorRegistration({permitted, testnet, readRecord}) {
 return <Card title="Public validator stake and registration">
  <p>The selected RPC may include Genesis and configured validators. Finalized stake ownership, eligibility and activation require separate chain evidence.</p>
  {!permitted ? <p>Allow NodeNetwork network reads in Security &amp; permissions to check a record.</p>
   : testnet ? <Lookup readRecord={readRecord}/>
   : <p>Select a Synergy Testnet chain 1266 observation network to check a record.</p>}
 </Card>;
}
