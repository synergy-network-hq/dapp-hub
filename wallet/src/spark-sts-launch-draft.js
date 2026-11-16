import {sha256} from '@noble/hashes/sha256';
import {sha3_256} from '@noble/hashes/sha3';
import {bytesToHex} from '@noble/hashes/utils';
import {bech32m} from 'bech32';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {isLegacyStsWalletAddress, isStsFungibleObjectId} from './wallet-address.js';
import {inspectSparkNf1Draft, MAX_SPARK_NF1_DRAFT_BYTES} from './spark-nf1-draft.js';

const kind = 'spark-sts-launch-draft';
const chainId = 1266;
const network = 'synergy-testnet-v3';
const prefix = 'synergy-sts-v1:';
const unsupportedDraft = 'Choose a supported unsigned Spark draft exported as JSON.';
const unsupportedPayload = 'The draft has an unsupported or noncanonical B1 launch payload.';
const maxPayloadBytes = 4096;
const encoder = new TextEncoder();

function json(source, message) {
  try {
    return JSON.parse(source);
  } catch {
    throw Error(message);
  }
}

const isHash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/.test(value);

function isUri(value) {
  if (typeof value !== 'string' || !/^(?:https|ipfs|ar):\/\//.test(value) || value.trim() !== value ||
      /[\u0000-\u0020\u007f\\]/u.test(value) || encoder.encode(value).length > 512) return false;
  try {
    const parsed = new URL(value);
    return !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function uint64Bytes(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

// Spark fe1d099 src/sts.js derives the B1 ID from length-prefixed fields.
function deriveTokenId(creator, nonce, metadataHash, createdAt) {
  const hash = sha3_256.create().update(encoder.encode('synergy-sts-token-v1'));
  for (const part of [uint64Bytes(chainId), Uint8Array.of(1), encoder.encode(creator), uint64Bytes(nonce),
    encoder.encode(metadataHash), uint64Bytes(createdAt)]) {
    hash.update(uint64Bytes(part.length)).update(part);
  }
  return bech32m.encode('synb1', bech32m.toWords(hash.digest().subarray(0, 20)));
}

function exactWireInteger(payload, data, field, maximum) {
  if (typeof data[field] !== 'number') return null;
  const digits = new RegExp(`"${field}":(0|[1-9][0-9]{0,38})(?=[,}])`).exec(payload)?.[1];
  return exactRpcAmount(digits, maximum);
}

const fixedFlags = {
  can_freeze: false, can_pause: false, can_clawback: false, can_denylist: false, can_allowlist: false,
  can_update_metadata: false, requires_transfer_approval: false,
};

function readLaunch(bytes, source, draft) {
  const {creatorAddress, payloadJson, payloadHex, payload_hex, expectedTokenId} = draft;
  if (!isLegacyStsWalletAddress(creatorAddress) || !isStsFungibleObjectId(expectedTokenId) ||
      typeof payloadJson !== 'string' || payloadJson.length > maxPayloadBytes || typeof payloadHex !== 'string' ||
      payloadHex.length > 2 * maxPayloadBytes || payloadHex !== payload_hex) throw Error(unsupportedDraft);
  const outer = {schemaVersion: 1, kind, chainId, network, creatorAddress, expectedTokenId,
    payloadJson, payloadHex, payload_hex, status: 'unsigned', transactionHash: null};
  if (source !== JSON.stringify(outer, null, 2) + '\n') throw Error(unsupportedDraft);
  const payloadBytes = encoder.encode(prefix + payloadJson);
  if (payloadBytes.length > maxPayloadBytes || bytesToHex(payloadBytes) !== payloadHex) {
    throw Error('The B1 launch draft payload and hexadecimal copies disagree.');
  }

  const data = json(payloadJson, unsupportedPayload)?.tx?.data;
  if (!data || data.creator !== creatorAddress || typeof data.name !== 'string' || data.name.trim() !== data.name ||
      !/^[\x20-\x7e]{1,64}$/.test(data.name) || /SNRG|SYNERGY/i.test(data.name) ||
      typeof data.symbol !== 'string' || data.symbol.trim() !== data.symbol || !/^[A-Z][A-Z0-9]{1,11}$/.test(data.symbol) || data.symbol.includes('SNRG') ||
      !Number.isInteger(data.decimals) || data.decimals < 0 || data.decimals > 9 ||
      !Number.isSafeInteger(data.created_at) || data.created_at < 0 || data.created_at > 9_999_999_999 ||
      (data.metadata_hash !== null && !isHash(data.metadata_hash)) ||
      (data.metadata_uri !== null && (!isUri(data.metadata_uri) || !isHash(data.metadata_hash))) ||
      (!(data.image_uri === null && data.image_hash === null) &&
        (!isUri(data.image_uri) || !isHash(data.image_hash) || /\.svg/i.test(data.image_uri)))) throw Error(unsupportedPayload);

  const nonce = exactWireInteger(payloadJson, data, 'creator_nonce', maxU64);
  const supply = exactWireInteger(payloadJson, data, 'initial_supply', maxU128);
  if (nonce === null || supply === null || supply === '0' || exactWireInteger(payloadJson, data, 'max_supply', maxU128) !== supply) {
    throw Error(unsupportedPayload);
  }
  const wire = {class: 'b1', creator: creatorAddress, creator_nonce: nonce, name: data.name, symbol: data.symbol,
    decimals: data.decimals, initial_supply: supply, max_supply: supply, mint_authority: null, metadata_authority: null,
    metadata_uri: data.metadata_uri, metadata_hash: data.metadata_hash, metadata_mutable: false,
    image_uri: data.image_uri, image_hash: data.image_hash, flags: fixedFlags, policies: [], created_at: data.created_at};
  const canonical = JSON.stringify({version: 1, chain_id: chainId, network, tx: {op: 'create_fungible', data: wire}})
    .replace(`"creator_nonce":"${nonce}"`, `"creator_nonce":${nonce}`)
    .replace(`"initial_supply":"${supply}"`, `"initial_supply":${supply}`)
    .replace(`"max_supply":"${supply}"`, `"max_supply":${supply}`);
  if (payloadJson !== canonical) throw Error(unsupportedPayload);

  const identityMetadataHash = data.metadata_hash ?? bytesToHex(sha3_256(encoder.encode(data.name)));
  if (deriveTokenId(creatorAddress, nonce, identityMetadataHash, data.created_at) !== expectedTokenId) {
    throw Error('The expected token ID does not match the B1 launch payload.');
  }
  return {action: 'launch', chainId, network, creatorAddress, expectedTokenId, nonce, supply, name: data.name, symbol: data.symbol,
    decimals: data.decimals, createdAt: data.created_at, metadataUri: data.metadata_uri, metadataHash: data.metadata_hash,
    imageUri: data.image_uri, imageHash: data.image_hash, identityMetadataHash,
    exceedsCliV20Supply: BigInt(supply) > maxU64, sha256: bytesToHex(sha256(bytes)), payloadSha256: bytesToHex(sha256(payloadBytes))};
}

export function inspectSparkDraft(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw Error(unsupportedDraft);
  if (bytes.length > MAX_SPARK_NF1_DRAFT_BYTES) throw Error('The draft exceeds 24 KiB.');
  let source;
  try {
    source = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  } catch {
    throw Error(unsupportedDraft);
  }
  const draft = json(source, unsupportedDraft);
  return draft?.kind === kind ? readLaunch(bytes, source, draft) : inspectSparkNf1Draft(bytes);
}
