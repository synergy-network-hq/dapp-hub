const U128_MAX = (1n << 128n) - 1n;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const counter = value => Number.isSafeInteger(value) && value >= 0;

// Project the existing finalized account RPC. These are gateway observations,
// not independently verified state proofs. Null is not a zero-balance account.
export function canaryAccountObservation(result, address) {
 if (result === null) return {kind:'not_observed',address};
 if (!result || typeof result !== 'object' || Array.isArray(result) ||
     result.address !== address || typeof result.balance_nwei !== 'string' ||
     !/^(0|[1-9][0-9]{0,38})$/.test(result.balance_nwei) ||
     BigInt(result.balance_nwei) > U128_MAX || !counter(result.nonce) ||
     !counter(result.finalized_height) || !hash(result.finalized_block_hash) ||
     !hash(result.state_root)) throw new Error('Finalized account observation is unavailable or malformed');
 return {kind:'reported',address,balanceNwei:result.balance_nwei,nonce:result.nonce,
  finalizedHeight:result.finalized_height,finalizedBlockHash:result.finalized_block_hash,stateRoot:result.state_root};
}
