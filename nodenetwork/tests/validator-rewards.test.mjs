import assert from 'node:assert/strict';
import test from 'node:test';
import {validatorLookupObservation} from '../src/validator-lookup.js';
import {validatorRewardRows} from '../src/validator-rewards.js';

const address = 'synv' + 'a'.repeat(34);
const other = 'synv' + 'b'.repeat(34);
const payout = 'synw' + 'c'.repeat(34);
const row = {
 validator_address: address,
 original_epoch_id: '9007199254740993', accountability_epoch: '9007199254740994', unlock_epoch: '9007199254740995',
 pending_reward_nwei: '1000000000000000001', released_reward_nwei: '5000000000', treasury_recovery_nwei: '2', penalty_nwei: '0',
 status: 'complete', reward_payout_address: payout, settlement_tx_hash: 'a'.repeat(64),
 ledger_ref: 'unreviewed ledger field', reason_codes: ['unreviewed reason'],
};

test('extracts the exact address-bound records with an allowlisted shape', () => {
 const report = validatorLookupObservation({
  validator: {address}, profileEvidence: {validator:true}, setupStatus:'active_consensus',
  rewardSettlements:[row, {...row, original_epoch_id:'9007199254740992', reward_payout_address:null, settlement_tx_hash:null}],
 }, address, 1000);
 assert.deepEqual(report.indexedRewards[0], {
  originalEpoch: '9007199254740993', accountabilityEpoch: '9007199254740994', unlockEpoch: '9007199254740995',
  pendingNwei: '1000000000000000001', releasedNwei: '5000000000', treasuryRecoveryNwei: '2', penaltyNwei: '0',
  reportedStatus:'complete', payoutAddress:payout, settlementTxHash:'a'.repeat(64),
 });
 assert.equal(report.indexedRewards[1].payoutAddress, null);
 assert.equal(report.indexedRewards[1].settlementTxHash, null);
 assert.ok(!JSON.stringify(report).includes('unreviewed'));
});

test('keeps an empty response distinct from absent, malformed or off-address evidence', () => {
 assert.deepEqual(validatorRewardRows([], address), []);
 for (const rows of [undefined, {}, Array(13).fill(row), [{...row, validator_address:other}],
  [{...row, released_reward_nwei:0}], [{...row, penalty_nwei:'-1'}], [{...row, pending_reward_nwei:'9'.repeat(79)}],
  [{...row, unlock_epoch:'9223372036854775808'}], [{...row, status:'hidden\nstring'}],
  [{...row, reward_payout_address:'unsafe / ref'}], [{...row, settlement_tx_hash:undefined}],
 ]) assert.equal(validatorRewardRows(rows, address), null);
 for (const field of ['pending_reward_nwei', 'original_epoch_id', 'reward_payout_address', 'status']) {
  for (const suffix of ['\n', '\r\n', '\u2028', '\u2029', '\u0000']) {
   assert.equal(validatorRewardRows([{...row, [field]:row[field] + suffix}], address), null, `${field} rejects ${JSON.stringify(suffix)}`);
  }
 }
});

test('refuses duplicate or out-of-order epochs without dropping individual rows', () => {
 assert.equal(validatorRewardRows([row, row], address), null);
 assert.equal(validatorRewardRows([{...row, original_epoch_id:'3'}, row], address), null);
 assert.equal(validatorRewardRows([row, {...row, original_epoch_id:'3'}], address).length, 2);
});
