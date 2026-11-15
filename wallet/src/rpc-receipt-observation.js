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

export function checkConfiguredReceiptGenesis(chain, configuredGenesis) {
  if (configuredGenesis == null) return;
  if (!isHash(configuredGenesis) || chain.genesis.toLowerCase() !== configuredGenesis.toLowerCase()) {
    throw Error('The selected RPC reported a different genesis hash from the configured endpoint.');
  }
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
    chain: expectedChain, tip: readiness.chainStateAvailable ? readiness.height : null};
}

// The chain-1266 single-authority release projects exact-height records through entry_to_explorer_json.
export function rpcReceiptBlockReportsFinality(value, receipt) {
  if (value?.transaction_format !== 'synergy_native_v3') return false;

  const chain = value.chain;
  const expected = receipt.chain;
  if (chain?.chain_id !== expected.chainId || value.chain_id !== expected.chainId || chain.network_id !== expected.network ||
      !isHash(chain.genesis_hash) || chain.genesis_hash.toLowerCase() !== expected.genesis.toLowerCase() ||
      blockHeight(chain.chain_incarnation) !== expected.incarnation || blockHeight(value.chain_incarnation) !== expected.incarnation) {
    throw Error('The receipt block and selected RPC readiness report different or unsupported chain identities.');
  }
  if (blockHeight(value.height) !== receipt.height || !isHash(value.block_id) ||
      value.block_id.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw Error('The selected RPC returned conflicting receipt block identifiers.');
  }

  return value.release_id === 'synergy-testnet-v3-chain-1266' && value.finalized === true &&
    value.finality_status === 'finalized' && value.finality_proof_type === 'authority_signature' &&
    value.source === 'canonical_finality_store' && value.finality_source === 'canonical_finality_store';
}
