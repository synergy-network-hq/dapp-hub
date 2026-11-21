// Atlas validator detail requests the latest 12 rows from validator_reward_settlements.
const maxRows = 12;
const amount = value => typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value);
const epoch = value => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const status = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(value);

export function validatorRewardRows(value, address) {
 if (!Array.isArray(value) || value.length > maxRows) return null;
 const projected = [];
 let previousEpoch = null;
 for (const row of value) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.validator_address !== address
   || !epoch(row.original_epoch_id) || !epoch(row.accountability_epoch) || !epoch(row.unlock_epoch)
   || (previousEpoch !== null && BigInt(row.original_epoch_id) >= previousEpoch)
   || !amount(row.pending_reward_nwei) || !amount(row.released_reward_nwei)
   || !amount(row.treasury_recovery_nwei) || !amount(row.penalty_nwei) || !status(row.status)
   || (row.reward_payout_address !== null && !token(row.reward_payout_address))
   || (row.settlement_tx_hash !== null && !token(row.settlement_tx_hash))) return null;
  previousEpoch = BigInt(row.original_epoch_id);
  projected.push({
   originalEpoch: row.original_epoch_id,
   accountabilityEpoch: row.accountability_epoch,
   unlockEpoch: row.unlock_epoch,
   pendingNwei: row.pending_reward_nwei,
   releasedNwei: row.released_reward_nwei,
   treasuryRecoveryNwei: row.treasury_recovery_nwei,
   penaltyNwei: row.penalty_nwei,
   reportedStatus: row.status,
   payoutAddress: row.reward_payout_address,
   settlementTxHash: row.settlement_tx_hash,
  });
 }
 return projected;
}
