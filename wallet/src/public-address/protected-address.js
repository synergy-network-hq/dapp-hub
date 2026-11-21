// Public identification codec from synergy-wallet@e7af1fc (SYNW_HEX_EIP55_V1).
// No curve operations, key generation, or signing authority.
import {keccak_256} from '@noble/hashes/sha3';
const ACCOUNT_ID_BYTES = 20;
export function accountIdentifierBody(accountId) {
  if (!(accountId instanceof Uint8Array) || accountId.length !== ACCOUNT_ID_BYTES) throw new Error('AccountIdentifier must be exactly 20 bytes.');
  const lower = Array.from(accountId, byte => byte.toString(16).padStart(2, '0')).join('');
  const checksum = keccak_256(new TextEncoder().encode(lower));
  return [...lower].map((digit, i) => ((i % 2 ? checksum[i >> 1] & 15 : checksum[i >> 1] >> 4) >= 8 ? digit.toUpperCase() : digit)).join('');
}
export function formatProtectedWalletAddress(accountId) { return 'synw' + accountIdentifierBody(accountId); }
export function formatEvmAccountAddress(accountId) { return '0x' + accountIdentifierBody(accountId); }
export function parseProtectedWalletAddress(address) {
  if (typeof address !== 'string' || !/^synw[0-9a-fA-F]{40}$/.test(address)) throw new Error('Protected synw must be exactly 44 ASCII characters.');
  const bytes = Uint8Array.from(address.slice(4).match(/../g), pair => Number.parseInt(pair, 16));
  if (formatProtectedWalletAddress(bytes) !== address) throw new Error('Protected synw requires canonical EIP-55 checksum.');
  return bytes;
}
