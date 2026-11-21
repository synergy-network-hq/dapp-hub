import assert from 'node:assert/strict';
import test from 'node:test';
import {compareSparkNf1WalletInspection, MAX_NATIVE_INSPECTION_BYTES} from '../src/spark-nf1-wallet-inspection.js';
import {mintDraftText, mintPayload, mintSender} from './fixtures/spark-nf1-draft.mjs';
import {saleDraftText, salePriceNwei, saleSeller} from './fixtures/spark-nf1-sale-draft.mjs';
import {walletInspectionTexts} from './fixtures/spark-nf1-wallet-inspection.mjs';

const inspect = (report, draft = mintDraftText()) =>
  compareSparkNf1WalletInspection(Buffer.from(report), Buffer.from(draft));

for (const [action, report] of Object.entries(walletInspectionTexts)) {
  test(`matches the pinned native Wallet inspection for the unsigned NF1 ${action} draft`, () => {
    const draft = action === 'mint' ? mintDraftText() : saleDraftText(action);
    assert.deepEqual(inspect(report, draft), {
      maximumGasPriceNwei: '40', maximumBalanceReserveNwei: '100000000', purchasePriceNwei: action === 'buy' ? salePriceNwei : '0',
    });
  });
}

test('permits formatting and key-order changes without weakening exact wide numeric comparison', () => {
  const reordered = walletInspectionTexts.buy.replace(/^\{\n(  "draft_sha256": "[0-9a-f]{64}"),\n([\s\S]*)\n\}\n$/, '{\n$2,\n$1\n}\n');
  assert.equal(inspect(reordered, saleDraftText('buy')).purchasePriceNwei, salePriceNwei);
  const closePrice = (BigInt(salePriceNwei) - 1n).toString();
  assert.equal(Number(closePrice), Number(salePriceNwei));
  for (const report of [
    walletInspectionTexts.buy.replace(`"price_nwei": ${salePriceNwei}`, `"price_nwei": ${closePrice}`),
    walletInspectionTexts.buy.replace(`"price_nwei": ${salePriceNwei}`, `"price_nwei": "${salePriceNwei}"`),
    walletInspectionTexts.buy.replace(`"purchase_price_nwei": "${salePriceNwei}"`, `"purchase_price_nwei": "${closePrice}"`),
  ]) assert.throws(() => inspect(report, saleDraftText('buy')), /differs from the draft/);
});

test('checks the original draft digest and exact sender, chain, payload and fixed review bounds', () => {
  const report = walletInspectionTexts.mint;
  assert.throws(() => inspect(report, mintDraftText(mintPayload.replace('1794761001', '1794761002'))), /different unsigned draft/);
  for (const [encoded, changed] of [
    [`"sender": "${mintSender}"`, `"sender": "${saleSeller}"`],
    ['"chain_id": 1266', '"chain_id": 1264'],
    ['"metadata_mutable": false', '"metadata_mutable": true'],
    ['"maximum_carrier_gas_price_nwei": 40', '"maximum_carrier_gas_price_nwei": 4e1'],
    ['"maximum_carrier_gas_price_nwei": 40', '"maximum_carrier_gas_price_nwei": "40"'],
    ['"maximum_balance_reserve_nwei": "100000000"', '"maximum_balance_reserve_nwei": "100000001"'],
    ['"purchase_price_nwei": "0"', '"purchase_price_nwei": "1"'],
    ['"review": {', '"review": {"signature":"fixture-hidden",'],
  ]) assert.throws(() => inspect(report.replace(encoded, changed)), /differs from the draft/);
});

test('rejects duplicate and escaped duplicate keys, malformed bytes and oversized reports', () => {
  const report = walletInspectionTexts.mint;
  for (const malformed of [
    report.replace('"review": {', '"review": null, "review": {'),
    report.replace('"minted_at": 1794761001', '"minted_at": 1794761002, "minted_\\u0061t": 1794761001'),
    report.replace('"chain_id": 1266', '"chain_id": "\\u00001266"'),
    report.replace('"maximum_carrier_gas_price_nwei": 40', '"maximum_carrier_gas_price_nwei": 4 0'),
    report + '{}',
    Buffer.from([0xff, 0xfe]),
    '',
  ]) assert.throws(() => inspect(malformed), /supported native Wallet inspection report/);
  assert.throws(() => inspect(Buffer.alloc(MAX_NATIVE_INSPECTION_BYTES + 1)), /exceeds 128 KiB/);
});
