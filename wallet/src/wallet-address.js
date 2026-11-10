// Extracted from synergy-wallet@50d9981d588043f7db3a16dc7b5c8ca3e7db80cc
// packages/wallet-core/src/address.js; canonical checksum/active-prefix validation only.
import {bech32m} from 'bech32';
const TARGET_ADDRESS_LEN = 41;
const CHECKSUM_LEN = 6;
const SEPARATOR_LEN = 1;
const FNDSA1024_PUBLIC_KEY_BYTES = 1793;

export const SYNERGY_ADDRESS_ENGINE_VERSION = 'synergy-address-engine-v1';
export const SYNERGY_ADDRESS_REGISTRY_VERSION = 'SNTS-01-v1.3';
export const SYNERGY_BURN_ADDRESS = 'syn0000000000000000000000000000000';
export const SYNERGY_TYPED_HASH_HEX_LENGTHS = Object.freeze({
  syntxn: 64,
  synxxn: 64,
  synixn: 64,
  synblk: 64,
  synmkl: 64,
  synepoch: 128,
  synqc: 64,
});

const KEY_CONTROLLED_PREFIXES = new Set([
  'synw', 'syns', 'syna', 'synz',
  'synv1', 'synv2', 'synv3', 'synv4', 'synv5',
  'syno', 'syny', 'synm', 'synu', 'synl',
]);

const OBJECT_ADDRESS_PREFIXES = new Set([
  'synb1', 'synb2', 'synb3',
  'synn1', 'synn2',
  'synj', 'synk', 'synq', 'sync',
  'syngrp1', 'syngrp2', 'syngrp3', 'syngrp4', 'syngrp5',
  'synf',
]);

const ACTIVE_ADDRESS_PREFIXES = new Set([
  ...KEY_CONTROLLED_PREFIXES,
  ...OBJECT_ADDRESS_PREFIXES,
]);

export function isValidSynergyAddress(address) {
  if (typeof address !== 'string' || address !== address.toLowerCase()) {
    return false;
  }
  if (address === SYNERGY_BURN_ADDRESS) return true;
  if (address.length !== TARGET_ADDRESS_LEN) return false;
  try {
    const { prefix, words } = bech32m.decode(address);
    const expectedWordCount = TARGET_ADDRESS_LEN - prefix.length - SEPARATOR_LEN - CHECKSUM_LEN;
    return ACTIVE_ADDRESS_PREFIXES.has(prefix) && words.length === expectedWordCount;
  } catch {
    return false;
  }
}

