import {atlasAccountKey} from './atlas-account.js';

// Response fields from testnet-v3's synergy_getTransactionByHash explorer projection.
const hashPattern = /^(?:(syntxn|synxxn)-)?([a-f0-9]{64})$/i;

export function comparableTransactionHash(value) {
  if (typeof value !== 'string' || value.length > 71) return null;
  const match = hashPattern.exec(value);
  return match?.[0] === value ? {kind: match[1]?.toLowerCase(), digest: match[2].toLowerCase()} : null;
}

export function blockHeight(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim() === value && /^[0-9]{1,20}$/.test(value)) {
    const height = BigInt(value);
    if (height <= 18446744073709551615n) return height.toString();
  }
  return null;
}

function atlasParticipant(value, primary, alias) {
  const address = value[primary];
  if ((address !== null && typeof address !== 'string') ||
      (Object.hasOwn(value, alias) && value[alias] !== address)) {
    throw Error('Atlas returned inconsistent transaction participants.');
  }
  return address;
}

// The Atlas detail route attaches receipt fields to a transaction projection.
// It does not return the upstream receipt's own chain, block or transaction identity.
export function atlasReceiptObservation(value, hash, account, height) {
  const selected = comparableTransactionHash(hash);
  const returned = comparableTransactionHash(value?.hash);
  if (!selected || !returned || selected.kind !== returned.kind || selected.digest !== returned.digest) {
    throw Error('Atlas did not return the selected transaction hash.');
  }

  const accountKey = atlasAccountKey(account);
  const sender = atlasParticipant(value, 'sender_address', 'sender');
  const receiver = atlasParticipant(value, 'receiver_address', 'receiver');
  if (!accountKey || ![sender, receiver].some(address => address === accountKey || address === account)) {
    throw Error('The Atlas transaction does not include the connected account.');
  }
  if (value.indexed === false) return {kind: 'fallback'};
  if (value.indexed !== true) throw Error('Atlas did not identify an indexed transaction record.');

  const expectedBlock = blockHeight(height);
  if (expectedBlock === null || blockHeight(value.block_number) !== expectedBlock ||
      (Object.hasOwn(value, 'blockNumber') && blockHeight(value.blockNumber) !== expectedBlock)) {
    throw Error('Atlas returned a different or unsupported indexed block. Refresh Wallet observations.');
  }

  const receiptStatus = value.receipt_status ?? null;
  const executionStatus = value.synq_execution_status ?? null;
  if (receiptStatus === null && executionStatus === null) return {kind: 'unavailable'};
  if ((receiptStatus !== '0x0' && receiptStatus !== '0x1') ||
      (executionStatus !== null && executionStatus !== 'succeeded' && executionStatus !== 'failed') ||
      (receiptStatus === '0x1' && executionStatus === 'failed')) {
    throw Error('Atlas returned an unsupported receipt status.');
  }
  return {kind: 'reported', receiptStatus, executionStatus};
}

export function transactionObservation(value, requestedHash, account) {
  const requested = comparableTransactionHash(requestedHash);
  if (!requested) throw Error('The indexed transaction hash has an unsupported format.');
  if (value === null) return {state: 'notFound', block: null};

  const observed = comparableTransactionHash(value?.hash);
  if (!observed || observed.digest !== requested.digest ||
    (requested.kind && observed.kind && requested.kind !== observed.kind)) {
    throw Error('RPC did not return the selected transaction hash.');
  }
  if (value.chain_id !== 1266 || value.network_id !== 'testnet') {
    throw Error('RPC transaction network differs from the Wallet network.');
  }
  if (typeof account !== 'string' || !account || (value.sender !== account && value.receiver !== account)) {
    throw Error('RPC transaction does not include the connected account.');
  }

  if (value.status === 'pending' && value.block_number === null) {
    return {state: 'pending', block: null};
  }
  const block = blockHeight(value.block_number);
  if (value.status === 'confirmed' && block !== null) {
    return {state: 'inBlock', block};
  }
  throw Error('RPC returned an unsupported transaction status or block height.');
}

export function compareIndexedBlock(value, observation) {
  const indexedBlock = blockHeight(value);
  if (indexedBlock === null) return null;
  if (observation.state === 'inBlock') {
    return indexedBlock === observation.block ? null : 'Atlas and RPC report different block heights.';
  }
  return observation.state === 'pending'
    ? 'Atlas reports a block, while the selected RPC reports this transaction pending.'
    : 'Atlas reports a block, while the selected RPC returned no transaction.';
}

export function blockLookupHeight(height) {
  const exact = blockHeight(height);
  return exact !== null && BigInt(exact) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : null;
}

export function reportedBlockMembership(value, height, transactionHash) {
  const selected = comparableTransactionHash(transactionHash);
  const expectedHeight = blockHeight(height);
  if (!selected || expectedHeight === null) throw Error('The selected transaction or block identity is unsupported.');
  if (value === null) return {state: 'unavailable', hash: null};

  const hash = value?.hash;
  if (blockHeight(value?.block_index) !== expectedHeight || typeof hash !== 'string' ||
      hash.length !== 64 || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw Error('RPC did not return the reported block identity.');
  }

  // Typed and coordinated finality projections do not carry the legacy
  // explorer hashes needed by this lookup. An unrecognizable projection
  // cannot establish that the selected transaction is missing.
  if (Object.hasOwn(value, 'transaction_format')) return {state: 'unsupported', hash};
  const rows = value.transactions;
  if (!Array.isArray(rows) || rows.length > 10_000 || blockHeight(value.tx_count) !== String(rows.length)) {
    return {state: 'unsupported', hash};
  }
  const hashes = rows.map(row => comparableTransactionHash(row?.hash));
  if (hashes.some(row => row === null || row.kind === undefined)) return {state: 'unsupported', hash};
  const count = hashes.filter(row => row.digest === selected.digest &&
    (selected.kind === undefined || selected.kind === row.kind)).length;
  if (count > 1) return {state: 'ambiguous', hash};
  return {state: count === 1 ? 'listed' : 'notListed', hash};
}
