import {useState} from 'react';
import {Card, Detail, Resource, Table, rpcMultiAssetInventoryObservation} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {ownerMultiAssetObservation, RPC_MULTI_ASSET_LIMIT} from './collectible-observations.js';
import {useWalletOwnerSnapshot} from './wallet-owner-readiness.js';
import {WalletMultiAssetItemCheck} from './WalletMultiAssetItemCheck.jsx';

const columns = [{key: 'itemId', label: 'Item ID'}, {key: 'collectionId', label: 'Collection'},
  {key: 'amount', label: 'Reported atomic quantity'}];

function MultiAssetRows({inventory, endpoint, canRead}) {
  const {items} = inventory;
  const [collection, setCollection] = useState('');
  const [selection, setSelection] = useState(null);
  const collections = [...new Set(items.map(item => item.collectionId))];
  const visible = collection ? items.filter(item => item.collectionId === collection) : items;
  const selected = visible.find(item => item.key === selection);

  if (!items.length) return <p>The selected RPC returned no multi-asset balances for this snapshot.</p>;
  return <>
    <label>Filter multi-asset collection<select value={collection} onChange={event => {
      setCollection(event.target.value);
      setSelection(null);
    }}>
      <option value="">All returned collections</option>
      {collections.map(id => <option value={id} key={id}>{id}</option>)}
    </select></label>
    <Table rows={visible} columns={columns} onSelect={item => setSelection(item.key)}/>
    {selected && <aside aria-label="Selected multi-asset item">
      <h3>Item {selected.itemId}</h3>
      <Detail data={{collectionId: selected.collectionId, itemId: selected.itemId,
        reportedOwner: selected.ownerAddress, reportedAtomicQuantity: selected.amount}}/>
      <WalletMultiAssetItemCheck key={selected.key} {...{endpoint, inventory, selected, canRead}}/>
    </aside>}
  </>;
}

export function WalletMultiAssetInventory({account, endpoint, canRead}) {
  const {observation, requested, check, supportedAccount} = useWalletOwnerSnapshot({account, endpoint, canRead,
    read: rpcMultiAssetInventoryObservation, parse: ownerMultiAssetObservation, limit: RPC_MULTI_ASSET_LIMIT,
    unavailable: 'The multi-asset snapshot is unavailable or exceeds Wallet’s supported response size.'});

  return <Card title="Selected RPC multi-asset holdings">
    {supportedAccount ? <>
      <p>This check sends your public Wallet address to the selected RPC. Wallet supports replies with up to {RPC_MULTI_ASSET_LIMIT} rows.</p>
      <button disabled={requested && observation.loading} onClick={check}>
        {requested ? 'Check multi-asset holdings again' : 'Check multi-asset holdings'}
      </button>
      {requested && <Resource value={{...observation, reload: undefined}}>{value => <>
        <SourceAge source="Selected RPC multi-asset snapshot" updatedAt={value.receivedAt}/>
        <Detail data={{reportedSnapshotHeight: value.snapshotHeight, reportedSnapshotHash: value.snapshotHash}}/>
        <p>The balance response supplies atomic quantities. Select an item to check its reported type and decimal precision.</p>
        <MultiAssetRows inventory={value} {...{endpoint, canRead}}/>
      </>}</Resource>}
    </> : <p>A current protected Wallet address is required for this check.</p>}
  </Card>;
}
