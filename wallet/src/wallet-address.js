import {keccak_256} from '@noble/hashes/sha3';
import {bech32m} from 'bech32';

const BECH32M_ADDRESS_LENGTH = 41;
const BECH32M_SEPARATOR_AND_CHECKSUM_LENGTH = 7;
const PROTECTED_ADDRESS_LENGTH = 44;
const BURN_ADDRESS = 'syn0000000000000000000000000000000';

// Current address namespaces from the Wallet owner at e7af1fce62c396a95e989cec33edc333eb405a05.
const activeBech32mPrefixes = new Set([
  'syns', 'syna', 'synz', 'synv1', 'synv2', 'synv3', 'synv4', 'synv5', 'syno', 'syny',
  'synb1', 'synb2', 'synb3', 'synn1', 'synn2', 'synj', 'synk', 'synq', 'sync', 'synf',
  'syngrp1', 'syngrp2', 'syngrp3', 'syngrp4', 'syngrp5',
]);
// These exact namespaces were accepted by the old local contact store at 50d9981d588043f7db3a16dc7b5c8ca3e7db80cc.
const savedOnlyPrefixes = new Set(['synw', 'synm', 'synu', 'synl']);

export function isProtectedWalletAddress(address) {
  if (typeof address !== 'string' || address.length !== PROTECTED_ADDRESS_LENGTH || !/^synw[0-9a-fA-F]{40}$/.test(address)) return false;
  // SYNW_HEX_EIP55_V1 from the Wallet owner. Keccak hashes the lowercase hex body without its prefix.
  const body = address.slice(4);
  const lower = body.toLowerCase();
  const checksum = keccak_256(new TextEncoder().encode(lower));
  const expected = [...lower].map((digit, index) => {
    const nibble = index % 2 ? checksum[index >> 1] & 15 : checksum[index >> 1] >> 4;
    return nibble >= 8 ? digit.toUpperCase() : digit;
  }).join('');
  return body === expected;
}

export function isStsNftObjectId(address, nftClass) {
  const expectedPrefix = nftClass === 'nf1' ? 'synn1' : nftClass === 'nf2' ? 'synn2' : null;
  if (!expectedPrefix || typeof address !== 'string' || address.length !== 44 || address !== address.toLowerCase()) return false;
  try {
    const {prefix, words} = bech32m.decode(address);
    return prefix === expectedPrefix && words.length === 32;
  } catch {
    return false;
  }
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
