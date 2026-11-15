// The supported API and explorer route shapes follow Atlas v3 at 3fb8f87.
const origin = 'https://atlas.synergy-network.io';
const kinds = {blocks: 'block', txs: 'transaction', 'network/accounts': 'account', validators: 'validator', contracts: 'contract', tokens: 'token'};
const webPaths = {block: 'blocks', transaction: 'transactions', account: 'accounts', validator: 'validators', contract: 'contracts', token: 'tokens'};
const transactionPattern = /^(?:(syntxn|synxxn)-)?([a-f0-9]{64})$/i;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;

function height(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (!bounded(value, 19) || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 9223372036854775807n) return null;
  return value;
}

function hash(value) {
  return bounded(value, 160) && /^[A-Za-z0-9_-]+$/.test(value) ? value.toLowerCase() : null;
}

function transaction(value) {
  if (!bounded(value, 71)) return null;
  return transactionPattern.test(value) ? value.toLowerCase() : null;
}

function address(value, validator = false) {
  if (!bounded(value, 96) || !/^syn[A-Za-z0-9]{35,93}$/.test(value)) return null;
  const normalized = value.toLowerCase();
  return !validator || normalized.startsWith('synv') ? normalized : null;
}

function tokenId(value) {
  return bounded(value, 160) && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]*$/.test(value) && !value.includes('..') ? value : null;
}

export function describeAtlasSelection(row, tab, searching = false) {
  const unsupported = () => { throw Error('This Atlas row has no supported detail identifier.'); };
  if (!record(row)) return unsupported();

  const kind = searching ? row.type : kinds[tab];
  if (kind === 'block') {
    const number = height(searching ? row.blockNumber : row.number);
    const blockHash = hash(searching ? row.id : row.hash);
    const key = searching ? blockHash : number;
    if (key === null || (!searching && row.hash != null && blockHash === null)) return unsupported();
    return {kind, key, number, blockHash, path: `blocks/${encodeURIComponent(key)}?includeTx=true`, webKey: number ?? key};
  }
  if (kind === 'transaction') {
    const key = transaction(searching ? row.id : row.hash);
    if (key === null) return unsupported();
    return {kind, key, path: `txs/${encodeURIComponent(key)}`, webKey: key};
  }
  if (kind === 'account' || kind === 'validator' || kind === 'contract') {
    const key = address(searching ? row.id : row.address, kind === 'validator');
    if (key === null) return unsupported();
    const api = kind === 'account' ? 'address' : webPaths[kind];
    return {kind, key, path: `${api}/${encodeURIComponent(key)}`, webKey: key};
  }
  if (kind === 'token') {
    const key = tokenId(searching ? row.id : row.tokenId ?? row.tokenAddress ?? row.contractAddress ?? row.symbol);
    if (key === null) return unsupported();
    // The owner exposes a registry and subresources, but no token detail GET.
    return {kind, key, path: null, webKey: key};
  }
  return unsupported();
}

export function checkedAtlasDetail(selection, value) {
  const mismatch = () => { throw Error('Atlas returned a different or unsupported record. Refresh the list and select it again.'); };
  if (!record(value)) return mismatch();
  if (selection.kind === 'block') {
    const number = height(value.number);
    const blockHash = hash(value.hash);
    if (number === null || blockHash === null ||
      (selection.number !== null && number !== selection.number) ||
      (selection.blockHash !== null && blockHash !== selection.blockHash)) return mismatch();
    return {...selection, webKey: number, data: value};
  }
  if (selection.kind === 'transaction') {
    const observed = transaction(value.hash);
    if (observed === null || (selection.key !== observed &&
      !(selection.key.length === 64 && observed.endsWith('-' + selection.key)))) return mismatch();
    return {...selection, webKey: observed, data: value};
  }
  if (selection.kind === 'validator') {
    if (address(value.validator?.address, true) !== selection.key) return mismatch();
  } else if (selection.kind !== 'token' && address(value.address) !== selection.key) {
    return mismatch();
  }
  if (selection.kind === 'contract') {
    return {...selection, data: {
      address: selection.key, name: value.name, contractType: value.contractType,
      bytecodeHash: value.bytecodeHash, verified: value.verified,
      deployedBlock: value.deployedBlock, deployedAt: value.deployedAt,
    }};
  }
  return {...selection, data: value};
}

export function atlasDetailUrl(selection) {
  return `${origin}/${webPaths[selection.kind]}/${encodeURIComponent(selection.webKey)}`;
}
