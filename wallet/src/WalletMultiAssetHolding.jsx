import {useId, useRef, useState} from 'react';
import {Detail, Resource, rpcMultiAssetBalanceObservation, rpcMultiAssetItemObservation} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {exactMultiAssetHolding, multiAssetItemDefinition} from './collectible-observations.js';
import {exactRpcAmount, maxU64} from './rpc-unsigned.js';
import {isStsMultiAssetCollectionId} from './wallet-address.js';
import {readProtectedWalletReadiness, useWalletOwnerSnapshot} from './wallet-owner-readiness.js';

function HoldingResult({account, endpoint, selection, canRead}) {
  const {observation} = useWalletOwnerSnapshot({account, endpoint, canRead, startOnMount: true,
    async readReadiness(owner, endpoint, signal, checkScope) {
      const readiness = await readProtectedWalletReadiness(owner, endpoint, signal, checkScope);
      checkScope();
      let response;
      try {
        response = await rpcMultiAssetItemObservation({endpoint: endpoint.rpc, signal, ...selection});
      } catch {
        checkScope();
        throw Error('The item definition is unavailable from the selected RPC. Its balance was not checked.');
      }
      checkScope();
      return {readiness, definition: multiAssetItemDefinition(response, selection, readiness)};
    },
    read: ({endpoint, signal, owner}) => rpcMultiAssetBalanceObservation({endpoint, signal, owner, ...selection}),
    parse: (response, owner, {readiness, definition}) => exactMultiAssetHolding(response, owner, selection, definition, readiness),
    unavailable: 'The item balance is unavailable from the selected RPC.'});

  return <Resource value={{...observation, reload: undefined}}>{value => <>
    <SourceAge source="Selected RPC multi-asset holding snapshot" updatedAt={value.receivedAt}/>
    <Detail data={{...selection, reportedAtomicQuantity: value.amount, reportedType: value.type,
      reportedDecimals: value.decimals, reportedTransferPolicy: value.policy,
      reportedSnapshotHeight: value.snapshotHeight, reportedSnapshotHash: value.snapshotHash}}/>
    <p>Transfer eligibility remains unverified.</p>
  </>}</Resource>;
}

export function WalletMultiAssetHolding({account, endpoint, canRead}) {
  const [collectionId, setCollectionId] = useState('');
  const [itemId, setItemId] = useState('');
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const revision = useRef(0);
  const errorId = useId();

  function clear() {
    revision.current++;
    setRequest(null);
    setError(null);
  }

  function check(event) {
    event.preventDefault();
    if (!canRead()) return;
    if (!isStsMultiAssetCollectionId(collectionId)) {
      setError({field: 'collection', message: 'Enter the exact checksummed multi-asset collection ID.'});
    } else if (itemId === '0' || exactRpcAmount(itemId, maxU64) === null) {
      setError({field: 'item', message: 'Enter an exact positive decimal item ID.'});
    } else {
      setError(null);
      setRequest({selection: {collectionId, itemId}, revision: ++revision.current});
    }
  }

  return <section aria-label="Exact multi-asset holding">
    <h3>Check a specific multi-asset holding</h3>
    <form onSubmit={check}>
      <label>Exact multi-asset collection ID<input value={collectionId} maxLength={43} autoComplete="off" autoCapitalize="none" spellCheck={false}
        aria-invalid={error?.field === 'collection'} aria-describedby={error?.field === 'collection' ? errorId : undefined}
        onChange={event => {setCollectionId(event.target.value); clear();}}/></label>
      <label>Exact multi-asset item ID<input value={itemId} maxLength={20} inputMode="numeric" autoComplete="off"
        aria-invalid={error?.field === 'item'} aria-describedby={error?.field === 'item' ? errorId : undefined}
        onChange={event => {setItemId(event.target.value); clear();}}/></label>
      {error && <p id={errorId} role="alert">{error.message}</p>}
      <button type="submit">Check item balance</button>
    </form>
    {request && <HoldingResult key={request.revision} selection={request.selection} {...{account, endpoint}}
      canRead={() => request.revision === revision.current && canRead()}/>}
  </section>;
}
