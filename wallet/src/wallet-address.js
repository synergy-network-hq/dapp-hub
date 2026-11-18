import {parseProtectedWalletAddress} from './public-address/protected-address.js';
import {bech32m} from 'bech32';

const BECH32M_ADDRESS_LENGTH = 41;
const BECH32M_SEPARATOR_AND_CHECKSUM_LENGTH = 7;
const PROTECTED_ADDRESS_LENGTH = 44;
const BURN_ADDRESS = 'syn0000000000000000000000000000000';
// Canonical chain-1266 STS Genesis from the Wallet inspector at 134cfa2.
export const STS_TESTNET_GENESIS = '2272fe2b48c6e2019b27223f61ba8d8a82b58656fe9daab50c81f224a301ca74';

// Current address namespaces from the Wallet owner at e7af1fce62c396a95e989cec33edc333eb405a05.
const activeBech32mPrefixes = new Set([
  'syns', 'syna', 'synz', 'synv1', 'synv2', 'synv3', 'synv4', 'synv5', 'syno', 'syny',
  'synb1', 'synb2', 'synb3', 'synn1', 'synn2', 'synj', 'synk', 'synq', 'sync', 'synf',
  'syngrp1', 'syngrp2', 'syngrp3', 'syngrp4', 'syngrp5',
]);
// These exact namespaces were accepted by the old local contact store at 50d9981d588043f7db3a16dc7b5c8ca3e7db80cc.
const savedOnlyPrefixes = new Set(['synw', 'synm', 'synu', 'synl']);

// Testnet a6a434f2 SynID records use the legacy runtime's address domain.
export function isReportedSynIdAddress(address) {
  if (address === BURN_ADDRESS) return true;
  if (typeof address !== 'string' || address.length !== BECH32M_ADDRESS_LENGTH ||
      !address.startsWith('syn') || address !== address.toLowerCase()) return false;
  try {
    bech32m.decode(address);
    return true;
  } catch {
    return false;
  }
}

export function isProtectedWalletAddress(address) {
  try { parseProtectedWalletAddress(address); return true; } catch { return false; }
}

// Testnet-v3 runtime/src/address.rs generates this exact legacy STS wallet format.
export function isLegacyStsWalletAddress(address) {
  if (typeof address !== 'string' || address.length !== BECH32M_ADDRESS_LENGTH || address !== address.toLowerCase()) return false;
  const decoded = bech32m.decodeUnsafe(address);
  return decoded?.prefix === 'synw' && decoded.words.length === 30;
}

export const isNftWalletOwner = address => isProtectedWalletAddress(address) || isLegacyStsWalletAddress(address);

function stsObjectPrefix(address) {
  if (typeof address !== 'string' || (address.length !== 43 && address.length !== 44) || address !== address.toLowerCase()) return null;
  try {
    const {prefix, words} = bech32m.decode(address);
    return words.length === 32 ? prefix : null;
  } catch {
    return null;
  }
}

export function isStsNftObjectId(address, nftClass) {
  const expectedPrefix = nftClass === 'nf1' ? 'synn1' : nftClass === 'nf2' ? 'synn2' : null;
  return expectedPrefix !== null && stsObjectPrefix(address) === expectedPrefix;
}

export function isStsFungibleObjectId(address) {
  return ['synb1', 'synb2', 'synb3'].includes(stsObjectPrefix(address));
}

export function isStsMultiAssetCollectionId(address) {
  return stsObjectPrefix(address) === 'synj';
}

// A contact format classifier for local storage and display. This does not verify ownership or transfer eligibility.
export function contactAddressProfile(address) {
  if (typeof address !== 'string') return null;
  if (address.length === PROTECTED_ADDRESS_LENGTH) {
    return isProtectedWalletAddress(address) ? 'protected' : null;
  }
  if (address === BURN_ADDRESS) return 'burn';
  if (address.length !== BECH32M_ADDRESS_LENGTH || address !== address.toLowerCase()) return null;
  try {
    const {prefix, words} = bech32m.decode(address);
    if (words.length !== BECH32M_ADDRESS_LENGTH - prefix.length - BECH32M_SEPARATOR_AND_CHECKSUM_LENGTH) {
      return null;
    }
    if (activeBech32mPrefixes.has(prefix)) return 'bech32m';
    return savedOnlyPrefixes.has(prefix) ? 'legacy' : null;
  } catch {
    return null;
  }
}

export function canSaveContactAddress(address, savedAddress) {
  const profile = contactAddressProfile(address);
  return profile !== null && (profile !== 'legacy' || address === savedAddress);
}

// Preserve the owner API while sharing canonical protected-address parsing.
export const SYNERGY_ADDRESS_ENGINE_VERSION = 'synergy-address-engine-v1';
export const SYNERGY_ADDRESS_REGISTRY_VERSION = 'SNTS-01-v1.3';
export const SYNERGY_BURN_ADDRESS = BURN_ADDRESS;
export const SYNERGY_TYPED_HASH_HEX_LENGTHS = Object.freeze({
  syntxn: 64, synxxn: 64, synixn: 64, synblk: 64, synmkl: 64, synepoch: 128, synqc: 64,
});
export function isValidSynergyAddress(address) {
  const profile = contactAddressProfile(address);
  return profile !== null && profile !== 'legacy';
}
export const isLegacySavedWalletAddress = address => contactAddressProfile(address) === 'legacy';
