import {validatorIdentityText, sameValidatorIdentity} from './node-identity-text.js';
import {validatorBlockRows} from './validator-blocks.js';
import {validatorRewardRows} from './validator-rewards.js';

const setupLabels = new Map([
 ['active_consensus', 'Reported active consensus'],
 ['staked_not_active', 'Reported staked and inactive'],
 ['setup_pending', 'Reported setup pending'],
]);

export function validatorLookupAddress(value) {
 return validatorIdentityText(value);
}

export function validatorLookupPath(address) {
 return `validators/${validatorLookupAddress(address)}`;
}

export function validatorLookupObservation(value, address, receivedAt = Date.now()) {
 const expected = validatorLookupAddress(address);
 const reported = value?.validator;
 if (!reported || typeof reported.address !== 'string' || !sameValidatorIdentity(reported.address, expected)) {
  throw Error('Atlas returned an unavailable or mismatched validator record.');
 }
 const hasProfile = value.profileEvidence?.validator;
 const status = setupLabels.get(value.setupStatus);
 if (typeof hasProfile !== 'boolean' || !status) throw Error('Atlas validator details use an unsupported response.');
 const name = reported.name;
 return {
  address: expected,
  name: typeof name === 'string' && name.length <= 160 && name.trim() && !/[\u0000-\u001f\u007f]/.test(name) ? name : null,
  hasProfile,
  status: hasProfile ? status : 'Atlas returned account evidence without a validator profile',
  receivedAt,
  indexedBlocks: validatorBlockRows(value.recentProducedBlocks, expected),
  indexedRewards: validatorRewardRows(value.rewardSettlements, expected),
 };
}
