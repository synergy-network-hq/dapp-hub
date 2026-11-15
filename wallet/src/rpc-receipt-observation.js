import {rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {atlasAccountKey} from './atlas-account.js';
import {blockHeight, comparableTransactionHash} from './transaction-observation.js';

function participant(value) {
  if (value === null) return null;
  // Atlas can represent checksum-validated Wallet addresses as lowercase keys.
  if (typeof value === 'string' && value.length === 44 && /^synw[a-f0-9]{40}$/.test(value)) return value;
  return atlasAccountKey(value) ?? undefined;
}

export function rpcReceiptSelection(row, account) {
  const hash = comparableTransactionHash(row.hash);
  const height = blockHeight(row.block_number);
  const from = participant(row.sender_address);
  const to = participant(row.receiver_address);
  const accountKey = atlasAccountKey(account);
  if (!hash?.kind || !row.hash.startsWith(`${hash.kind}-`) || height === null || !from || to === undefined || !accountKey ||
      (from !== accountKey && to !== accountKey)) return null;
  return {hash: row.hash, height, from, to};
}

const isHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value);

export function rpcReceiptReadiness(value, expected) {
  const readiness = rpcReadinessObservation(value, expected);
  if (readiness.chain.network !== 'synergy-testnet-v3' || !isHash(readiness.chain.genesis)) {
    throw Error('The selected RPC did not provide a supported Testnet v3 chain identity.');
  }
  return readiness;
}

export function rpcReceiptObservation(value, selection, readiness) {
  if (value === null) return null;

  const expectedHash = comparableTransactionHash(selection.hash);
  const observedHash = comparableTransactionHash(value?.transactionHash);
  if (observedHash?.kind !== expectedHash.kind || observedHash?.digest !== expectedHash.digest) {
    throw Error('The selected RPC returned a different transaction hash.');
  }
  const chain = value.chain;
  const expectedChain = readiness.chain;
  if (chain?.chain_id !== expectedChain.chainId || chain.network_id !== expectedChain.network ||
      chain.genesis_hash !== expectedChain.genesis || blockHeight(chain.chain_incarnation) !== expectedChain.incarnation) {
    throw Error('The RPC receipt and readiness observation report different or unsupported chain identities.');
  }
  if (blockHeight(value.blockNumber) !== selection.height || !isHash(value.blockHash)) {
    throw Error('The RPC receipt did not match the selected indexed block height or provide a supported block hash.');
  }
  if (participant(value.from) !== selection.from || participant(value.to) !== selection.to) {
    throw Error('The RPC receipt did not match the selected transaction participants.');
  }
  if (value.status !== '0x0' && value.status !== '0x1') throw Error('The RPC returned an unsupported receipt status.');

  return {status: value.status, blockHash: value.blockHash, height: selection.height,
    tip: readiness.chainStateAvailable ? readiness.height : null};
}
