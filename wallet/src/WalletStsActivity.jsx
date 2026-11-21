import {useId, useRef, useState} from 'react';
import {Card, Detail, Resource, Table, rpcStsActivityObservation} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {useWalletOwnerSnapshot} from './wallet-owner-readiness.js';
import {STS_ACTIVITY_LIMIT, isStsActivityTokenRef, isStsAssetEventId, stsAssetEvent} from './sts-activity.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {isProtectedWalletAddress} from './wallet-address.js';

const snapshotSources = new Set(['finalized_sts_snapshot', 'finalized_chain1266_execution_state']);
const assetLabels = {fungible: 'Fungible token', nft: 'NFT', multiAsset: 'Multi-asset'};
const roleLabels = {sender: 'Sender', owner: 'Recorded owner', recipient: 'Recipient'};
const columns = [{key: 'eventLabel', label: 'Event'}, {key: 'assetLabel', label: 'Asset type'}, {key: 'tokenId', label: 'Asset ID'}];

function stsActivityObservation(response, account, readiness, tokenRef) {
  const {value, chainContext} = response;
  const chain = readiness.chain;
  if (chainContext?.chainId !== chain.chainId || String(chainContext.incarnation) !== chain.incarnation ||
      chainContext.genesis !== chain.genesis.toLowerCase()) throw Error('The STS activity response does not match the selected RPC readiness identity.');
  if (value?.owner !== account || value.token_ref !== tokenRef) throw Error('The selected RPC returned a different STS activity scope.');

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
    if (tokenRef !== null && row.token_id !== tokenRef) throw Error('The selected RPC returned a different STS activity scope.');
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

function ActivitySnapshot({account, endpoint, canRead, tokenRef}) {
  const {observation} = useWalletOwnerSnapshot({account, endpoint, canRead, limit: STS_ACTIVITY_LIMIT, startOnMount: true,
    read: options => rpcStsActivityObservation(tokenRef === null ? options : {...options, tokenRef}),
    parse: (response, owner, readiness) => stsActivityObservation(response, owner, readiness, tokenRef),
    unavailable: 'The STS activity snapshot is unavailable from the selected RPC.'});
  return <Resource value={{...observation, reload: undefined}}>{value => <>
    {tokenRef && <p>Checked asset <code>{tokenRef}</code></p>}
    <SourceAge source="Selected RPC STS activity snapshot" updatedAt={value.receivedAt}/>
    <Detail data={{reportedSnapshotHeight: value.snapshotHeight, reportedSnapshotHash: value.snapshotHash}}/>
    {value.count === STS_ACTIVITY_LIMIT && <p>The response reached the event limit. Earlier events may be available.</p>}
    {value.omitted > 0 && <p>Returned events outside the supported asset types and actions are withheld.</p>}
    <AssetEvents items={value.items} omitted={value.omitted}/>
  </>}</Resource>;
}

export function WalletStsActivity({account, endpoint, canRead}) {
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [request, setRequest] = useState(null);
  const revision = useRef(0);
  const errorId = useId();

  function check(tokenRef) {
    if (!canRead()) return;
    setInvalid(false);
    setRequest({tokenRef, revision: ++revision.current});
  }

  function checkAsset(event) {
    event.preventDefault();
    if (!isStsActivityTokenRef(input)) {
      setInvalid(true);
      return;
    }
    check(input);
  }

  return <Card title="Selected RPC STS activity">
    {isProtectedWalletAddress(account) ? <>
      <p>Check up to {STS_ACTIVITY_LIMIT} recent STS events for your public Wallet address on the selected RPC. These events have no transaction hash.</p>
      <button type="button" onClick={() => check(null)}>
        {request?.tokenRef === null ? 'Check STS asset activity again' : 'Check STS asset activity'}
      </button>
      <form onSubmit={checkAsset}>
        <label>Exact STS asset ID<input value={input} maxLength={44} spellCheck={false} autoCapitalize="none" autoComplete="off"
          aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => {
            setInput(event.target.value);
            setInvalid(false);
            if (request?.tokenRef) {
              revision.current++;
              setRequest(null);
            }
          }}/></label>
        {invalid && <p id={errorId} role="alert">Enter the exact checksummed STS asset ID.</p>}
        <button type="submit">Check activity for this asset</button>
      </form>
      {request && <ActivitySnapshot key={request.revision} tokenRef={request.tokenRef} {...{account, endpoint}}
        canRead={() => request.revision === revision.current && canRead()}/>}
    </> : <p>A current protected Wallet address is required for this check.</p>}
  </Card>;
}
