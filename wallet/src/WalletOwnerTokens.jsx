import {Card, Detail, Resource, rpcTokenInventoryObservation} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {rpcTokenBalanceInventory, RPC_TOKEN_INVENTORY_LIMIT} from './token-balance-inventory.js';
import {useWalletOwnerSnapshot} from './wallet-owner-readiness.js';
import {WalletTokens} from './WalletTokens.jsx';

export function WalletOwnerTokens({account, endpoint, canRead}) {
  const {observation, requested, check, supportedAccount} = useWalletOwnerSnapshot({account, endpoint, canRead,
    read: rpcTokenInventoryObservation, parse: rpcTokenBalanceInventory, limit: RPC_TOKEN_INVENTORY_LIMIT,
    unavailable: 'The owner token inventory is unavailable or exceeds Wallet’s supported response size.'});

  return <Card title="Selected RPC token inventory">
    {supportedAccount ? <>
      <p>This check sends your public Wallet address to the selected RPC. Wallet supports replies with up to {RPC_TOKEN_INVENTORY_LIMIT} rows.</p>
      <button disabled={requested && observation.loading} onClick={check}>
        {requested ? 'Check owner token inventory again' : 'Check owner token inventory'}
      </button>
      {requested && <Resource value={{...observation, reload: undefined}}>{inventory => <>
        <SourceAge source="Selected RPC token inventory" updatedAt={inventory.receivedAt}/>
        <Detail data={{reportedStsSnapshotHeight: inventory.snapshotHeight, reportedStsSnapshotHash: inventory.snapshotHash}}/>
        <p>The endpoint reports native SNRG from its ledger and STS balances from the reported snapshot. Spendability remains unverified.</p>
        {inventory.items.length === 1 && <p>The endpoint returned no STS token balances for this snapshot.</p>}
        <WalletTokens inventory={inventory}/>
      </>}</Resource>}
    </> : <p>A current protected Wallet address is required for this check.</p>}
  </Card>;
}
