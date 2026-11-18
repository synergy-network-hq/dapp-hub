import {atlasAccountKey} from './atlas-account.js';

export function atlasAccountSynIds(value, account) {
  const key = atlasAccountKey(account);
  const records = value?.synIds;
  if (!key || value?.address !== key || !Array.isArray(records) || records.length > 100) return null;

  const names = new Set();
  for (const record of records) {
    const name = record?.synId;
    if (record?.address !== key || record.verified !== true || record.source !== 'synergy_qrpc' ||
        typeof name !== 'string' || name !== name.trim() || !/^[a-z0-9][a-z0-9-]{2,31}\.syn$/.test(name)) return null;
    names.add(name);
  }
  return [...names];
}
