import {useState} from 'react';
import {Card, Detail, Resource, rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {canCompareEndpoint, readNetworkComparison,networkComparisonScope} from './network-comparison.js';

const fieldNames = {chainId: 'chain ID', network: 'network ID', incarnation: 'incarnation', genesis: 'genesis hash'};

export function NetworkComparison({profile, profiles, permitted, onOpenEndpoints}) {
 const references = profiles.filter(candidate => canCompareEndpoint(profile, candidate));
 const scope = networkComparisonScope(profile,references,permitted);
 return <NetworkComparisonView key={scope} profile={profile} references={references}
  permitted={permitted} onOpenEndpoints={onOpenEndpoints}/>;
}

function IdentityReport({title, observation}) {
 return <section>
  <h3>{title}</h3>
  {observation ? <>
   <SourceAge source="Public RPC identity report" updatedAt={observation.receivedAt}/>
   <Detail data={observation.chain}/>
  </> : <p>A matching, supported RPC report could not be read.</p>}
 </section>;
}

function NetworkComparisonView({profile, references, permitted, onOpenEndpoints}) {
 const [referenceId, setReferenceId] = useState('');
 const [reviewing, setReviewing] = useState(false);
 const reference = references.find(endpoint => endpoint.id === referenceId);
 const requested = permitted && reviewing && Boolean(reference);
 const comparison = useResource(signal => requested ? readNetworkComparison(rpc, profile, reference, signal) : null,
  JSON.stringify([requested, referenceId]));

 function compare() {
  if (!permitted || !reference) return;
  if (requested) comparison.reload();
  else setReviewing(true);
 }

 return <Card title="Compare public network identity">
  <p>Compare the reported network ID, incarnation and genesis hash before preparing an installation plan. Configured Genesis pins must match each endpoint's report. Matching reports describe agreement between RPC responses. Managed-host verification and release approval are separate.</p>
  {!permitted ? <p>Allow NodeNetwork reads in Security & permissions to compare endpoints.</p> : !references.length ? <>
   <p>Add a second RPC for chain {profile.chainId} to compare with {profile.name}.</p>
   <button onClick={onOpenEndpoints}>Open Portal endpoint settings</button>
  </> : <>
   <label>Reference RPC
    <select value={referenceId} onChange={event => {setReferenceId(event.target.value); setReviewing(false);}}>
     <option value="">Choose another RPC for chain {profile.chainId}</option>
     {references.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
    </select>
   </label>
   <button disabled={!reference || (requested && comparison.loading)} onClick={compare}>Compare reported network identity</button>
  </>}
  {requested && <Resource value={comparison}>{value => <>
   <p role={value.outcome === 'mismatch' ? 'alert' : 'status'}>{value.outcome === 'match'
    ? 'The reported network identities match.'
    : value.outcome === 'mismatch'
     ? `The reports disagree on ${value.differences.map(field => fieldNames[field]).join(', ')}. Resolve the discrepancy before relying on this network context.`
     : 'Comparison unavailable. Both RPCs must return supported reports for this chain.'}</p>
   <div className="native-grid">
    <IdentityReport title={`Observation RPC · ${profile.name}`} observation={value.selected}/>
    <IdentityReport title={`Reference RPC · ${reference.name}`} observation={value.reference}/>
   </div>
  </>}</Resource>}
 </Card>;
}
