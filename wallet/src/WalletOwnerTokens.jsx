import {useLayoutEffect, useRef, useState} from 'react';
import {Card, Detail, Resource, rpcTokenInventoryObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {rpcTokenBalanceInventory, RPC_TOKEN_INVENTORY_LIMIT} from './token-balance-inventory.js';
import {isProtectedWalletAddress} from './wallet-address.js';
import {readProtectedWalletReadiness} from './wallet-owner-readiness.js';
import {WalletTokens} from './WalletTokens.jsx';

export function WalletOwnerTokens({account, endpoint, canRead}) {
  const [request, setRequest] = useState(0);
  const mounted = useRef(false);
  const supportedAccount = isProtectedWalletAddress(account);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const observation = useResource(async signal => {
    if (!request) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canRead()) throw Error('The Wallet token context changed.');
    }

    const readiness = await readProtectedWalletReadiness(account, endpoint, signal, checkScope);
    checkScope();
    let response;
    try {
      response = await rpcTokenInventoryObservation({endpoint: endpoint.rpc, signal, owner: account, limit: RPC_TOKEN_INVENTORY_LIMIT});
    } catch {
      checkScope();
      throw Error('The owner token inventory is unavailable or exceeds Wallet’s supported response size.');
    }
    checkScope();
    return rpcTokenBalanceInventory(response, account, readiness);
  }, request);

  return <Card title="Selected RPC token inventory">
    {supportedAccount ? <>
      <p>This check sends your public Wallet address to the selected RPC. Wallet supports replies with up to {RPC_TOKEN_INVENTORY_LIMIT} rows.</p>
      <button disabled={!!request && observation.loading} onClick={() => setRequest(value => value + 1)}>
        {request ? 'Check owner token inventory again' : 'Check owner token inventory'}
      </button>
      {!!request && <Resource value={{...observation, reload: undefined}}>{inventory => <>
        <SourceAge source="Selected RPC token inventory" updatedAt={inventory.receivedAt}/>
        <Detail data={{reportedStsSnapshotHeight: inventory.snapshotHeight, reportedStsSnapshotHash: inventory.snapshotHash}}/>
        <p>The endpoint reports native SNRG from its ledger and STS balances from the reported snapshot. Spendability remains unverified.</p>
        {inventory.items.length === 1 && <p>The endpoint returned no STS token balances for this snapshot.</p>}
        <WalletTokens inventory={inventory}/>
      </>}</Resource>}
    </> : <p>A current protected Wallet address is required for this check.</p>}
  </Card>;
}
