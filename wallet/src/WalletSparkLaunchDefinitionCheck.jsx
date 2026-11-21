import {useState} from 'react';
import {Detail, Resource, rpcTokenDefinitionObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {requireWalletReadScope} from './wallet-account-read.js';
import {readNftWalletReadiness} from './wallet-owner-readiness.js';
import {rpcTokenDefinitionEvidence} from './token-balance-inventory.js';

const statuses = {
  absent: 'The selected RPC did not report a token definition at this snapshot.',
  match: 'The reported B1 definition matches the checked draft fields.',
  different: 'The reported B1 definition differs from the launch draft.',
  incomplete: 'The selected RPC did not report all commitments needed for this comparison.',
};

function compareLaunchDefinition(draft, definition) {
  if (definition.state === 'absent') return definition;
  const differences = [];
  if (definition.tokenClass !== 'b1') differences.push('Token class');
  if (definition.symbol !== draft.symbol) differences.push('Token symbol');
  if (definition.decimals !== draft.decimals) differences.push('Decimals');
  if (definition.maximum !== draft.supply) differences.push('Fixed supply cap');

  const unavailable = [];
  for (const [label, expected, reported] of [
    ['Metadata SHA3-256', draft.metadataHash, definition.metadataHash],
    ['Image SHA3-256', draft.imageHash, definition.imageHash],
  ]) {
    if (expected === null) continue;
    if (reported === null) unavailable.push(label);
    else if (reported !== expected) differences.push(label);
  }
  const state = differences.length ? 'different' : unavailable.length ? 'incomplete' : 'match';
  return {...definition, state, differences, unavailable};
}

export function WalletSparkLaunchDefinitionCheck({draft, endpoint, canRead}) {
  const [revision, setRevision] = useState(0);
  const observation = useResource(async signal => {
    if (!revision) return null;
    const checkScope = () => requireWalletReadScope(signal, canRead);
    const readiness = await readNftWalletReadiness(draft.creatorAddress, endpoint, signal, checkScope);
    if (readiness.chain.incarnation !== '5') throw Error('The selected RPC did not report the pinned Testnet STS incarnation.');
    checkScope();
    let response;
    try {
      response = await rpcTokenDefinitionObservation({endpoint: endpoint.rpc, signal, tokenId: draft.expectedTokenId});
    } catch {
      checkScope();
      throw Error('Token definition evidence is unavailable from the selected RPC.');
    }
    checkScope();
    return compareLaunchDefinition(draft, rpcTokenDefinitionEvidence(response, draft.expectedTokenId, readiness));
  }, revision);

  return <section aria-label="B1 launch definition check">
    <p>Compare this draft with the selected RPC’s reported definition using only the public token ID.</p>
    <button type="button" disabled={revision > 0 && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check reported token definition again' : 'Check reported token definition'}
    </button>
    {revision > 0 && canRead() && <Resource value={{...observation, reload: undefined}}>{value => <>
      <p role="status">{statuses[value.state]}</p>
      <SourceAge source="Selected RPC B1 definition snapshot" updatedAt={value.receivedAt}/>
      <Detail data={{reportedSnapshotHeight: value.snapshotHeight, reportedSnapshotHash: value.snapshotHash}}/>
      {value.state !== 'absent' && <>
        <Detail data={{reportedCurrentSupplyAtomic: value.total, reportedSupplyCapAtomic: value.maximum ?? 'No cap reported'}}/>
        {value.differences.length > 0 && <p>Fields that differ include {value.differences.join(', ')}.</p>}
        {value.unavailable.length > 0 && <p>Unavailable commitments include {value.unavailable.join(', ')}.</p>}
      </>}
      <p>Deployment and receipt verification require separate evidence.</p>
    </>}</Resource>}
  </section>;
}
