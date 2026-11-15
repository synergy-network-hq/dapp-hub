import {useState} from 'react';
import {Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';

export function ValidatorActiveList({address, readListing}) {
 const [requested, setRequested] = useState(false);
 const observation = useResource(signal => requested ? readListing(address, signal) : null, JSON.stringify([address, requested]));

 return <section aria-label="Selected RPC active validator list">
  <h3>RPC active validator listing</h3>
  <p>Check whether the selected Testnet RPC lists {address}. Activation eligibility, finalized membership and live duties require separate evidence.</p>
  <button disabled={requested && observation.loading} onClick={() => requested ? observation.reload() : setRequested(true)}>Check RPC active validator list</button>
  {requested && <Resource value={observation}>{value => <>
   <p role="status">{value.listed ? 'This validator appears in the selected RPC list.' : 'This validator was absent from the selected RPC list.'} {value.count} {value.count === 1 ? 'entry' : 'entries'} returned.</p>
   <SourceAge updatedAt={value.receivedAt} source="Selected Testnet RPC active validator list"/>
  </>}</Resource>}
 </section>;
}
