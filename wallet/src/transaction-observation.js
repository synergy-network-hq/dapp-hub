// Response fields from testnet-v3's synergy_getTransactionByHash explorer projection.
const hashPattern = /^(?:(syntxn|synxxn)-)?([a-f0-9]{64})$/i;

export function comparableTransactionHash(value) {
  if (typeof value !== 'string' || value.length > 71) return null;
  const match = hashPattern.exec(value);
  return match?.[0] === value ? {kind: match[1]?.toLowerCase(), digest: match[2].toLowerCase()} : null;
}

function blockHeight(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim() === value && /^[0-9]{1,20}$/.test(value)) {
    const height = BigInt(value);
    if (height <= 18446744073709551615n) return height.toString();
  }
  return null;
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
