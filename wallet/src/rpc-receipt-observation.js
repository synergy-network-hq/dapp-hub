import {rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {atlasAccountKey} from './atlas-account.js';
import {blockHeight, comparableTransactionHash} from './transaction-observation.js';
import {isProtectedWalletAddress} from './wallet-address.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {projectReceiptFeeBreakdown} from './receipt-fee-breakdown.js';

function participant(value) {
  if (value === null) return null;
  // Atlas can represent checksum-validated Wallet addresses as lowercase keys.
  if (typeof value === 'string' && value.length === 44 && /^synw[a-f0-9]{40}$/.test(value)) return value;
  return atlasAccountKey(value) ?? undefined;
}

export function rpcReceiptSelection(row, account) {
  const hash = comparableTransactionHash(row.hash);
  const indexedHeight = blockHeight(row.block_number);
  const from = participant(row.sender_address);
  const to = participant(row.receiver_address);
  const accountKey = atlasAccountKey(account);
  if (!hash?.kind || !row.hash.startsWith(`${hash.kind}-`) || indexedHeight === null || !from || to === undefined || !accountKey ||
      (from !== accountKey && to !== accountKey)) return null;
  return {hash: row.hash, indexedHeight, from, to};
}

export function rpcReceiptHashSelection(value, account) {
  const hash = comparableTransactionHash(value);
  if (!hash?.kind || !value.startsWith(`${hash.kind}-`) || !isProtectedWalletAddress(account)) return null;
  return {hash: `${hash.kind}-${hash.digest}`, accountKey: atlasAccountKey(account)};
}

const isHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value);

// Testnet-v3 a6a434f2 execution.rs writes both fixed codes and raw
// execution diagnostics to the same receipt field. Display fixed labels only.
const receiptFailures = new Map([
  ['INSUFFICIENT_FUNDS', {reason: 'Insufficient funds for the transaction or network fee.', feeMayBeEstimate: true}],
  ['NETWORK_BURN_ADDRESS_CANNOT_SEND', {reason: 'The network burn address cannot send transactions.', feeMayBeEstimate: true}],
  ['SYNQ_AIVM_EXECUTION_FAILED', {reason: 'SynQ contract execution failed.'}],
  ['NON_NATIVE_BURN_REQUIRES_TOKEN_MODULE', {reason: 'This asset must be burned through its token module.'}],
  ['BURN_AMOUNT_MUST_BE_GREATER_THAN_ZERO', {reason: 'The burn amount must be greater than zero.'}],
]);

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

export function sameReceiptChainContext(left, right) {
  return left.chainId === right.chainId && left.network === right.network &&
    left.incarnation === right.incarnation && left.genesis === right.genesis;
}

export function reconcileRpcReceipt(previous, receipt, chain, checkedAt) {
  // A miss in the owner's bounded receipt cache leaves the last anchor historical.
  const comparable = previous && sameReceiptChainContext(previous.chain, chain) ? previous : null;
  if (receipt === null) return {anchor: comparable, prior: comparable};

  const {height, blockHash, index, status} = receipt;
  const anchor = {chain, height, blockHash, index, status, checkedAt};
  const conflict = comparable && (comparable.height !== height || comparable.blockHash.toLowerCase() !== blockHash.toLowerCase() ||
    comparable.status !== status || (comparable.index !== null && index !== null && comparable.index !== index));
  return {anchor, prior: conflict ? comparable : null};
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
  const height = blockHeight(value.blockNumber);
  if (height === null || !isHash(value.blockHash)) {
    throw Error('The selected RPC receipt did not provide a supported block height or hash.');
  }
  const from = participant(value.from);
  const to = participant(value.to);
  if (selection.accountKey) {
    if (!from || to === undefined || (from !== selection.accountKey && to !== selection.accountKey)) {
      throw Error('The selected RPC receipt did not establish participation by the connected Wallet account.');
    }
  } else if (from !== selection.from || to !== selection.to) {
    throw Error('The RPC receipt did not match the selected transaction participants.');
  }
  if (value.status !== '0x0' && value.status !== '0x1') throw Error('The RPC returned an unsupported receipt status.');
  const index = value.transactionIndex == null ? null : blockHeight(value.transactionIndex);
  if (value.transactionIndex != null && index === null) throw Error('The selected RPC returned an unsupported receipt transaction index.');

  const failure = value.status === '0x0' ? receiptFailures.get(value.executionError) : undefined;
  return {status: value.status, blockHash: value.blockHash, height, index,
    failureReason: failure?.reason ?? null, feeMayBeEstimate: failure?.feeMayBeEstimate === true,
    gasUsed: exactRpcAmount(value.gasUsed, maxU64), feeNwei: exactRpcAmount(value.feeCharged, maxU128),
    feeBreakdown: projectReceiptFeeBreakdown(value)?.feeBreakdown ?? null,
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
