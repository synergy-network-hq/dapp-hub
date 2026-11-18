export const ATLAS_NETWORK = 'Synergy Testnet v3 · Chain 1266';
export const LATEST_INDEXED_BLOCK = 'blocks?page=1&limit=1';

function decimalText(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^[0-9]{1,78}$/.test(value)) return value;
  return null;
}

export function atlasSummary(value) {
  if (value?.chainId !== 1266 && value?.chainId !== '1266') {
    throw Error('Atlas did not report the expected Testnet chain.');
  }
  return {
    height: decimalText(value.latestBlock),
    transactions: decimalText(value.totalTransactions),
    activeValidators: decimalText(value.activeValidators),
    totalValidators: decimalText(value.totalValidators),
  };
}

export function latestIndexedBlock(value) {
  if (value?.page !== 1 || value.limit !== 1 || !Array.isArray(value.items) || value.items.length > 1) {
    throw Error('Atlas returned an unsupported indexed block page.');
  }
  if (!value.items.length) return null;
  const block = value.items[0];
  const height = decimalText(block?.number);
  if (height === null) throw Error('Atlas did not report a supported indexed block height.');
  const timestamp = block.indexed_at ?? block.indexedAt;
  const indexedAt = typeof timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    && Number.isFinite(Date.parse(timestamp))
    ? new Date(timestamp).toISOString() : null;
  return {height, indexedAt};
}
