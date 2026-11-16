import {useLayoutEffect, useRef, useState} from 'react';
import {Detail, Resource, rpc, rpcNftCollectionObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {matchesCollectibleReadiness, nftCollectionObservation} from './collectible-observations.js';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis, rpcReceiptReadiness as testnetReadiness} from './rpc-receipt-observation.js';

const yesNo = flag => flag ? 'Yes' : 'No';

export function WalletRpcCollectionCheck({endpoint, selection, inventory, canRead}) {
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const observation = useResource(async signal => {
    if (!revision) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canRead()) throw Error('The selected Wallet collectible changed.');
    }
    checkScope();
    const readiness = await readProtocolObservation(async (method, params, options) => {
      checkScope();
      const result = await rpc(method, params, options);
      checkScope();
      return result;
    }, 'synergy_getReadiness', endpoint, signal, testnetReadiness);
    checkConfiguredGenesis(readiness.chain, endpoint.genesisHash);
    if (!matchesCollectibleReadiness(inventory.chainContext, readiness)) {
      throw Error('The selected RPC chain identity changed. Refresh the owner NFT snapshot before checking the collection.');
    }

    checkScope();
    let response;
    try {
      response = await rpcNftCollectionObservation({endpoint: endpoint.rpc, signal, collectionId: selection.collectionId});
    } catch {
      checkScope();
      throw Error('The selected NFT collection is unavailable from this RPC.');
    }
    checkScope();
    return nftCollectionObservation(response, selection, inventory, readiness);
  }, revision);

  return <section aria-label="Selected RPC NFT collection check">
    <button disabled={!!revision && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check collection on selected RPC again' : 'Check collection on selected RPC'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <SourceAge source="Selected RPC collection snapshot" updatedAt={value.receivedAt}/>
      <Detail data={{reportedCollectionVerified: yesNo(value.verified), reportedTransferable: yesNo(value.transferable),
        reportedIssuerApprovalRequired: yesNo(value.issuerApproval), reportedMetadataMutable: yesNo(value.metadataMutable),
        reportedImageLocked: yesNo(value.imageLocked), collectionMetadataHash: value.metadataHash ?? 'Unavailable',
        collectionImageHash: value.imageHash ?? 'Unavailable', reportedCollectionSnapshotHeight: value.snapshotHeight,
        reportedCollectionSnapshotHash: value.snapshotHash}}/>
      <p>These are the endpoint’s collection flags and commitments. Independent ownership, transfer eligibility and media verification remain open.</p>
    </>}</Resource>}
  </section>;
}
