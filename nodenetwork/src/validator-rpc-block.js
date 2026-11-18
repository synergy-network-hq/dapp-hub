import {readProtocolObservation, rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {confirmReportedGenesis, genesisDigest} from './genesis-pin.js';
import {validatorLookupAddress} from './validator-lookup.js';

const hash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/i.test(value)
 ? value.toLowerCase() : null;

export function queryableValidatorBlock(row) {
 if (typeof row?.number !== 'string') return false;
 const number = Number(row.number);
 return Boolean(hash(row.hash) && Number.isSafeInteger(number) && number >= 0 && String(number) === row.number);
}

const matchesUnsigned = (value, expected) => value === expected || (Number.isSafeInteger(value) && String(value) === expected);

// The pinned chain-1266 authority-signature release exposes these fields on its exact-height records.
export function validatorRpcBlockObservation(value, row, address, expected, receivedAt = Date.now()) {
 if (value === null) throw Error('The selected RPC returned no block at the indexed height.');
 if (value?.transaction_format !== 'synergy_native_v3' || value.release_id !== 'synergy-testnet-v3-chain-1266'
  || value.finalized !== true || value.finality_status !== 'finalized' || value.finality_proof_type !== 'authority_signature'
  || value.source !== 'canonical_finality_store' || value.finality_source !== 'canonical_finality_store') {
  throw Error('The selected RPC returned no supported finalized block attribution.');
 }

 const chain = value.chain;
 if (chain?.chain_id !== expected.chainId || value.chain_id !== expected.chainId || chain.network_id !== expected.network
  || genesisDigest(chain.genesis_hash) !== expected.genesis || !matchesUnsigned(chain.chain_incarnation, expected.incarnation)
  || !matchesUnsigned(value.chain_incarnation, expected.incarnation)) {
  throw Error('The selected RPC block reports a different chain context from the readiness response.');
 }

 const digest = hash(row.hash);
 if (!digest || hash(value.block_id) !== digest || hash(value.hash) !== digest
  || !matchesUnsigned(value.height, row.number) || !matchesUnsigned(value.block_index, row.number)) {
  throw Error('The selected RPC block height or hash differs from the indexed block.');
 }
 if (value.validator_id !== address || value.validator !== address || value.authority_address !== address) {
  throw Error('The selected RPC block reports a different validator from the Atlas attribution.');
 }

 return {address, height:row.number, hash:digest, incarnation:expected.incarnation, receivedAt};
}

export async function readValidatorRpcBlock(request, profile, address, row, signal, canRead = () => true) {
 if (Number(profile.chainId) !== 1266) throw Error('Indexed block attribution requires Synergy Testnet chain 1266.');
 const expectedAddress = validatorLookupAddress(address);
 if (!queryableValidatorBlock(row)) throw Error('The indexed block does not have a supported height and hash for the RPC check.');
 const pin = genesisDigest(profile.genesisHash);
 if (profile.genesisHash != null && !pin) throw Error('The configured validator Genesis pin is invalid.');
 function requireReadAccess() {
  signal?.throwIfAborted();
  if (!canRead()) throw Error('NodeNetwork read access is unavailable for the selected RPC block.');
 }
 const guardedRequest = (method, params, options) => {
  requireReadAccess();
  return request(method, params, options);
 };
 const {chain} = await readProtocolObservation(guardedRequest, 'synergy_getReadiness', profile, signal, rpcReadinessObservation);
 const genesis = genesisDigest(chain.genesis);
 if (chain.network !== 'synergy-testnet-v3' || !genesis || chain.incarnation.trim() !== chain.incarnation) {
  throw Error('The selected RPC did not provide a supported Testnet v3 identity.');
 }
 if (pin) confirmReportedGenesis(genesis, pin);
 requireReadAccess();
 let value;
 try {value = await request('synergy_getBlockByNumber', [Number(row.number)], {endpoint:profile.rpc, signal});}
 catch {
  signal?.throwIfAborted();
  throw Error('The selected RPC could not provide the requested block.');
 }
 requireReadAccess();
 return validatorRpcBlockObservation(value, row, expectedAddress, {...chain, genesis});
}
