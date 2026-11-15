import {text} from '@synergy-network/dapp-data-view';
import {requireAtlasAccountKey} from './atlas-account.js';

const atlasSource = 'atlas_token_balances';
const unavailable = 'Token balance response is unavailable or unsupported. Inventory coverage is unknown.';

export const tokenBalanceSources = {
  sts: 'Atlas STS balance index',
  synq: 'Atlas SynQ deployment receipt',
  other: 'Other Atlas response format',
};

export async function readAtlasTokenBalances(request, account, {signal} = {}) {
  signal?.throwIfAborted();
  const key = requireAtlasAccountKey(account);
  const value = await request(`wallets/${encodeURIComponent(key)}/token-balances`, {signal});
  signal?.throwIfAborted();
  return tokenBalanceInventory(value, key);
}

export function tokenBalanceInventory(value, accountKey) {
  if (!value || typeof value !== 'object') throw Error(unavailable);
  if (Array.isArray(value)) return {items: value, accountReported: false};

  const accountReported = Object.hasOwn(value, 'address');
  if (accountReported && value.address !== accountKey) {
    throw Error('Atlas returned token balances for a different account.');
  }
  if (value.source === atlasSource) {
    if (!accountReported || !Array.isArray(value.items) || value.total !== value.items.length) {
      throw Error(unavailable);
    }
    return {items: value.items, accountReported};
  }

  const items = [value.items, value.tokens, value.balances].find(Array.isArray);
  if (!items) throw Error(unavailable);
  return {items, accountReported};
}

export function tokenBalanceSource(item) {
  if (item.source === 'atlas_sts_token_balances') return 'sts';
  if (item.source === 'atlas_synq_deploy_receipt') return 'synq';
  return 'other';
}

export function reportedTokenDecimals(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function atomicString(value) {
  return typeof value === 'string' && value.trim() === value && /^[0-9]{1,78}$/.test(value) ? value : null;
}

function tokenUnits(raw, decimals) {
  const digits = raw.replace(/^0+(?=\d)/, '').padStart(decimals + 1, '0');
  if (decimals === 0) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  const whole = digits.slice(0, -decimals);
  return fraction ? whole + '.' + fraction : whole;
}

export function reportedTokenQuantity(item) {
  const source = tokenBalanceSource(item);
  if (source !== 'other') {
    const raw = atomicString(item.raw);
    const decimals = reportedTokenDecimals(item.decimals);
    return {
      value: raw !== null && decimals !== null ? tokenUnits(raw, decimals) : 'Unavailable',
      raw,
      units: source === 'sts' ? 'Indexed token units' : 'Initial token units reported at deployment',
    };
  }

  if (item.formattedBalance != null) return {value: text(item.formattedBalance), units: 'Index-formatted quantity; units unspecified'};
  if (item.balance != null) return {value: text(item.balance), units: 'Index quantity; units unspecified'};
  if (item.balanceNwei != null) {
    const value = Number.isSafeInteger(item.balanceNwei) && item.balanceNwei >= 0
      ? String(item.balanceNwei)
      : atomicString(item.balanceNwei);
    return {value: value ?? 'Unavailable', units: 'Raw index quantity; units unspecified'};
  }
  return {value: 'Unavailable', units: 'No supported quantity field'};
}
