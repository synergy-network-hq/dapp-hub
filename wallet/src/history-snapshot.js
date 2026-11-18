import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {blockHeight, blockLookupHeight} from './transaction-observation.js';
import {checkConfiguredReceiptGenesis, rpcReceiptBlockReportsFinality, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {requireWalletReadScope} from './wallet-account-read.js';

const blockHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value)
  ? value.toLowerCase() : null;

export function indexedHistorySnapshot(value) {
  const height = blockHeight(value?.blockNumber);
  const hash = blockHash(value?.blockHash);
  if (height === null || BigInt(height) > 9223372036854775807n || hash === null) return null;
  return {height, hash};
}

export async function checkIndexedHistorySnapshot(readAtlas, snapshot, signal) {
  signal.throwIfAborted();
  let value;
  try {
    value = await readAtlas(`blocks/${snapshot.height}`, {signal});
  } catch {
    throw Error('The Atlas snapshot block could not be checked. Try again.');
  }
  signal.throwIfAborted();
  const hash = blockHash(value?.hash);
  if (blockHeight(value?.number) !== snapshot.height || hash === null) {
    throw Error('Atlas did not return the requested snapshot block identity.');
  }
  return {changed: hash !== snapshot.hash, hash, checkedAt: new Date().toISOString()};
}

export async function checkRpcHistorySnapshot(readRpc, endpoint, snapshot, signal, canRead) {
  const height = blockLookupHeight(snapshot.height);
  if (height === null) throw Error('The indexed snapshot height cannot be sent as an exact RPC integer.');
  const request = async (method, params, options) => {
    requireWalletReadScope(signal, canRead);
    const value = await readRpc(method, params, options);
    requireWalletReadScope(signal, canRead);
    return value;
  };

  let readiness;
  try {
    readiness = await readProtocolObservation(request, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
  } catch {
    requireWalletReadScope(signal, canRead);
    throw Error('The selected RPC history snapshot chain context could not be checked. Try again.');
  }
  checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);

  let value;
  try {
    value = await request('synergy_getBlockByNumber', [height], {endpoint: endpoint.rpc, signal});
  } catch {
    requireWalletReadScope(signal, canRead);
    throw Error('The selected RPC history snapshot block could not be checked. Try again.');
  }
  const hash = blockHash(value?.hash);
  let canonical = false;
  if (hash && blockHeight(value.block_index) === snapshot.height) {
    try {
      canonical = rpcReceiptBlockReportsFinality(value, {chain: readiness.chain, height: snapshot.height, blockHash: hash});
    } catch {
      // A contradictory block projection cannot corroborate or invalidate the Atlas snapshot.
    }
  }
  if (!canonical) {
    throw Error('The selected RPC did not return a supported canonical block for this snapshot height.');
  }
  return {changed: hash !== snapshot.hash, hash, checkedAt: new Date().toISOString()};
}
