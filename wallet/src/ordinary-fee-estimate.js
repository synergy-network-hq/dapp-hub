import {rpcOrdinaryFeeEstimateObservation} from '@synergy-network/portal-native/dapp-sdk';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {STS_TESTNET_GENESIS} from './wallet-address.js';

export function requirePinnedFeeEstimateReadiness(readiness) {
  if (!readiness.reportedReady || readiness.chain.incarnation !== '5' ||
      readiness.chain.genesis.toLowerCase() !== STS_TESTNET_GENESIS) {
    throw Error('The fee estimate requires the supported Testnet v3 Genesis and incarnation.');
  }
}

export function matchesReadinessContext(context, readiness) {
  const {chainId, incarnation, genesis} = readiness.chain;
  return context?.chainId === chainId && String(context.incarnation) === incarnation && context.genesis === genesis.toLowerCase();
}

export async function readOrdinaryFeeEstimate(options, amountNwei, readiness, checkScope) {
  checkScope();
  let evidence;
  try {
    evidence = await rpcOrdinaryFeeEstimateObservation({...options, amountNwei});
  } catch {
    checkScope();
    throw Error('The selected RPC could not provide a supported ordinary SNRG fee estimate.');
  }
  checkScope();
  if (evidence?.state === 'unavailable') return {state: 'unavailable'};
  const {value, chainContext} = evidence ?? {};
  if (evidence?.state !== 'estimated' || !matchesReadinessContext(chainContext, readiness) ||
      value?.amountNwei !== amountNwei) throw Error('The fee estimate does not match this draft and selected RPC identity.');
  const gas = exactRpcAmount(value.gas, maxU64), gasPrice = exactRpcAmount(value.gasPriceNwei, maxU64);
  const gasFee = exactRpcAmount(value.gasFeeNwei, maxU128), amountFee = exactRpcAmount(value.amountProtocolFeeNwei, maxU128);
  const total = exactRpcAmount(value.totalFeeNwei, maxU128);
  if ([gas, gasPrice, gasFee, amountFee, total].includes(null) || gas === '0' || gasPrice === '0' ||
      BigInt(gas) * BigInt(gasPrice) !== BigInt(gasFee) || BigInt(gasFee) + BigInt(amountFee) !== BigInt(total)) {
    throw Error('The selected RPC returned unsupported fee quantities.');
  }
  return {state: 'estimated', gas, gasPrice, gasFee, amountFee, total, receivedAt: Date.now()};
}
