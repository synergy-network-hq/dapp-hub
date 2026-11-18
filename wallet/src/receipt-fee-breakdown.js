import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';

export const receiptFeeComponents = Object.freeze([
  'gasFeeNwei', 'amountProtocolFeeNwei', 'storageFeeNwei', 'priorityFeeNwei',
]);

// The confirmed receipt includes both the complete breakdown and its own total.
export function projectReceiptFeeBreakdown(value) {
  const breakdown = value.feeBreakdown;
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return null;
  const gasUsed = exactRpcAmount(value.gasUsed, maxU64);
  const effectiveGasPrice = exactRpcAmount(value.effectiveGasPrice, maxU64);
  const totalNetworkFeeNwei = exactRpcAmount(breakdown.totalNetworkFeeNwei, maxU128);
  if (gasUsed === null || effectiveGasPrice === null || totalNetworkFeeNwei === null ||
      exactRpcAmount(breakdown.gasUsed, maxU64) !== gasUsed ||
      exactRpcAmount(breakdown.baseFeePerGasNwei, maxU64) !== effectiveGasPrice ||
      exactRpcAmount(value.feeCharged, maxU128) !== totalNetworkFeeNwei) return null;

  const projection = {gasUsed, baseFeePerGasNwei: effectiveGasPrice, totalNetworkFeeNwei};
  let total = 0n;
  for (const field of receiptFeeComponents) {
    const amount = exactRpcAmount(breakdown[field], maxU128);
    if (amount === null) return null;
    total += BigInt(amount);
    projection[field] = amount;
  }
  if (BigInt(gasUsed) * BigInt(effectiveGasPrice) !== BigInt(projection.gasFeeNwei) ||
      total !== BigInt(totalNetworkFeeNwei)) return null;
  return {effectiveGasPrice, feeBreakdown: projection};
}
