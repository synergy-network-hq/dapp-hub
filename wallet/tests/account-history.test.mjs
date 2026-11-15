import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccountHistory } from '../src/account-history.js';

const account = 'syna1' + 'q'.repeat(36);
const row = (hash, height) => ({
  hash, block_number: String(height), sender_address: account,
  receiver_address: null, amount_nwei: '1000000000000000000001', fee_nwei: null, nonce: null,
});
const page = (items, nextCursor = null) => ({
  version: 1, address: account, source: 'atlas_transactions', network: 'testnet-v3',
  limit: 25, partial: true, observedAt: '2026-11-15T12:00:00Z', indexedAt: null,
  warnings: [], snapshot: { blockNumber: '10', blockHash: 'synblk10' },
  items, hasMore: nextCursor !== null, nextCursor,
});

test('passes the previous page cursor unchanged and preserves exact indexed amounts', async () => {
  const first = await readAccountHistory(async () => page([row('a', 10), row('b', 9)], 'cursor_1'), account);
  const next = await readAccountHistory(async path => {
    assert.equal(new URL(path, 'https://index.example/').searchParams.get('cursor'), 'cursor_1');
    return page([row('c', 9), row('d', 8)]);
  }, account, { cursor: first.nextCursor, previous: first });
  assert.equal(next.items[0].amount_nwei, '1000000000000000000001');
});

test('rejects a substituted cursor and an out-of-order follow-up page', async () => {
  const first = await readAccountHistory(async () => page([row('a', 9)], 'cursor_1'), account);
  await assert.rejects(readAccountHistory(async () => assert.fail('unexpected request'), account,
    { cursor: 'different_cursor', previous: first }), /unsupported account-history cursor/i);
  await assert.rejects(readAccountHistory(async () => page([row('b', 10)]), account,
    { cursor: first.nextCursor, previous: first }), /changed scope/);
  await assert.rejects(readAccountHistory(async () => page([row('a', 8), row('b', 9)]), account), /changed scope/);
});
