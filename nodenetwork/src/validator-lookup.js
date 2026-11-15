import {validatorBlockRows} from './validator-blocks.js';

const setupLabels = new Map([
 ['active_consensus', 'Reported active consensus'],
 ['staked_not_active', 'Reported staked and inactive'],
 ['setup_pending', 'Reported setup pending'],
]);

export function validatorLookupAddress(value) {
 if (typeof value !== 'string' || value.length > 128) throw Error('Enter a Synergy validator address.');
 const address = value.trim().toLowerCase();
 if (!/^synv[a-z0-9]{34,92}$/.test(address)) throw Error('Enter a SYNV validator address with 38–96 letters and digits.');
 return address;
}

export function validatorLookupPath(address) {
 return `validators/${validatorLookupAddress(address)}`;
}

export function validatorLookupObservation(value, address, receivedAt = Date.now()) {
 const expected = validatorLookupAddress(address);
 const reported = value?.validator;
 if (!reported || typeof reported.address !== 'string' || reported.address.trim().toLowerCase() !== expected) {
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
 };
}
