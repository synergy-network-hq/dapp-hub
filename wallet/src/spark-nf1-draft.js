import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, hexToBytes} from '@noble/hashes/utils';
import {isLegacyStsWalletAddress as isSparkNf1WalletAddress, isStsNftObjectId} from './wallet-address.js';
import {exactRpcAmount, maxU128} from './rpc-unsigned.js';

export const MAX_SPARK_NF1_DRAFT_BYTES = 24 * 1024;
export const MAX_SPARK_MINT_DRAFT_BYTES = MAX_SPARK_NF1_DRAFT_BYTES;
const MAX_PAYLOAD_BYTES = 4096;
const PAYLOAD_PREFIX = 'synergy-sts-v1:';
const NETWORK = 'synergy-testnet-v3';
const CHAIN_ID = 1266;
const MINT = 'spark-sts-nft-mint-draft';
const SALE = 'spark-sts-nft-sale-draft';
const encoder = new TextEncoder();

// Spark fe1d099 and the native Wallet inspector 134cfa2 use the local STS
// Bech32m wallet namespace for this file format.
export {isSparkNf1WalletAddress};

function jsonFile(source, error) {
  try {
    return JSON.parse(source);
  } catch {
    throw Error(error);
  }
}

function utf8(bytes, error) {
  try {
    return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  } catch {
    throw Error(error);
  }
}

function isMetadataPair(uri, hash) {
  if (uri === null && hash === null) return true;
  if (typeof uri !== 'string' || typeof hash !== 'string' || hash.length !== 64 || /[^0-9a-f]/.test(hash) ||
      !/^(?:https|ipfs|ar):\/\//.test(uri) || /[\p{White_Space}\p{Cc}\p{Cs}\\]/u.test(uri) ||
      encoder.encode(uri).length > 512) return false;
  try {
    const url = new URL(uri);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function readDraft(bytes, mintOnly = false) {
  const unsupportedDraft = mintOnly ? 'Choose a supported unsigned Spark NF1 mint draft exported as JSON.' :
    'Choose a supported unsigned Spark NF1 draft exported as JSON.';
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw Error(unsupportedDraft);
  if (bytes.length > MAX_SPARK_NF1_DRAFT_BYTES) throw Error('The draft exceeds 24 KiB.');

  const source = utf8(bytes, unsupportedDraft);
  const draft = jsonFile(source, unsupportedDraft);
  if (draft?.schemaVersion !== 1 || (draft.kind !== MINT && (mintOnly || draft.kind !== SALE)) ||
      draft.chainId !== CHAIN_ID || draft.network !== NETWORK ||
      draft.status !== 'unsigned' || draft.transactionHash !== null || !isSparkNf1WalletAddress(draft.sender) ||
      typeof draft.payload_hex !== 'string' || !draft.payload_hex.length || draft.payload_hex.length > 2 * MAX_PAYLOAD_BYTES ||
      draft.payload_hex.length % 2 !== 0 || /[^0-9a-f]/.test(draft.payload_hex)) throw Error(unsupportedDraft);

  // Compare the original to the pinned export encoding. This also rejects
  // duplicate, unknown or reordered fields without trusting JSON.parse's view.
  const {sender, payload_hex, kind} = draft;
  const canonicalDraft = {schemaVersion: 1, kind, chainId: CHAIN_ID, network: NETWORK,
    sender, payload_hex, status: 'unsigned', transactionHash: null};
  if (source !== JSON.stringify(canonicalDraft, null, 2) + '\n') throw Error(unsupportedDraft);

  const unsupportedPayload = kind === MINT ? 'The draft has an unsupported or noncanonical NF1 mint payload.' :
    'The draft has an unsupported or noncanonical NF1 sale payload.';
  const payloadBytes = hexToBytes(payload_hex);
  const payload = utf8(payloadBytes, unsupportedPayload);
  if (!payload.startsWith(PAYLOAD_PREFIX)) throw Error(unsupportedPayload);
  const decoded = jsonFile(payload.slice(PAYLOAD_PREFIX.length), unsupportedPayload);
  if (decoded?.version !== 1 || decoded.chain_id !== CHAIN_ID || decoded.network !== NETWORK) throw Error(unsupportedPayload);
  return {kind, sender, payload, payloadBytes, tx: decoded.tx, unsupportedPayload};
}

function canonicalPayload(op, data) {
  return PAYLOAD_PREFIX + JSON.stringify({version: 1, chain_id: CHAIN_ID, network: NETWORK, tx: {op, data}});
}

function identity(bytes, {sender, payloadBytes}) {
  return {sha256: bytesToHex(sha256(bytes)), payloadSha256: bytesToHex(sha256(payloadBytes)),
    chainId: CHAIN_ID, network: NETWORK, sender};
}

function inspectMint(bytes, draft) {
  const {tx, payload, unsupportedPayload} = draft;
  const data = tx?.data;
  if (tx?.op !== 'mint_nft' || !isStsNftObjectId(data?.collection_id, 'nf1') || !isSparkNf1WalletAddress(data.to) ||
      !isMetadataPair(data.metadata_uri, data.metadata_hash) || data.metadata_mutable !== false ||
      data.transferable !== null || data.requires_issuer_approval !== null || data.expires_at !== null ||
      !Number.isSafeInteger(data.minted_at) || data.minted_at < 0 || data.minted_at > 9_999_999_999) {
    throw Error(unsupportedPayload);
  }
  const canonical = canonicalPayload('mint_nft', {
    collection_id: data.collection_id, to: data.to, metadata_uri: data.metadata_uri, metadata_hash: data.metadata_hash,
    metadata_mutable: false, transferable: null, requires_issuer_approval: null, expires_at: null, minted_at: data.minted_at,
  });
  if (payload !== canonical) throw Error(unsupportedPayload);

  return {
    ...identity(bytes, draft),
    recipient: data.to, collectionId: data.collection_id, mintedAt: data.minted_at,
    metadataUri: data.metadata_uri, metadataSha3: data.metadata_hash,
  };
}

function inspectSale(bytes, draft) {
  const {tx, payload, sender, unsupportedPayload} = draft;
  const op = tx?.op, data = tx?.data;
  if (!isStsNftObjectId(data?.nft_id, 'nf1')) throw Error(unsupportedPayload);
  const nftId = data.nft_id;
  const wire = {nft_id: nftId};
  const terms = {nftId};

  if (op === 'list_nft_for_snrg') {
    terms.action = 'list';
    if (!Number.isSafeInteger(data.expires_at_height) || data.expires_at_height <= 0) throw Error(unsupportedPayload);
    terms.expiresAtHeight = String(data.expires_at_height);
  } else if (op === 'cancel_nft_sale' || op === 'buy_nft_for_snrg') {
    if (typeof data.listing_id !== 'string' || !/^[a-f0-9]{64}$/.test(data.listing_id)) throw Error(unsupportedPayload);
    wire.listing_id = data.listing_id;
    terms.listingId = data.listing_id;
    terms.action = op === 'cancel_nft_sale' ? 'cancel' : 'buy';
    if (terms.action === 'buy') {
      if (!isSparkNf1WalletAddress(data.expected_seller) || data.expected_seller === sender) throw Error(unsupportedPayload);
      wire.expected_seller = data.expected_seller;
      terms.expectedSeller = data.expected_seller;
    }
  } else {
    throw Error(unsupportedPayload);
  }

  if (terms.action !== 'cancel') {
    // Spark emits a raw u128 JSON integer. Read its exact digits from the
    // original payload and verify the entire canonical wire string below.
    const price = /"price_nwei":([1-9][0-9]{0,38})(?=[,}])/.exec(payload)?.[1];
    const priceNwei = exactRpcAmount(price, maxU128);
    if (typeof data.price_nwei !== 'number' || priceNwei === null) throw Error(unsupportedPayload);
    terms.priceNwei = priceNwei;
    wire.price_nwei = priceNwei;
  }
  if (terms.action === 'list') wire.expires_at_height = data.expires_at_height;

  const encoded = canonicalPayload(op, wire);
  const canonical = terms.priceNwei ? encoded.replace(`"price_nwei":"${terms.priceNwei}"`, `"price_nwei":${terms.priceNwei}`) : encoded;
  if (payload !== canonical) throw Error(unsupportedPayload);
  return {...identity(bytes, draft), ...terms};
}

export function inspectSparkNf1MintDraft(bytes) {
  return inspectMint(bytes, readDraft(bytes, true));
}

export function inspectSparkNf1Draft(bytes) {
  return readSparkNf1DraftReview(bytes).draft;
}

export function readSparkNf1DraftReview(bytes) {
  const source = readDraft(bytes);
  const draft = source.kind === MINT ? {action: 'mint', ...inspectMint(bytes, source)} : inspectSale(bytes, source);
  return {draft, payloadJson: source.payload.slice(PAYLOAD_PREFIX.length)};
}
