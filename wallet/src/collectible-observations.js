import {requireAtlasAccountKey} from './atlas-account.js';
import {blockHeight, comparableTransactionHash} from './transaction-observation.js';
import {isLegacyStsWalletAddress, isNftWalletOwner, isStsMultiAssetCollectionId, isStsNftObjectId, STS_TESTNET_GENESIS} from './wallet-address.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';

// Atlas's public token registry projects at most 250 recent STS NFT instances.
export const ATLAS_NFT_LIMIT = 250;
export const RPC_OWNER_NFT_LIMIT = 50;
export const RPC_MULTI_ASSET_LIMIT = 50;
const REGISTRY_LIMIT = 10_000;
const snapshotSources = new Set(['finalized_chain1266_execution_state', 'finalized_sts_snapshot']);
const statuses = new Set(['active', 'burned', 'revoked', 'frozen', 'used']);
const itemRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length <= 160 &&
  value.trim() === value && /^[A-Za-z0-9._:-]+$/.test(value);
const displayName = value => typeof value === 'string' && value.length > 0 && value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const nftClass = value => value === 'nf1' || value === 'nf2' ? value : null;
const metadataHash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value) ? value : null;
const nftStatus = item => [item.burned && 'Burned', item.frozen && 'Frozen', item.revoked && 'Revoked', item.used && 'Used']
  .filter(Boolean).join(', ') || 'No status flags reported';

function metadataStatus(uri) {
  if (uri == null || uri === '') return 'Unavailable';
  if (typeof uri !== 'string' || uri.length > 512 || !/^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(uri) ||
      /[\u0000-\u0020\u007f\\]/.test(uri) || new TextEncoder().encode(uri).length > 512) {
    return 'Unsupported metadata reference';
  }
  return 'Reference reported by Atlas';
}

export function collectibleObservations(value, account) {
  const accountKey = requireAtlasAccountKey(account);
  if (!itemRecord(value) || !Array.isArray(value.items) || value.items.length > REGISTRY_LIMIT) {
    throw Error('Atlas did not return a supported token registry.');
  }

  const instances = value.items.filter(item => itemRecord(item) &&
    item.assetKind === 'sts_nft' && item.assetSubtype === 'nft_instance');
  if (instances.length > ATLAS_NFT_LIMIT) throw Error('Atlas returned an unsupported NFT record set.');

  const collections = new Map();
  for (const item of value.items) {
    if (itemRecord(item) && item.assetKind === 'sts_nft_collection' &&
        identifier(item.collectionId) && item.collectionId === item.tokenId) {
      collections.set(item.collectionId, collections.has(item.collectionId) ? null : {
        name: displayName(item.name),
        currentFormat: item.assetSubtype === 'nft_collection',
        tokenClass: nftClass(item.tokenClass),
        status: item.status,
      });
    }
  }

  const matched = new Map();
  const seen = new Set();
  for (const item of instances) {
    const {collectionId, nftId, ownerAddress} = item;
    if (!identifier(collectionId) || !identifier(nftId)) continue;
    const key = JSON.stringify([collectionId, nftId]);
    if (seen.has(key)) {
      matched.delete(key);
      continue;
    }
    seen.add(key);
    if (item.tokenId !== nftId || (ownerAddress !== account && ownerAddress !== accountKey)) continue;

    const collection = collections.get(collectionId);
    const tokenClass = nftClass(item.tokenClass);
    const matchedCollection = collection?.currentFormat && tokenClass !== null && collection.tokenClass === tokenClass;
    const collectionStatus = matchedCollection && ['verified', 'active'].includes(collection.status) ? collection.status : null;

    matched.set(key, {
      key, collectionId, nftId,
      collection: collection?.name || collectionId,
      name: displayName(item.name) || nftId,
      address: identifier(item.tokenAddress) ? item.tokenAddress : null,
      ownerAddress,
      status: statuses.has(item.status) ? item.status : 'Unavailable',
      quantity: item.circulatingSupply === '1 NFT' ? '1 NFT' : 'Unavailable',
      tokenClass, collectionStatus,
      creationBlock: blockHeight(item.createdBlock),
      creationHash: comparableTransactionHash(item.createdTxHash) ? item.createdTxHash : null,
      metadataStatus: metadataStatus(item.metadataUri),
      metadataHash: metadataHash(item.metadataHash),
    });
  }
  return [...matched.values()];
}

// Testnet-v3 RPC STS owner reply at 05610db7 and the public chain 1266 snapshot projection.
export function ownerCollectibleObservation(response, account, readiness) {
  const snapshot = ownerCollectibleSnapshot(response, account, readiness, RPC_OWNER_NFT_LIMIT, 'NFT');
  if (!isNftWalletOwner(account) ||
      (isLegacyStsWalletAddress(account) && snapshot.chainContext.genesis !== STS_TESTNET_GENESIS)) {
    throw Error('The selected RPC did not return evidence for a supported NFT owner.');
  }
  const seen = new Set();
  const items = snapshot.items.map(item => {
    const tokenClass = nftClass(item?.class);
    if (item?.asset_kind !== 'nft' || item.owner !== account ||
        item.nft_address !== item.nft_id || item.collection_id === item.nft_id ||
        !isStsNftObjectId(item.nft_id, tokenClass) || !isStsNftObjectId(item.collection_id, tokenClass) ||
        item.burned !== false || seen.has(item.nft_id) ||
        [item.frozen, item.revoked, item.used, item.metadata_reference_present].some(value => typeof value !== 'boolean')) {
      throw Error('The selected RPC returned an invalid or ambiguous NFT record.');
    }
    seen.add(item.nft_id);
    return {
      key: item.nft_id, nftId: item.nft_id, name: item.nft_id, address: item.nft_address,
      collectionId: item.collection_id, collection: item.collection_id, ownerAddress: item.owner,
      status: nftStatus(item), quantity: '1 NFT', tokenClass,
      metadataStatus: item.metadata_reference_present ? 'Reference reported by selected RPC' : 'Unavailable',
      metadataHash: metadataHash(item.metadata_hash),
      metadataReferencePresent: item.metadata_reference_present,
    };
  });
  return {...snapshot, items};
}

export function matchesCollectibleReadiness(chainContext, readiness) {
  const chain = readiness.chain;
  return chainContext?.chainId === chain.chainId && String(chainContext.incarnation) === chain.incarnation &&
    chainContext.genesis === chain.genesis.toLowerCase();
}

function collectibleSnapshot(response, readiness, asset) {
  const {value, chainContext} = response;
  if (!matchesCollectibleReadiness(chainContext, readiness)) {
    throw Error(`The ${asset} response does not match the selected RPC readiness identity.`);
  }
  const snapshotHeight = blockHeight(value?.replay?.latest_height);
  const snapshotHash = metadataHash(value?.replay?.snapshot_block_hash);
  if (value?.success !== true || !snapshotSources.has(value.source) || value.replay?.source !== value.source ||
      value.replay?.complete !== true || snapshotHeight === null || !snapshotHash) {
    throw Error(`The selected RPC did not return a supported ${asset} snapshot.`);
  }
  return {chainContext, snapshotHeight, snapshotHash, receivedAt: Date.now()};
}

function ownerCollectibleSnapshot(response, account, readiness, limit, asset) {
  const snapshot = collectibleSnapshot(response, readiness, asset);
  const {value} = response;
  if (value.owner !== account) throw Error('The selected RPC did not return the exact Wallet owner.');
  if (!Array.isArray(value.items) || value.count !== value.items.length || value.items.length > limit) {
    throw Error(`The selected RPC did not return a supported ${asset} snapshot.`);
  }
  return {...snapshot, items: value.items};
}

// Testnet-v3 release a6a434f2, sts_nft_collection_json and sts_nft_collection_item_json.
export function nftCollectionObservation(response, selection, inventory, readiness) {
  const snapshot = collectibleSnapshot(response, readiness, 'NFT collection');
  const item = response.value.item;
  if (item?.asset_kind !== 'nft_collection' || item.collection_id !== selection.collectionId ||
      item.collection_address !== selection.collectionId || item.class !== selection.tokenClass ||
      !isStsNftObjectId(item.collection_id, item.class)) {
    throw Error('The selected RPC did not return the selected NFT collection and class.');
  }
  if (BigInt(snapshot.snapshotHeight) < BigInt(inventory.snapshotHeight) ||
      (snapshot.snapshotHeight === inventory.snapshotHeight && snapshot.snapshotHash !== inventory.snapshotHash)) {
    throw Error('The collection snapshot is older or conflicts with the owner NFT snapshot. Refresh the inventory.');
  }
  const {verified, transferable, requires_issuer_approval, metadata_mutable, image_locked} = item;
  if ([verified, transferable, requires_issuer_approval, metadata_mutable, image_locked].some(flag => typeof flag !== 'boolean') ||
      (item.metadata_hash !== null && !metadataHash(item.metadata_hash)) ||
      (item.image_hash !== null && !metadataHash(item.image_hash))) {
    throw Error('The selected RPC returned unsupported collection policy or commitment fields.');
  }
  return {...snapshot, verified, transferable, issuerApproval: requires_issuer_approval,
    metadataMutable: metadata_mutable, imageLocked: image_locked, metadataHash: item.metadata_hash, imageHash: item.image_hash};
}

// Testnet-v3 release a6a434f2, sts_nft_json and sts_nft_item_json.
export function nftInstanceObservation(response, selection, inventory, readiness) {
  const snapshot = collectibleSnapshot(response, readiness, 'NFT instance');
  const item = response.value.item;
  if (item?.asset_kind !== 'nft' || item.nft_id !== selection.nftId || item.nft_address !== selection.nftId ||
      item.collection_id !== selection.collectionId || item.class !== selection.tokenClass ||
      !isStsNftObjectId(item.nft_id, item.class) || !isStsNftObjectId(item.collection_id, item.class) ||
      item.nft_id === item.collection_id) {
    throw Error('The selected RPC returned a different NFT instance, collection or class.');
  }
  const {owner, burned, frozen, revoked, used, transferable, requires_issuer_approval, metadata_mutable,
    metadata_reference_present, metadata_hash} = item;
  const serial = exactRpcAmount(item.serial_number, maxU64);
  const expiry = exactRpcAmount(item.expires_at, 9999999999n);
  if (serial === null || serial === '0' || (item.expires_at !== null && (expiry === null || expiry === '0')) ||
      (owner !== null && (!isNftWalletOwner(owner) ||
        (isLegacyStsWalletAddress(owner) && snapshot.chainContext.genesis !== STS_TESTNET_GENESIS))) ||
      (metadata_hash !== null && !metadataHash(metadata_hash)) ||
      ![burned, frozen, revoked, used, transferable, requires_issuer_approval, metadata_mutable,
        metadata_reference_present].every(flag => typeof flag === 'boolean')) {
    throw Error('The selected RPC returned unsupported NFT instance status or commitment fields.');
  }
  const sameOwner = owner === selection.ownerAddress;
  const status = nftStatus(item);
  if (BigInt(snapshot.snapshotHeight) < BigInt(inventory.snapshotHeight) ||
      (snapshot.snapshotHeight === inventory.snapshotHeight &&
        (snapshot.snapshotHash !== inventory.snapshotHash || !sameOwner || burned || status !== selection.status ||
          metadata_hash !== selection.metadataHash || metadata_reference_present !== selection.metadataReferencePresent))) {
    throw Error('The NFT instance conflicts with the owner NFT snapshot or is older. Refresh the inventory.');
  }
  return {...snapshot, sameOwner, burned, status, serial, expiry, transferable, issuerApproval: requires_issuer_approval,
    metadataMutable: metadata_mutable, metadataHash: metadata_hash, metadataReferencePresent: metadata_reference_present};
}

export function ownerMultiAssetObservation(response, account, readiness) {
  const snapshot = ownerCollectibleSnapshot(response, account, readiness, RPC_MULTI_ASSET_LIMIT, 'multi-asset');
  if (response.value.collection_ref !== null) {
    throw Error('The selected RPC returned a different multi-asset collection scope.');
  }
  const seen = new Set();
  const items = snapshot.items.map(item => {
    const itemId = exactRpcAmount(item?.item_id, maxU64);
    const amount = exactRpcAmount(item?.amount, maxU128);
    if (item?.asset_kind !== 'multi_asset_balance' || item.owner !== account ||
        !isStsMultiAssetCollectionId(item.collection_id) || itemId === null || itemId === '0' || amount === null) {
      throw Error('The selected RPC returned an invalid multi-asset balance.');
    }
    const key = JSON.stringify([item.collection_id, itemId]);
    if (seen.has(key)) throw Error('The selected RPC returned duplicate multi-asset balances.');
    seen.add(key);
    return {key, collectionId: item.collection_id, itemId, amount, ownerAddress: item.owner};
  });
  return {...snapshot, items};
}

const multiAssetItemTypes = {fungible: 'Fungible', non_fungible: 'Non-fungible', semi_fungible: 'Semi-fungible'};
const multiAssetTransferPolicies = {open: 'Open', non_transferable: 'Non-transferable', authority_only: 'Authority only'};

// Testnet-v3 release a6a434f2, sts_multi_asset_item_json and sts_multi_asset_item_item_json.
export function multiAssetItemDefinition(response, selected, readiness) {
  const snapshot = collectibleSnapshot(response, readiness, 'multi-asset item');
  const item = response.value.item;
  if (item?.asset_kind !== 'multi_asset_item' || item.collection_id !== selected.collectionId ||
      !isStsMultiAssetCollectionId(item.collection_id) || exactRpcAmount(item.item_id, maxU64) !== selected.itemId) {
    throw Error('The selected RPC did not return the selected collection and item ID.');
  }
  const {item_type, decimals, transfer_policy, metadata_hash} = item;
  const total = exactRpcAmount(item.total_supply, maxU128), maximum = exactRpcAmount(item.max_supply, maxU128);
  if (typeof item_type !== 'string' || !Object.hasOwn(multiAssetItemTypes, item_type) ||
      typeof transfer_policy !== 'string' || !Object.hasOwn(multiAssetTransferPolicies, transfer_policy) ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 9 || (item_type === 'non_fungible' && decimals !== 0) ||
      total === null || (item.max_supply !== null && (maximum === null || BigInt(maximum) < BigInt(total))) ||
      (metadata_hash !== null && !metadataHash(metadata_hash))) {
    throw Error('The selected RPC returned unsupported item definition fields.');
  }
  return {...snapshot, source: response.value.source, type: multiAssetItemTypes[item_type], policy: multiAssetTransferPolicies[transfer_policy],
    decimals, total, maximum, metadataHash: metadata_hash};
}

export function multiAssetItemObservation(response, selected, inventory, readiness) {
  const definition = multiAssetItemDefinition(response, selected, readiness);
  if (BigInt(definition.snapshotHeight) < BigInt(inventory.snapshotHeight) ||
      (definition.snapshotHeight === inventory.snapshotHeight && definition.snapshotHash !== inventory.snapshotHash)) {
    throw Error('The item definition snapshot is older or conflicts with the selected holding. Check the holdings again.');
  }
  return definition;
}

export function exactMultiAssetHolding(response, owner, selected, definition, readiness) {
  const snapshot = collectibleSnapshot(response, readiness, 'multi-asset balance');
  const {value} = response;
  const amount = exactRpcAmount(value.amount, maxU128);
  if (value.owner !== owner || value.collection_id !== selected.collectionId || value.collection_address !== selected.collectionId ||
      exactRpcAmount(value.item_id, maxU64) !== selected.itemId || amount === null) {
    throw Error('The selected RPC did not return the requested owner, collection and item balance.');
  }
  if (value.source !== definition.source || snapshot.snapshotHeight !== definition.snapshotHeight || snapshot.snapshotHash !== definition.snapshotHash) {
    throw Error('The item definition and balance did not report the same snapshot. Check the holding again.');
  }
  return {...snapshot, amount, type: definition.type, decimals: definition.decimals, policy: definition.policy};
}
