import {useLayoutEffect, useRef, useState} from 'react';
import {Detail, Resource, rpcNftInstanceObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {matchesCollectibleReadiness, nftInstanceObservation} from './collectible-observations.js';
import {readProtectedWalletReadiness} from './wallet-owner-readiness.js';

export function WalletRpcNftInstanceCheck({endpoint, selection, inventory, canRead}) {
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
    const readiness = await readProtectedWalletReadiness(selection.ownerAddress, endpoint, signal, checkScope);
    if (!matchesCollectibleReadiness(inventory.chainContext, readiness)) {
      throw Error('The selected RPC chain identity changed. Refresh the owner NFT snapshot before checking this NFT.');
    }
    checkScope();
    let response;
    try {
      response = await rpcNftInstanceObservation({endpoint: endpoint.rpc, signal, nftId: selection.nftId});
    } catch {
      checkScope();
      throw Error('This NFT is unavailable from the selected RPC. Try again or refresh the inventory.');
    }
    checkScope();
    return nftInstanceObservation(response, selection, inventory, readiness);
  }, revision);

  return <section aria-label="Selected RPC NFT instance check">
    <h4>NFT instance</h4>
    <p>This check sends only the public NFT ID to the selected RPC.</p>
    <button disabled={!!revision && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check this NFT again' : 'Check this NFT on selected RPC'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <SourceAge source="Selected RPC NFT snapshot" updatedAt={value.receivedAt}/>
      <p role="status">{value.sameOwner ? 'The NFT record lists this Wallet as owner.' :
        'The selected RPC reports a different NFT owner. Refresh the inventory.'}</p>
      {value.burned && <p>The selected RPC reports this NFT as burned.</p>}
      <Detail data={{reportedNftStatus: value.status, reportedSerialNumber: value.serial,
        reportedExpiry: value.expiry ? new Date(Number(value.expiry) * 1000).toISOString() : 'No expiry reported',
        reportedTransferable: value.transferable ? 'Yes' : 'No',
        reportedIssuerApprovalRequired: value.issuerApproval ? 'Yes' : 'No',
        reportedMetadataMutable: value.metadataMutable ? 'Yes' : 'No',
        reportedMetadataReference: value.metadataReferencePresent ? 'Present' : 'Unavailable',
        reportedNftMetadataHash: value.metadataHash ?? 'Unavailable',
        reportedNftSnapshotHeight: value.snapshotHeight, reportedNftSnapshotHash: value.snapshotHash}}/>
      <p>The status and policy flags describe the reported snapshot. Transfer eligibility and independent ownership verification remain open.</p>
    </>}</Resource>}
  </section>;
}
