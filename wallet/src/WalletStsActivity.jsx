import {useState} from 'react';
import {Card, Detail, Resource, Table, rpcStsActivityObservation} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {useWalletOwnerSnapshot} from './wallet-owner-readiness.js';
import {STS_ACTIVITY_LIMIT, isStsAssetEventId, stsAssetEvent} from './sts-activity.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';

const snapshotSources = new Set(['finalized_sts_snapshot', 'finalized_chain1266_execution_state']);
const assetLabels = {fungible: 'Fungible token', nft: 'NFT', multiAsset: 'Multi-asset'};
const roleLabels = {sender: 'Sender', owner: 'Recorded owner', recipient: 'Recipient'};
const columns = [{key: 'eventLabel', label: 'Event'}, {key: 'assetLabel', label: 'Asset type'}, {key: 'tokenId', label: 'Asset ID'}];

function stsActivityObservation(response, account, readiness) {
  const {value, chainContext} = response;
  const chain = readiness.chain;
  if (chainContext?.chainId !== chain.chainId || String(chainContext.incarnation) !== chain.incarnation ||
      chainContext.genesis !== chain.genesis.toLowerCase()) throw Error('The STS activity response does not match the selected RPC readiness identity.');
  if (value?.owner !== account || value.token_ref !== null) throw Error('The selected RPC returned a different STS activity scope.');

  const snapshotHeight = exactRpcAmount(value.replay?.latest_height, maxU64);
  const snapshotHash = value.replay?.snapshot_block_hash;
  if (value.success !== true || !snapshotSources.has(value.source) || value.replay?.source !== value.source ||
      value.replay?.complete !== true || snapshotHeight === null || typeof snapshotHash !== 'string' ||
      snapshotHash.length !== 64 || !/^[0-9a-f]{64}$/.test(snapshotHash) || !Array.isArray(value.items) ||
      !Number.isInteger(value.omitted_count) || value.omitted_count < 0 || value.count > STS_ACTIVITY_LIMIT ||
      value.count !== value.items.length + value.omitted_count) throw Error('The selected RPC did not return a supported STS activity snapshot.');

  const items = value.items.map((row, index) => {
    const event = stsAssetEvent(row?.event_type);
    const timestamp = exactRpcAmount(row?.timestamp, maxU64);
    const amount = row?.amount === null ? null : exactRpcAmount(row?.amount, maxU128);
    if (!event || !isStsAssetEventId(row.token_id, event.asset) || timestamp === null ||
        (row.amount !== null && amount === null) || !row.role ||
        Object.keys(roleLabels).some(key => typeof row.role[key] !== 'boolean')) {
      throw Error('The selected RPC returned an invalid STS activity record.');
    }
    const roles = Object.entries(roleLabels).filter(([key]) => row.role[key]).map(([, label]) => label);
    if (!roles.length) throw Error('The selected RPC returned an STS event outside the Wallet owner scope.');
    return {id: index + 1, asset: event.asset, assetLabel: assetLabels[event.asset], eventLabel: event.label,
      tokenId: row.token_id, timestamp, amount, roles};
  });
  return {items, count: value.count, omitted: value.omitted_count, snapshotHeight, snapshotHash, receivedAt: Date.now()};
}

function AssetEvents({items, omitted}) {
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState(null);
  const visible = filter ? items.filter(item => item.asset === filter) : items;
  const selected = visible.find(item => item.id === selection);

  if (!items.length) return <p>{omitted ? 'No supported asset events were returned in this snapshot.' :
    'The selected RPC returned no matching STS events in this snapshot.'}</p>;
  return <>
    <label>Filter STS activity by asset type<select value={filter} onChange={event => {
      setFilter(event.target.value);
      setSelection(null);
    }}>
      <option value="">All supported asset types</option>
      {Object.entries(assetLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <Table rows={visible} columns={columns} onSelect={item => setSelection(item.id)} empty="No events match this asset type."/>
    {selected && <aside aria-label="Selected STS asset event">
      <h3>{selected.eventLabel}</h3>
      <Detail data={{assetType: selected.assetLabel, assetId: selected.tokenId, walletRoles: selected.roles.join(', '),
        reportedUnixTimestamp: selected.timestamp, atomicAmount: selected.amount ?? 'Unavailable'}}/>
    </aside>}
  </>;
}

export function WalletStsActivity({account, endpoint, canRead}) {
  const {observation, requested, check, supportedAccount} = useWalletOwnerSnapshot({account, endpoint, canRead,
    read: rpcStsActivityObservation, parse: stsActivityObservation, limit: STS_ACTIVITY_LIMIT,
    unavailable: 'The STS activity snapshot is unavailable from the selected RPC.'});

  return <Card title="Selected RPC STS activity">
    {supportedAccount ? <>
      <p>Check up to {STS_ACTIVITY_LIMIT} recent STS events for your public Wallet address on the selected RPC. These events have no transaction hash.</p>
      <button disabled={requested && observation.loading} onClick={check}>
        {requested ? 'Check STS asset activity again' : 'Check STS asset activity'}
      </button>
      {requested && <Resource value={{...observation, reload: undefined}}>{value => <>
        <SourceAge source="Selected RPC STS activity snapshot" updatedAt={value.receivedAt}/>
        <Detail data={{reportedSnapshotHeight: value.snapshotHeight, reportedSnapshotHash: value.snapshotHash}}/>
        {value.count === STS_ACTIVITY_LIMIT && <p>The response reached the event limit. Earlier events may be available.</p>}
        {value.omitted > 0 && <p>Returned events outside the supported asset types and actions are withheld.</p>}
        <AssetEvents items={value.items} omitted={value.omitted}/>
      </>}</Resource>}
    </> : <p>A current protected Wallet address is required for this check.</p>}
  </Card>;
}
