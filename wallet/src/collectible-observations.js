import {requireAtlasAccountKey} from './atlas-account.js';
import {blockHeight, comparableTransactionHash} from './transaction-observation.js';

// Atlas's public token registry projects at most 250 recent STS NFT instances.
export const ATLAS_NFT_LIMIT = 250;
const REGISTRY_LIMIT = 10_000;
const statuses = new Set(['active', 'burned', 'revoked', 'frozen', 'used']);
const itemRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length <= 160 &&
  value.trim() === value && /^[A-Za-z0-9._:-]+$/.test(value);
const displayName = value => typeof value === 'string' && value.length > 0 && value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
const nftClass = value => value === 'nf1' || value === 'nf2' ? value : null;
const metadataHash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value) ? value : null;

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
