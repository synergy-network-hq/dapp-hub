import {hexToBytes} from '@noble/hashes/utils';
import {exactRpcAmount, maxU128} from './rpc-unsigned.js';
import {inspectSparkNf1Draft, MAX_SPARK_NF1_DRAFT_BYTES} from './spark-nf1-draft.js';
import {isStsNftObjectId, STS_TESTNET_GENESIS} from './wallet-address.js';

// Spark fe1d099, scripts/nf1-public-sale.mjs and the marketplace sale verifier.
export const MAX_SPARK_SALE_EVIDENCE_BYTES = 34 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSES_BYTES = 24 * 1024 * 1024;
const MAX_CARRIER_BYTES = 64 * 1024;
const GATEWAY = 'https://testnet-rpc.synergy-network.io';
const SOURCE = 'finalized_chain1266_execution_state';
const NETWORK = 'synergy-testnet-v3';
const CARRIER = 'aegis-pqvm-tx-v1:';
const SALE_EVENT_LIMIT = 1000;
const validHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const positiveHeight = value => Number.isSafeInteger(value) && value > 0;

function requireEvidence(condition, message) {
  if (!condition) throw Error(message);
}

function jsonBytes(bytes, message, preserveFee = false) {
  try {
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
    // Preserve the receipt's raw decimal fee on runtimes without JSON.parse
    // source context. Consume complete string tokens so escaped text cannot
    // be mistaken for a JSON key. Exact integer validation happens below.
    if (preserveFee) {
      const member = /("(?:[^"\\]|\\[\s\S])*")(?:(\s*:\s*)(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?))?/g;
      return JSON.parse(text.replace(member, (whole, key, separator, number) =>
        key === '"feeCharged"' && number !== undefined ? `${key}${separator}"${number}"` : whole));
    }
    return JSON.parse(text);
  } catch {
    throw Error(message);
  }
}

function base64Bytes(value, limit, message) {
  requireEvidence(typeof value === 'string' && value.length > 0 && value.length <= 4 * Math.ceil(limit / 3), message);
  try {
    const raw = atob(value);
    requireEvidence(raw.length <= limit && btoa(raw) === value, message);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
    return bytes;
  } catch {
    throw Error(message);
  }
}

function nwei(value) {
  const amount = exactRpcAmount(value, maxU128);
  requireEvidence(amount !== null, 'The archived sale contains an invalid nWei amount.');
  return BigInt(amount);
}

function validateSnapshot(snapshot, receipt) {
  const {replay} = snapshot;
  requireEvidence(snapshot.success === true && snapshot.source === SOURCE && replay?.source === SOURCE &&
    replay.complete === true && positiveHeight(replay.latest_height) && replay.latest_height >= receipt.blockNumber &&
    validHash(replay.snapshot_block_hash) && (replay.latest_height > receipt.blockNumber || replay.snapshot_block_hash === receipt.blockHash),
  'The archived NFT state does not match the recorded receipt checkpoint.');
}

function verifyCarrier(block, receipt, draft, expectedPayload) {
  requireEvidence(block.hash === receipt.blockHash && block.height === receipt.blockNumber &&
    block.finalized === true && block.finality_status === 'finalized' && block.source === 'canonical_finality_store' &&
    block.transaction_format === 'synergy_native_v3' && Array.isArray(block.transactions) &&
    block.transactions.length === block.tx_count,
  'The archived finalized block does not match the receipt.');
  const tx = block.transactions[receipt.transactionIndex];
  const unsupported = 'The archived transaction does not carry the selected purchase draft.';
  requireEvidence(tx?.chain_id === 1266 && tx.network_id === NETWORK && tx.sender === receipt.from &&
    tx.receiver === receipt.to && typeof tx.data === 'string' && tx.data.startsWith(CARRIER), unsupported);
  const carrier = jsonBytes(base64Bytes(tx.data.slice(CARRIER.length), MAX_CARRIER_BYTES, unsupported), unsupported);
  const body = carrier?.transaction;
  requireEvidence(body?.chain_id === 1266 && body.network_id === NETWORK && body.sender_uma_or_account === draft.sender &&
    Array.isArray(body.payload) && body.payload.length === expectedPayload.length &&
    body.payload.every((byte, index) => byte === expectedPayload[index]), unsupported);
}

function verifyEvents(events, receipt, draft) {
  validateSnapshot(events, receipt);
  requireEvidence(events.token_ref === draft.nftId && events.owner === draft.sender && Array.isArray(events.items) &&
    events.count === events.items.length && events.count <= SALE_EVENT_LIMIT,
  'The archived sale event list does not match the selected purchase.');
  const matches = events.items.filter(event => event?.event_type === 'StsNftSaleSettled' &&
    event.attributes?.execution_tx_id === receipt.executionTxId);
  requireEvidence(matches.length === 1, 'The archived receipt requires one matching sale event.');
  const [event] = matches, a = event.attributes;
  const price = nwei(draft.priceNwei);
  requireEvidence(event.token_id === draft.nftId && event.owner === draft.expectedSeller && event.sender === draft.sender &&
    event.recipient === draft.sender && event.amount === '1' && a.listing_id === draft.listingId &&
    isStsNftObjectId(a.collection_id, 'nf1') && a.payment_asset === 'SNRG' && nwei(a.price_nwei) === price &&
    a.block_height === String(receipt.blockNumber) && typeof a.fee_collector === 'string' && !!a.fee_collector,
  'The archived sale event differs from the draft NFT, parties, or price.');

  const fee = nwei(a.network_fee_nwei);
  const buyerDebit = price + (a.fee_collector === draft.sender ? 0n : fee);
  const sellerCredit = price + (a.fee_collector === draft.expectedSeller ? fee : 0n);
  requireEvidence(fee === nwei(receipt.feeCharged) &&
    nwei(a.buyer_balance_before_nwei) - nwei(a.buyer_balance_after_nwei) === buyerDebit &&
    nwei(a.seller_balance_after_nwei) - nwei(a.seller_balance_before_nwei) === sellerCredit,
  'The archived SNRG balance changes do not match the draft price and recorded fee.');
  return {collectionId: a.collection_id, fee, buyerDebit, sellerCredit};
}

export function inspectSparkNf1SaleEvidence(bytes, draftBytes) {
  const draft = inspectSparkNf1Draft(draftBytes);
  requireEvidence(draft.action === 'buy', 'Select an unsigned Spark buy draft before checking its evidence.');
  requireEvidence(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_SPARK_SALE_EVIDENCE_BYTES,
    'Choose a Spark purchase evidence archive up to 34 MiB.');
  const unsupported = 'Choose a complete Spark NF1 public sale evidence archive.';
  const archive = jsonBytes(bytes, unsupported);
  const transactionHash = archive?.transactionHash;
  requireEvidence(archive?.schemaVersion === 1 && archive.kind === 'spark-nf1-public-sale-evidence' && archive.gateway === GATEWAY &&
    typeof transactionHash === 'string' && transactionHash.startsWith('syntxn-') && validHash(transactionHash.slice(7)) &&
    typeof archive.capturedAt === 'string' && Number.isFinite(Date.parse(archive.capturedAt)) &&
    Array.isArray(archive.responses) && archive.responses.length === 4, unsupported);
  const {preflight} = archive;
  const identity = preflight?.identity, capability = preflight?.capability;
  requireEvidence(preflight?.ready === true && identity?.status === 'verified' && identity.chainId === 1266 && identity.incarnation === 5 &&
    identity.networkId === NETWORK && identity.genesisHash === STS_TESTNET_GENESIS && capability?.protocol === 'sts-nf1-sales-v1' &&
    positiveHeight(capability.height) && validHash(capability.blockHash), 'The archive has no supported Chain 1266 sale preflight.');
  const draftError = 'The archived draft bytes do not match the selected buy draft.';
  const archivedDraft = base64Bytes(archive.approvedDraft?.bytesBase64, MAX_SPARK_NF1_DRAFT_BYTES, draftError);
  requireEvidence(archive.approvedDraft.sha256 === draft.sha256 && archivedDraft.length === draftBytes.length &&
    archivedDraft.every((byte, index) => byte === draftBytes[index]), draftError);
  const expectedPayload = hexToBytes(jsonBytes(draftBytes, draftError).payload_hex);

  let remaining = MAX_RESPONSES_BYTES;
  function read(index, method, params) {
    const entry = archive.responses[index];
    const id = `market-${method}`;
    requireEvidence(entry?.requestBody === JSON.stringify({jsonrpc: '2.0', method, params, id}),
      'An archived RPC request differs from the expected purchase replay.');
    const responseError = 'The archive contains an unsupported RPC response.';
    requireEvidence(Number.isInteger(entry.responseStatus) && entry.responseStatus >= 200 && entry.responseStatus < 300, responseError);
    const response = base64Bytes(entry.responseBodyBase64, Math.min(remaining, MAX_RESPONSE_BYTES), responseError);
    remaining -= response.length;
    const reply = jsonBytes(response, responseError, index === 0);
    requireEvidence(reply?.jsonrpc === '2.0' && reply.id === id && !Object.hasOwn(reply, 'error') && record(reply.result), responseError);
    const chain = reply.chain_context;
    requireEvidence(chain?.chain_id === 1266 && chain.chain_incarnation === 5 && chain.genesis_hash === STS_TESTNET_GENESIS,
      'An archived RPC response differs from the pinned Testnet chain context.');
    return reply.result;
  }

  const receipt = read(0, 'synergy_getTransactionReceipt', [transactionHash]);
  requireEvidence(receipt.transactionHash === transactionHash && receipt.from === draft.sender && typeof receipt.to === 'string' &&
    !!receipt.to && receipt.finalized === true && receipt.status === '0x1' && validHash(receipt.blockHash) && validHash(receipt.executionTxId) &&
    positiveHeight(receipt.blockNumber) && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0,
  'The archived receipt does not describe a successful purchase by the draft sender.');
  verifyCarrier(read(1, 'synergy_getBlockByNumber', [receipt.blockNumber]), receipt, draft, expectedPayload);
  const outcome = verifyEvents(read(2, 'sts_getEvents', [draft.nftId, draft.sender, SALE_EVENT_LIMIT]), receipt, draft);
  const state = read(3, 'sts_getNft', [draft.nftId]);
  validateSnapshot(state, receipt);
  const {item, replay} = state;
  requireEvidence(item?.asset_kind === 'nft' && item.class_prefix === 'synn1' && item.nft_id === draft.nftId &&
    item.collection_id === outcome.collectionId && typeof item.owner === 'string' && !!item.owner,
  'The archived NFT state differs from the recorded purchase.');
  return {transactionHash, blockHeight: receipt.blockNumber, blockHash: receipt.blockHash,
    snapshotHeight: replay.latest_height, snapshotHash: replay.snapshot_block_hash, buyerReportedAtSnapshot: item.owner === draft.sender,
    feeNwei: outcome.fee.toString(), buyerDebitNwei: outcome.buyerDebit.toString(), sellerCreditNwei: outcome.sellerCredit.toString()};
}
