import {contactAddressProfile} from './wallet-address.js';

// Atlas normalizes its address paths, response echoes and history cursors to
// lowercase. Derive that index key without changing the connected account.
export function atlasAccountKey(account) {
  if (typeof account !== 'string' || account.length > 150 ||
      !/^syn[A-Za-z0-9]{17,147}$/.test(account) || account.trim() !== account) return null;

  const lower = account.toLowerCase();
  if (account.startsWith('synw') && account.length === 44) {
    return contactAddressProfile(account) === 'protected' ? lower : null;
  }
  return account === lower ? account : null;
}

export function requireAtlasAccountKey(account) {
  const key = atlasAccountKey(account);
  if (key === null) throw Error('A supported Wallet account is required for Atlas observations.');
  return key;
}

export async function readAtlasAddress(request, account, {signal} = {}) {
  signal?.throwIfAborted();
  const key = requireAtlasAccountKey(account);
  const value = await request(`address/${encodeURIComponent(key)}`, {signal});
  signal?.throwIfAborted();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Account response is unavailable or unsupported. History and balance are unknown.');
  }
  if (value.address !== key) throw Error('Atlas returned a different or unbound Wallet account.');
  return value;
}
