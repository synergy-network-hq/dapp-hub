import {useState} from 'react';
import {Detail, Resource, rpc, rpcTokenDefinitionObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {matchesTokenReadiness, rpcTokenDefinition} from './token-balance-inventory.js';
import {requireWalletReadScope, useWalletReadScope} from './wallet-account-read.js';

export function WalletRpcTokenDefinition({endpoint, inventory, item, canRead}) {
  const [revision, setRevision] = useState(0);
  const allowed = useWalletReadScope(revision, canRead);
  const observation = useResource(async signal => {
    if (!revision) return null;
    let readiness;
    try {
      readiness = await readProtocolObservation(async (method, params, options) => {
        requireWalletReadScope(signal, allowed);
        const result = await rpc(method, params, options);
        requireWalletReadScope(signal, allowed);
        return result;
      }, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    } catch {
      requireWalletReadScope(signal, allowed);
      throw Error('The selected RPC chain context could not be checked. Try again.');
    }
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    if (!matchesTokenReadiness(inventory.chainContext, readiness)) {
      throw Error('The selected RPC chain identity changed. Check the owner inventory again.');
    }
    requireWalletReadScope(signal, allowed);
    let response;
    try {
      response = await rpcTokenDefinitionObservation({endpoint: endpoint.rpc, signal, tokenId: item.tokenId});
    } catch {
      requireWalletReadScope(signal, allowed);
      throw Error('The selected token definition is unavailable from this RPC.');
    }
    requireWalletReadScope(signal, allowed);
    return rpcTokenDefinition(response, item, inventory, readiness);
  }, revision);

  return <section aria-label="Selected RPC token definition">
    <button disabled={!!revision && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check token definition again' : 'Check token definition on selected RPC'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <SourceAge source="Selected RPC token definition snapshot" updatedAt={value.receivedAt}/>
      <Detail data={{reportedClass: value.tokenClass.toUpperCase(), reportedVerified: value.verified ? 'Yes' : 'No',
        reportedPaused: value.paused ? 'Yes' : 'No', totalSupplyAtomic: value.total,
        maxSupplyAtomic: value.maximum ?? 'No cap reported', metadataHash: value.metadataHash ?? 'Unavailable',
        imageHash: value.imageHash ?? 'Unavailable', definitionSnapshotHeight: value.snapshotHeight,
        definitionSnapshotHash: value.snapshotHash}}/>
      <p>The endpoint reports these flags and commitments. Independent provenance and transfer eligibility remain unverified.</p>
    </>}</Resource>}
  </section>;
}
