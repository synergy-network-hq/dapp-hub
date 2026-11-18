// Synthetic Chain 1266 archive from Spark fe1d099 test/nft-sale-verification.test.js.
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {saleBuyer, saleDraftText, saleListing, saleNft, salePayloads, salePriceNwei, saleSeller} from './spark-nf1-sale-draft.mjs';

export const archivePrice = 18_000_000_000_000_003n;
export const archiveTransactionHash = 'syntxn-' + 'c'.repeat(64);
export const archiveBlockHeight = 5_450_500;
export const archiveBlockHash = 'b'.repeat(64);
const executionTxId = 'd'.repeat(64);
const collectionId = 'synn1197lkezpjyn9sp33px3cc5ss5ygaehp8eta48md';
const genesisHash = '2272fe2b48c6e2019b27223f61ba8d8a82b58656fe9daab50c81f224a301ca74';
const network = 'synergy-testnet-v3';
const source = 'finalized_chain1266_execution_state';
const archivePayload = salePayloads.buy.replace(salePriceNwei, String(archivePrice));
export const archiveDraftText = saleDraftText('buy', archivePayload);

export function saleEvidenceFixture() {
  const replay = () => ({source, complete: true, latest_height: archiveBlockHeight, snapshot_block_hash: archiveBlockHash});
  const transaction = {chain_id: 1266, network_id: network, sender_uma_or_account: saleBuyer, payload: [...Buffer.from(archivePayload)]};
  const event = {event_type: 'StsNftSaleSettled', token_id: saleNft, owner: saleSeller, sender: saleBuyer,
    recipient: saleBuyer, amount: '1', attributes: {execution_tx_id: executionTxId, listing_id: saleListing,
      collection_id: collectionId, block_height: String(archiveBlockHeight), price_nwei: String(archivePrice), payment_asset: 'SNRG',
      fee_collector: 'collector', network_fee_nwei: '40', buyer_balance_before_nwei: String(archivePrice + 100n),
      buyer_balance_after_nwei: '60', seller_balance_before_nwei: '4', seller_balance_after_nwei: String(archivePrice + 4n)}};
  const reads = [
    ['synergy_getTransactionReceipt', [archiveTransactionHash], {transactionHash: archiveTransactionHash, blockHash: archiveBlockHash,
      blockNumber: archiveBlockHeight, executionTxId, transactionIndex: 0, from: saleBuyer, to: saleBuyer,
      finalized: true, status: '0x1', feeCharged: 40}],
    ['synergy_getBlockByNumber', [archiveBlockHeight], {hash: archiveBlockHash, height: archiveBlockHeight, finalized: true,
      finality_status: 'finalized', source: 'canonical_finality_store', transaction_format: 'synergy_native_v3', tx_count: 1,
      transactions: [{chain_id: 1266, network_id: network, sender: saleBuyer, receiver: saleBuyer,
        data: 'aegis-pqvm-tx-v1:' + Buffer.from(JSON.stringify({transaction})).toString('base64')}]}],
    ['sts_getEvents', [saleNft, saleBuyer, 1000], {source, success: true, replay: replay(), token_ref: saleNft,
      owner: saleBuyer, items: [event], count: 1}],
    ['sts_getNft', [saleNft], {source, success: true, replay: replay(), item: {asset_kind: 'nft', class_prefix: 'synn1',
      nft_id: saleNft, owner: saleBuyer, collection_id: collectionId}}],
  ];
  const archive = {
    schemaVersion: 1, kind: 'spark-nf1-public-sale-evidence', gateway: 'https://testnet-rpc.synergy-network.io',
    capturedAt: '2026-11-15T11:00:00Z', transactionHash: archiveTransactionHash,
    approvedDraft: {sha256: createHash('sha256').update(archiveDraftText).digest('hex'),
      bytesBase64: Buffer.from(archiveDraftText).toString('base64')},
    preflight: {ready: true, identity: {status: 'verified', chainId: 1266, incarnation: 5, networkId: network, genesisHash},
      capability: {protocol: 'sts-nf1-sales-v1', height: archiveBlockHeight, blockHash: archiveBlockHash}},
    responses: [],
  };
  const replies = reads.map(([method, params, result]) => {
    const id = `market-${method}`;
    archive.responses.push({requestBody: JSON.stringify({jsonrpc: '2.0', method, params, id}), responseStatus: 200});
    return {jsonrpc: '2.0', id, chain_context: {chain_id: 1266, chain_incarnation: 5, genesis_hash: genesisHash}, result};
  });
  return {archive, replies};
}

export function encodeSaleEvidence({archive, replies}, encodeReply = JSON.stringify) {
  const responses = archive.responses.map((entry, index) => ({...entry,
    responseBodyBase64: Buffer.from(' \n' + encodeReply(replies[index], index) + '\r\n').toString('base64')}));
  return JSON.stringify({...archive, responses}, null, 2) + '\n';
}
