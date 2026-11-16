import {isStsFungibleObjectId, isStsMultiAssetCollectionId, isStsNftObjectId} from './wallet-address.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';

export const STS_ACTIVITY_LIMIT = 50;

// Asset events emitted by Testnet-v3 chain-1266 release a6a434f2, runtime/src/sts.rs.
const eventActions = {
  fungible: {
    AccountFrozen: 'Account frozen', AccountThawed: 'Account thawed', Burned: 'Burned', ClawedBack: 'Clawed back',
    Created: 'Token created', ImageSet: 'Image updated', Minted: 'Minted', Paused: 'Paused', SnapshotCreated: 'Snapshot created',
    Transferred: 'Transferred', Unpaused: 'Unpaused',
  },
  nft: {
    Burned: 'Burned', CollectionCreated: 'Collection created', CollectionVerified: 'Collection verification reported',
    Frozen: 'Frozen', MetadataUpdated: 'Metadata updated', Minted: 'Minted', Revoked: 'Revoked', Thawed: 'Thawed',
    Transferred: 'Transferred', Used: 'Marked used',
  },
  multiAsset: {
    BatchBurned: 'Batch burned', BatchMinted: 'Batch minted', BatchTransferred: 'Batch transferred', Burned: 'Burned',
    CollectionCreated: 'Collection created', ItemCreated: 'Item created', Minted: 'Minted', Transferred: 'Transferred',
  },
};

const classes = {StsFungible: 'fungible', StsNft: 'nft', StsMultiAsset: 'multiAsset'};
const events = new Map(Object.entries(classes).flatMap(([prefix, asset]) =>
  Object.entries(eventActions[asset]).map(([suffix, label]) => [prefix + suffix, {asset, label}])));

export function stsAssetEvent(eventType) {
  return events.get(eventType) ?? null;
}

export function isStsAssetEventId(tokenId, asset) {
  if (asset === 'fungible') return isStsFungibleObjectId(tokenId);
  if (asset === 'nft') return isStsNftObjectId(tokenId, 'nf1') || isStsNftObjectId(tokenId, 'nf2');
  return asset === 'multiAsset' && isStsMultiAssetCollectionId(tokenId);
}

export function isStsActivityTokenRef(value) {
  return isStsAssetEventId(value, 'fungible') || isStsAssetEventId(value, 'nft') || isStsAssetEventId(value, 'multiAsset');
}

export function projectStsAssetEvents(rows, owner, tokenRef = null) {
  const items = [];
  let omittedCount = 0;
  const unsupported = 'The RPC returned unsupported STS activity evidence.';
  if (!Array.isArray(rows) || rows.length > STS_ACTIVITY_LIMIT || typeof owner !== 'string' || !owner) throw Error(unsupported);

  for (const row of rows) {
    if (typeof row?.sender !== 'string' || (row.owner !== null && typeof row.owner !== 'string') ||
        (row.recipient !== null && typeof row.recipient !== 'string') || typeof row.event_type !== 'string' ||
        row.event_type.trim() !== row.event_type || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(row.event_type)) throw Error(unsupported);
    const role = {sender: row.sender === owner, owner: row.owner === owner, recipient: row.recipient === owner};
    if ((!role.sender && !role.owner && !role.recipient) || (tokenRef !== null && row.token_id !== tokenRef)) throw Error(unsupported);
    const event = stsAssetEvent(row.event_type);
    if (!event) {
      omittedCount++;
      continue;
    }
    const timestamp = exactRpcAmount(row.timestamp, maxU64);
    const amount = row.amount === null ? null : exactRpcAmount(row.amount, maxU128);
    if (!isStsAssetEventId(row.token_id, event.asset) || timestamp === null ||
        (row.amount !== null && (typeof row.amount !== 'string' || amount === null))) throw Error(unsupported);
    items.push({event_type: row.event_type, token_id: row.token_id, timestamp, amount, role});
  }
  return {items, omitted_count: omittedCount};
}
