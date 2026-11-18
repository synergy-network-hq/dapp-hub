import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';

// Chain-1266 release a6a434f2, RPC fee_schedule_json and gas::calculate_network_fee.
export function draftFeeSchedule(response, readiness, draftNwei) {
  const {value, chainContext} = response;
  const chain = readiness.chain;
  if (chainContext?.chainId !== chain.chainId || String(chainContext.incarnation) !== chain.incarnation ||
      chainContext.genesis !== chain.genesis.toLowerCase()) throw Error('The fee schedule response does not match the selected RPC readiness identity.');

  const gasPrice = exactRpcAmount(value?.gasPrice, maxU64);
  const minGasPrice = exactRpcAmount(value?.minGasPrice, maxU64);
  const maxGasPrice = exactRpcAmount(value?.maxGasPrice, maxU64);
  const defaultGasPrice = exactRpcAmount(value?.defaultGasPrice, maxU64);
  const blockGasLimit = exactRpcAmount(value?.blockGasLimit, maxU64);
  const rule = value?.nativeSnrgSend;
  const bps = rule?.amountFeeBps;
  const minAmountFee = exactRpcAmount(rule?.minAmountFeeNwei, maxU128);
  const maxAmountFee = exactRpcAmount(rule?.maxAmountFeeNwei, maxU128);
  const amount = exactRpcAmount(draftNwei, maxU64);
  if ([gasPrice, minGasPrice, maxGasPrice, defaultGasPrice, blockGasLimit, minAmountFee, maxAmountFee, amount].includes(null) ||
      minGasPrice === '0' || blockGasLimit === '0' || amount === '0' || BigInt(minAmountFee) > BigInt(maxAmountFee) ||
      ![gasPrice, defaultGasPrice].every(price => BigInt(price) >= BigInt(minGasPrice) && BigInt(price) <= BigInt(maxGasPrice)) ||
      !Number.isInteger(bps) || bps < 0 || bps > 10_000 || rule.valuationRequired !== false || rule.storageFeeEnabled !== false) {
    throw Error('The selected RPC returned an unsupported ordinary SNRG fee schedule.');
  }

  const raw = BigInt(amount) * BigInt(bps) / 10_000n;
  const floor = BigInt(minAmountFee);
  const cap = BigInt(maxAmountFee);
  const bounded = raw < floor ? floor : raw > cap ? cap : raw;
  return {amountComponent: bounded.toString(), bps, minAmountFee, maxAmountFee,
    gasPrice, defaultGasPrice, minGasPrice, maxGasPrice, blockGasLimit, receivedAt: Date.now()};
}
