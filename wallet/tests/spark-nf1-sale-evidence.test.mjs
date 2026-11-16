import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {inspectSparkNf1SaleEvidence, MAX_SPARK_SALE_EVIDENCE_BYTES} from '../src/spark-nf1-sale-evidence.js';
import {saleBuyer, saleDraftText, saleSeller} from './fixtures/spark-nf1-sale-draft.mjs';
import {archiveBlockHash, archiveBlockHeight, archiveDraftText, archivePrice, archiveTransactionHash,
  encodeSaleEvidence, saleEvidenceFixture} from './fixtures/spark-nf1-sale-evidence.mjs';

const inspect = (fixture, draft = archiveDraftText) => inspectSparkNf1SaleEvidence(Buffer.from(encodeSaleEvidence(fixture)), Buffer.from(draft));
const change = mutate => {
  const fixture = saleEvidenceFixture();
  mutate(fixture);
  return fixture;
};

test('corroborates the archived purchase with exact buyer debit, seller credit, and owner checkpoint', () => {
  assert.deepEqual(inspect(saleEvidenceFixture()), {
    transactionHash: archiveTransactionHash, blockHeight: archiveBlockHeight, blockHash: archiveBlockHash,
    snapshotHeight: archiveBlockHeight, snapshotHash: archiveBlockHash, buyerReportedAtSnapshot: true,
    feeNwei: '40', buyerDebitNwei: '18000000000000043', sellerCreditNwei: '18000000000000003',
  });
});

test('binds to the loaded buy file bytes, even when an alternate file has a valid self-contained digest', () => {
  const archivedDraft = archiveDraftText.replace(/\n/g, '\r\n');
  const alternateEncoding = change(({archive}) => {
    archive.approvedDraft = {sha256: createHash('sha256').update(archivedDraft).digest('hex'),
      bytesBase64: Buffer.from(archivedDraft).toString('base64')};
  });
  assert.throws(() => inspect(alternateEncoding), /draft bytes do not match/);
  assert.throws(() => inspect(saleEvidenceFixture(), saleDraftText('buy')), /draft bytes do not match/);
  for (const operation of ['list', 'cancel']) {
    assert.throws(() => inspect(saleEvidenceFixture(), saleDraftText(operation)), /Select an unsigned Spark buy draft/);
  }
});

test('requires the four recorded request bodies in owner order, with matching parameters and RPC IDs', () => {
  for (const mutate of [
    ({archive}) => {archive.responses.reverse();},
    ({archive}) => {archive.responses[2].requestBody = archive.responses[2].requestBody.replace('1000', '999');},
    ({archive}) => {archive.responses[0].requestBody += '\n';},
  ]) assert.throws(() => inspect(change(mutate)), /archived RPC request differs/);
  assert.throws(() => inspect(change(({archive}) => archive.responses.pop())), /complete Spark NF1 public sale evidence archive/);
  assert.throws(() => inspect(change(({replies}) => {replies[3].id = 'other';})), /unsupported RPC response/);
});

test('rejects foreign archive preflights, reply context, HTTP failures and RPC errors', () => {
  assert.throws(() => inspect(change(({archive}) => {archive.gateway = 'https://example.invalid';})), /complete Spark NF1/);
  assert.throws(() => inspect(change(({archive}) => {archive.preflight.identity.genesisHash = archiveBlockHash;})), /supported Chain 1266 sale preflight/);
  assert.throws(() => inspect(change(({replies}) => {replies[2].chain_context.chain_incarnation--; })), /pinned Testnet chain context/);
  assert.throws(() => inspect(change(({archive}) => {archive.responses[3].responseStatus = 503;})), /unsupported RPC response/);
  assert.throws(() => inspect(change(({replies}) => {replies[0].error = {message: 'private diagnostic'};})), /unsupported RPC response/);
});

test('enforces archive size and canonical bounded base64 before replay', () => {
  const oversized = new Uint8Array(MAX_SPARK_SALE_EVIDENCE_BYTES + 1);
  assert.throws(() => inspectSparkNf1SaleEvidence(oversized, Buffer.from(archiveDraftText)), /up to 34 MiB/);
  const archive = JSON.parse(encodeSaleEvidence(saleEvidenceFixture()));
  archive.responses[0].responseBodyBase64 += '\n';
  assert.throws(() => inspectSparkNf1SaleEvidence(Buffer.from(JSON.stringify(archive)), Buffer.from(archiveDraftText)), /unsupported RPC response/);
});

test('requires a successful finalized receipt and its indexed exact NF1 carrier', () => {
  assert.throws(() => inspect(change(({replies}) => {replies[0].result.status = '0x0';})), /successful purchase/);
  assert.throws(() => inspect(change(({replies}) => {delete replies[0].result.executionTxId;})), /successful purchase/);
  assert.throws(() => inspect(change(({replies}) => {replies[1].result.finalized = false;})), /finalized block does not match/);
  assert.throws(() => inspect(change(({replies}) => {replies[0].result.transactionIndex = 1;})), /does not carry/);
  assert.throws(() => inspect(change(({replies}) => {
    const tx = replies[1].result.transactions[0];
    const [prefix, body] = tx.data.split(':');
    const decoded = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    decoded.transaction.payload[decoded.transaction.payload.length - 1] = 0;
    tx.data = prefix + ':' + Buffer.from(JSON.stringify(decoded)).toString('base64');
  })), /does not carry/);
});

test('requires one execution-matched event and exact draft, price and fee deltas', () => {
  assert.throws(() => inspect(change(({replies}) => {
    const events = replies[2].result;
    events.items.push({...events.items[0]});
    events.count++;
  })), /one matching sale event/);
  assert.throws(() => inspect(change(({replies}) => {replies[2].result.items[0].attributes.price_nwei = String(archivePrice - 1n);})), /draft NFT, parties, or price/);
  assert.throws(() => inspect(change(({replies}) => {replies[2].result.items[0].attributes.seller_balance_after_nwei = String(archivePrice + 3n);})), /SNRG balance changes/);
});

test('checks the checkpoint hash and reports a subsequent owner without exposing them', () => {
  const laterHash = 'e'.repeat(64);
  assert.throws(() => inspect(change(({replies}) => {replies[3].result.replay.snapshot_block_hash = laterHash;})), /receipt checkpoint/);
  const other = inspect(change(({replies}) => {
    const state = replies[3].result;
    state.replay.latest_height++;
    state.replay.snapshot_block_hash = laterHash;
    state.item.owner = saleSeller;
  }));
  assert.equal(other.buyerReportedAtSnapshot, false);
  assert.equal(other.snapshotHash, laterHash);
  assert.equal(other.snapshotHeight, archiveBlockHeight + 1);
  assert.equal(JSON.stringify(other).includes(saleSeller), false);
});

test('accounts for the buyer or seller also being the fee collector', () => {
  const buyerCollector = inspect(change(({replies}) => {
    Object.assign(replies[2].result.items[0].attributes, {fee_collector: saleBuyer, buyer_balance_after_nwei: '100'});
  }));
  assert.equal(buyerCollector.buyerDebitNwei, String(archivePrice));
  const sellerCollector = inspect(change(({replies}) => {
    Object.assign(replies[2].result.items[0].attributes, {fee_collector: saleSeller, seller_balance_after_nwei: String(archivePrice + 44n)});
  }));
  assert.equal(sellerCollector.sellerCreditNwei, String(archivePrice + 40n));
});

test('preserves a wide numeric receipt fee from raw JSON without rounding', () => {
  const fee = '9007199254740993';
  const fixture = change(({replies}) => {
    Object.assign(replies[2].result.items[0].attributes, {network_fee_nwei: fee,
      buyer_balance_before_nwei: String(archivePrice + BigInt(fee) + 60n)});
    replies[0].result.ignored = 'do not transform \"feeCharged\":41 in JSON text';
  });
  const encodeWide = (reply, index) => index === 0 ? JSON.stringify(reply).replace('"feeCharged":40', '"feeCharged":' + fee) : JSON.stringify(reply);
  const bytes = Buffer.from(encodeSaleEvidence(fixture, encodeWide));
  const result = inspectSparkNf1SaleEvidence(bytes, Buffer.from(archiveDraftText));
  assert.equal(result.feeNwei, fee);
  assert.equal(result.buyerDebitNwei, String(archivePrice + BigInt(fee)));
  const encodeFraction = (reply, index) => index === 0 ? JSON.stringify(reply).replace('"feeCharged":40', '"feeCharged":40.0') : JSON.stringify(reply);
  assert.throws(() => inspectSparkNf1SaleEvidence(Buffer.from(encodeSaleEvidence(saleEvidenceFixture(), encodeFraction)),
    Buffer.from(archiveDraftText)), /invalid nWei amount/);
});
