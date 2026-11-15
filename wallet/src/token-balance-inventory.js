import {text} from '@synergy-network/dapp-data-view';
import {requireAtlasAccountKey} from './atlas-account.js';
import {blockHeight} from './transaction-observation.js';
import {isStsFungibleObjectId} from './wallet-address.js';

const atlasSource = 'atlas_token_balances';
const unavailable = 'Token balance response is unavailable or unsupported. Inventory coverage is unknown.';

export const tokenBalanceSources = {
  sts: 'Atlas STS balance index',
  synq: 'Atlas SynQ deployment receipt',
  other: 'Other Atlas response format',
};

export const rpcTokenBalanceSources = {
  rpcNative: 'Selected RPC native SNRG ledger',
  rpcSts: 'Selected RPC STS snapshot',
};
export const RPC_TOKEN_INVENTORY_LIMIT = 50;
const rpcSnapshotSources = new Set(['finalized_chain1266_execution_state', 'finalized_sts_snapshot']);
const maxU128 = 340282366920938463463374607431768211455n;

function exactRpcAmount(value, max) {
  const digits = Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof digits === 'string' && digits.trim() === digits && /^(0|[1-9][0-9]{0,38})$/.test(digits) &&
    BigInt(digits) <= max ? digits : null;
}

// The chain-1266 owner RPC returns the native ledger row and an exact-owner STS execution snapshot.
export function rpcTokenBalanceInventory(response, account, readiness) {
  const {value, chainContext} = response;
  const chain = readiness.chain;
  if (chainContext?.chainId !== chain.chainId || String(chainContext.incarnation) !== chain.incarnation ||
      chainContext.genesis !== chain.genesis.toLowerCase()) {
    throw Error('The token response does not match the selected RPC readiness identity.');
  }
  if (value?.owner !== account) throw Error('The selected RPC did not return the exact Wallet owner.');

  const replay = value.replay;
  const snapshotHeight = blockHeight(replay?.latest_height);
  const snapshotHash = replay?.snapshot_block_hash;
  if (value.success !== true || !rpcSnapshotSources.has(replay?.source) ||
      value.source !== `native_snrg_ledger_and_${replay.source}` || replay.complete !== true ||
      snapshotHeight === null || typeof snapshotHash !== 'string' || snapshotHash.length !== 64 ||
      !/^[0-9a-f]{64}$/.test(snapshotHash) || !Array.isArray(value.items) || value.count !== value.items.length ||
      value.items.length < 1 || value.items.length > RPC_TOKEN_INVENTORY_LIMIT) {
    throw Error('The selected RPC did not return a supported token inventory snapshot.');
  }

  const [native, ...sts] = value.items;
  const nativeAmount = exactRpcAmount(native?.balance_nwei, 18446744073709551615n);
  if (native?.asset_kind !== 'native' || native.owner !== account || native.symbol !== 'SNRG' ||
      native.token_id !== null || native.token_address !== null || nativeAmount === null ||
      nativeAmount !== exactRpcAmount(native.balance, 18446744073709551615n)) {
    throw Error('The selected RPC returned an unsupported native SNRG row.');
  }

  const seen = new Set();
  const items = sts.map(row => {
    const balance = exactRpcAmount(row?.balance, maxU128);
    if (row?.asset_kind !== 'sts' || row.owner !== account || !isStsFungibleObjectId(row.token_id) ||
        row.token_address !== row.token_id || seen.has(row.token_id) || typeof row.symbol !== 'string' ||
        row.symbol.trim() !== row.symbol || !/^[A-Z][A-Z0-9]{1,11}$/.test(row.symbol) || row.symbol.includes('SNRG') ||
        !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 9 || typeof row.frozen !== 'boolean' || balance === null) {
      throw Error('The selected RPC returned an invalid or ambiguous STS balance row.');
    }
    seen.add(row.token_id);
    return {source: 'rpc_sts_token_balances', symbol: row.symbol, tokenId: row.token_id,
      tokenAddress: row.token_address, tokenStandard: 'Native STS fungible', raw: balance, decimals: row.decimals, frozen: row.frozen};
  });
  items.unshift({source: 'rpc_native_token_balance', symbol: 'SNRG', raw: nativeAmount, decimals: 9, tokenStandard: 'Native SNRG'});
  return {kind: 'rpc', items, snapshotHeight, snapshotHash, receivedAt: Date.now()};
}

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
    return {items: value.items, accountReported, accountKey};
  }

  const items = [value.items, value.tokens, value.balances].find(Array.isArray);
  if (!items) throw Error(unavailable);
  return {items, accountReported};
}

export function tokenBalanceSource(item, kind) {
  if (kind === 'rpc') return item.source === 'rpc_native_token_balance' ? 'rpcNative' : 'rpcSts';
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

export function reportedTokenQuantity(item, kind) {
  const source = tokenBalanceSource(item, kind);
  if (source !== 'other') {
    const raw = atomicString(item.raw);
    const decimals = reportedTokenDecimals(item.decimals);
    return {
      value: raw !== null && decimals !== null ? tokenUnits(raw, decimals) : 'Unavailable',
      raw,
      units: source === 'sts' ? 'Indexed token units' : source === 'synq' ? 'Initial token units reported at deployment' : 'RPC-reported token units',
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
