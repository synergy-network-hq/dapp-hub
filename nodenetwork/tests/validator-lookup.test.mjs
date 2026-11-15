import assert from 'node:assert/strict';
import test from 'node:test';
import {validatorLookupAddress, validatorLookupObservation, validatorLookupPath} from '../src/validator-lookup.js';

const validatorAddress = 'synv' + 'a'.repeat(34);
const response = {
 validator: {address: validatorAddress, name: 'Synthetic validator'},
 profileEvidence: {validator: true},
 setupStatus: 'active_consensus',
 walletBalanceNwei: 'fixture payload excluded',
 recentTransactions: ['fixture payload excluded'],
};

test('only the Atlas owner validator-address shape becomes a fixed public detail route', () => {
 assert.equal(validatorLookupAddress(` ${validatorAddress.toUpperCase()} `), validatorAddress);
 assert.equal(validatorLookupPath(validatorAddress), `validators/${validatorAddress}`);
 for (const value of ['synv', validatorAddress + '/profile', validatorAddress + '?x=1', 'synw' + 'a'.repeat(34), '..', 'synv' + 'a'.repeat(93)]) {
  assert.throws(() => validatorLookupPath(value), /SYNV/);
 }
});

test('lookup returns matching public detail and ignores unrelated account payload', () => {
 const observation = validatorLookupObservation(response, validatorAddress, 1000);
 assert.deepEqual(observation, {
  address: validatorAddress,
  name: 'Synthetic validator',
  hasProfile: true,
  status: 'Reported active consensus',
  receivedAt: 1000,
  indexedBlocks: null,
  indexedRewards: null,
 });
 assert.throws(() => validatorLookupObservation({...response, validator: {...response.validator, address: 'synv' + 'b'.repeat(34)}}, validatorAddress), /mismatched/);
 assert.throws(() => validatorLookupObservation({...response, setupStatus: 'unknown'}, validatorAddress), /unsupported/);
});

test('Atlas account fallback never becomes validator profile evidence', () => {
 const accountOnly = {...response, profileEvidence: {validator: false}, setupStatus: 'setup_pending'};
 assert.equal(validatorLookupObservation(accountOnly, validatorAddress).hasProfile, false);
 assert.match(validatorLookupObservation(accountOnly, validatorAddress).status, /without a validator profile/);
 assert.throws(() => validatorLookupObservation({...accountOnly, profileEvidence: {}}, validatorAddress), /unsupported/);
});
