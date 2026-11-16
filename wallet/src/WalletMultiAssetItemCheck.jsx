import {useState} from 'react';
import {Detail, Resource, rpc, rpcMultiAssetItemObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {matchesCollectibleReadiness, multiAssetItemObservation} from './collectible-observations.js';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {requireWalletReadScope, useWalletReadScope} from './wallet-account-read.js';

export function WalletMultiAssetItemCheck({endpoint, inventory, selected, canRead}) {
  const [revision, setRevision] = useState(0);
  const allowed = useWalletReadScope(revision, canRead);
  const observation = useResource(async signal => {
    if (!revision) return null;
    let readiness;
    try {
      readiness = await readProtocolObservation(async (method, params, options) => {
        requireWalletReadScope(signal, allowed);
        const value = await rpc(method, params, options);
        requireWalletReadScope(signal, allowed);
        return value;
      }, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    } catch {
      requireWalletReadScope(signal, allowed);
      throw Error('The selected RPC chain context could not be checked. Try again.');
    }
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    if (!matchesCollectibleReadiness(inventory.chainContext, readiness)) {
      throw Error('The selected RPC chain identity changed. Check the multi-asset holdings again.');
    }
    requireWalletReadScope(signal, allowed);
    let response;
    try {
      response = await rpcMultiAssetItemObservation({endpoint: endpoint.rpc, signal,
        collectionId: selected.collectionId, itemId: selected.itemId});
    } catch {
      requireWalletReadScope(signal, allowed);
      throw Error('The selected item definition is unavailable from this RPC.');
    }
    requireWalletReadScope(signal, allowed);
    return multiAssetItemObservation(response, selected, inventory, readiness);
  }, revision);

  return <section aria-label="Selected RPC multi-asset item definition">
    <button disabled={!!revision && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check item definition again' : 'Check item definition on selected RPC'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <SourceAge source="Selected RPC multi-asset item snapshot" updatedAt={value.receivedAt}/>
      <Detail data={{reportedType: value.type, reportedDecimals: value.decimals, reportedTransferPolicy: value.policy,
        totalSupplyAtomic: value.total, maxSupplyAtomic: value.maximum ?? 'No cap reported',
        metadataHash: value.metadataHash ?? 'Unavailable', definitionSnapshotHeight: value.snapshotHeight,
        definitionSnapshotHash: value.snapshotHash}}/>
      <p>These fields describe the reported item definition. Holdings and transfer eligibility require separate evidence.</p>
    </>}</Resource>}
  </section>;
}
