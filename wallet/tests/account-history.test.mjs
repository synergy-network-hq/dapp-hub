import assert from 'node:assert/strict';
import test from 'node:test';
import {readAccountHistory} from '../src/account-history.js';

// Public checksum vector from Wallet source. It is only used with fixture transport here.
const account = 'synw7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const key = account.toLowerCase();
const head = '9007199254740993';
const belowHead = '9007199254740992';
const row = (hash, height) => ({
  hash, block_number: height, sender_address: key, receiver_address: null,
  amount_nwei: '1000000000000000000001', fee_nwei: null, nonce: null,
});
const page = (items, nextCursor = null) => ({
  version: 1, address: key, source: 'atlas_transactions', network: 'testnet-v3',
  limit: 25, partial: true, observedAt: '2026-11-15T12:00:00Z', indexedAt: null,
  warnings: [], snapshot: {blockNumber: head, blockHash: 'synblkfixture'},
  items, hasMore: nextCursor !== null, nextCursor,
});

test('follows the exact prior cursor for the canonical key and retains same-height rows', async () => {
  const first = await readAccountHistory(async path => {
    assert.equal(path, `accounts/${key}/transactions?limit=25`);
    return page([row('first', head), row('second', belowHead)], 'cursor_1');
  }, account);
  const next = await readAccountHistory(async path => {
    assert.equal(path, `accounts/${key}/transactions?limit=25&cursor=cursor_1`);
    return page([row('third', belowHead), row('fourth', '9007199254740991')]);
  }, account, {cursor: first.nextCursor, previous: first});
  assert.equal(next.address, key);
  assert.equal(next.items[0].block_number, belowHead);
  assert.equal(next.items[0].amount_nwei, '1000000000000000000001');
});

test('refuses a missing, substituted, or terminal prior cursor without making a request', async () => {
  const first = await readAccountHistory(async () => page([row('first', head)], 'cursor_1'), account);
  const terminal = await readAccountHistory(async () => page([row('first', head)]), account);
  const doNotRead = async () => assert.fail('Unexpected history request');

  await assert.rejects(readAccountHistory(doNotRead, account, {cursor: 'cursor_1'}), /unsupported account-history cursor/i);
  await assert.rejects(readAccountHistory(doNotRead, account, {cursor: 'cursor_other', previous: first}), /unsupported account-history cursor/i);
  await assert.rejects(readAccountHistory(doNotRead, account, {cursor: 'cursor_1', previous: terminal}), /unsupported account-history cursor/i);
});

test('refuses ascending heights within the initial page or across a cursor boundary', async () => {
  await assert.rejects(readAccountHistory(async () => page([row('first', belowHead), row('second', head)]), account), /changed scope/);

  const first = await readAccountHistory(async () => page([row('first', belowHead)], 'cursor_1'), account);
  await assert.rejects(readAccountHistory(async () => page([row('second', head)]), account,
    {cursor: first.nextCursor, previous: first}), /changed scope/);
});
