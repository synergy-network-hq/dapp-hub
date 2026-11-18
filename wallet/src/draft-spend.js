import {rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {rpcFinalizedHeadObservation} from '@synergy-network/portal-native/dapp-sdk';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {matchesReadinessContext} from './ordinary-fee-estimate.js';

export function draftSpendReadiness(value, expectedChain) {
  const readiness = rpcReceiptReadiness(value, expectedChain);
  const hash = value.health.latest_hash;
  if (!readiness.reportedReady || readiness.height === null ||
      typeof hash !== 'string' || hash.length !== 64 || /[^a-f0-9]/i.test(hash)) {
    throw Error('The selected RPC did not report a healthy, identified block tip for the amount and fee check.');
  }
  return {...readiness, tipHash: hash.toLowerCase()};
}

export function checkDraftSpendWindow(before, after) {
  if (before.height !== after.height || before.tipHash !== after.tipHash ||
      before.chain.chainId !== after.chain.chainId || before.chain.network !== after.chain.network ||
      before.chain.incarnation !== after.chain.incarnation ||
      before.chain.genesis.toLowerCase() !== after.chain.genesis.toLowerCase()) {
    throw Error('The selected RPC chain or block tip changed during the check. Check the draft again.');
  }
}

// Chain-1266 a6a434f2: calculate_network_fee adds nonnegative gas, amount,
// storage and priority components. Execution adds that fee to the principal.
export function draftSpendLowerBound(amountNwei, protocolFeeNwei, balanceNwei) {
  const {total, shortfall} = draftDebit(amountNwei, protocolFeeNwei, balanceNwei);
  return {minimum: total, shortfall};
}

export function draftDebit(amountNwei, feeNwei, balanceNwei) {
  const total = BigInt(amountNwei) + BigInt(feeNwei);
  if (total > maxU128) throw Error('The draft amount and fee exceed the supported SNRG range.');
  const shortfall = total - BigInt(balanceNwei);
  return {total: total.toString(), shortfall: shortfall > 0n ? shortfall.toString() : null};
}

export async function readDraftFinalizedHead(options, readiness, checkScope) {
  checkScope();
  let evidence;
  try {
    evidence = await rpcFinalizedHeadObservation(options);
  } catch {
    checkScope();
    throw Error('The selected RPC could not provide a reported finalized head.');
  }
  checkScope();
  const height = exactRpcAmount(evidence?.value?.height, maxU64), hash = evidence?.value?.hash;
  if (!matchesReadinessContext(evidence?.chainContext, readiness) || height === null || height === '0' ||
      typeof hash !== 'string' || hash.length !== 64 || !/^[0-9a-f]{64}$/.test(hash)) {
    throw Error('The reported finalized head does not match the selected RPC identity.');
  }
  return {height, hash};
}
