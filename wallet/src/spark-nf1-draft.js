import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, hexToBytes} from '@noble/hashes/utils';
import {isLegacyStsWalletAddress as isSparkNf1WalletAddress, isStsNftObjectId} from './wallet-address.js';

export const MAX_SPARK_MINT_DRAFT_BYTES = 24 * 1024;
const MAX_PAYLOAD_BYTES = 4096;
const PAYLOAD_PREFIX = 'synergy-sts-v1:';
const NETWORK = 'synergy-testnet-v3';
const CHAIN_ID = 1266;
const KIND = 'spark-sts-nft-mint-draft';
const encoder = new TextEncoder();
const unsupportedDraft = 'Choose a supported unsigned Spark NF1 mint draft exported as JSON.';

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

export function inspectSparkNf1MintDraft(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw Error(unsupportedDraft);
  if (bytes.length > MAX_SPARK_MINT_DRAFT_BYTES) throw Error('The mint draft exceeds 24 KiB.');

  const source = utf8(bytes, unsupportedDraft);
  const draft = jsonFile(source, unsupportedDraft);
  if (draft?.schemaVersion !== 1 || draft.kind !== KIND || draft.chainId !== CHAIN_ID || draft.network !== NETWORK ||
      draft.status !== 'unsigned' || draft.transactionHash !== null || !isSparkNf1WalletAddress(draft.sender) ||
      typeof draft.payload_hex !== 'string' || !draft.payload_hex.length || draft.payload_hex.length > 2 * MAX_PAYLOAD_BYTES ||
      draft.payload_hex.length % 2 !== 0 || /[^0-9a-f]/.test(draft.payload_hex)) throw Error(unsupportedDraft);

  // Compare the original to the pinned export encoding. This also rejects
  // duplicate, unknown or reordered fields without trusting JSON.parse's view.
  const {sender, payload_hex} = draft;
  const canonicalDraft = {schemaVersion: 1, kind: KIND, chainId: CHAIN_ID, network: NETWORK,
    sender, payload_hex, status: 'unsigned', transactionHash: null};
  if (source !== JSON.stringify(canonicalDraft, null, 2) + '\n') throw Error(unsupportedDraft);

  const unsupportedPayload = 'The draft has an unsupported or noncanonical NF1 mint payload.';
  const payloadBytes = hexToBytes(payload_hex);
  const payload = utf8(payloadBytes, unsupportedPayload);
  if (!payload.startsWith(PAYLOAD_PREFIX)) throw Error(unsupportedPayload);
  const decoded = jsonFile(payload.slice(PAYLOAD_PREFIX.length), unsupportedPayload);
  if (decoded?.version !== 1 || decoded.chain_id !== CHAIN_ID || decoded.network !== NETWORK ||
      decoded.tx?.op !== 'mint_nft') throw Error(unsupportedPayload);

  const data = decoded.tx.data;
  if (!isStsNftObjectId(data?.collection_id, 'nf1') || !isSparkNf1WalletAddress(data.to) ||
      !isMetadataPair(data.metadata_uri, data.metadata_hash) || data.metadata_mutable !== false ||
      data.transferable !== null || data.requires_issuer_approval !== null || data.expires_at !== null ||
      !Number.isSafeInteger(data.minted_at) || data.minted_at < 0 || data.minted_at > 9_999_999_999) {
    throw Error(unsupportedPayload);
  }
  const canonicalPayload = {
    version: 1, chain_id: CHAIN_ID, network: NETWORK,
    tx: {op: 'mint_nft', data: {
      collection_id: data.collection_id, to: data.to, metadata_uri: data.metadata_uri, metadata_hash: data.metadata_hash,
      metadata_mutable: false, transferable: null, requires_issuer_approval: null, expires_at: null, minted_at: data.minted_at,
    }},
  };
  if (payload !== PAYLOAD_PREFIX + JSON.stringify(canonicalPayload)) throw Error(unsupportedPayload);

  return {
    sha256: bytesToHex(sha256(bytes)), payloadSha256: bytesToHex(sha256(payloadBytes)),
    chainId: CHAIN_ID, network: NETWORK, sender,
    recipient: data.to, collectionId: data.collection_id, mintedAt: data.minted_at,
    metadataUri: data.metadata_uri, metadataSha3: data.metadata_hash,
  };
}
