import {readProtocolObservation, rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {validatorLookupAddress} from './validator-lookup.js';

const listLimit = 512;
const unsupported = 'The selected RPC returned an unsupported active validator list.';
const genesisDigest = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value)
 ? value.toLowerCase() : null;

export function validatorActiveListing(value, address, receivedAt = Date.now()) {
 const expected = validatorLookupAddress(address);
 if (!Array.isArray(value) || value.length > listLimit) throw Error(unsupported);
 const identities = new Set();
 for (const row of value) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.status !== 'Active'
   || typeof row.address !== 'string' || !/^synv[a-z0-9]{34,92}$/i.test(row.address)) throw Error(unsupported);
  const identity = row.address.toLowerCase();
  if (identities.has(identity)) throw Error(unsupported);
  identities.add(identity);
 }
 return {address: expected, listed: identities.has(expected), count: identities.size, receivedAt};
}

export function readValidatorActiveListing(request, profile, address, signal) {
 if (Number(profile.chainId) !== 1266) throw Error('The active validator list requires Synergy Testnet chain 1266.');
 const expected = validatorLookupAddress(address);
 if (profile.genesisHash != null) return readPinnedActiveListing(request, profile, expected, signal);
 return readProtocolObservation(request, 'synergy_getValidators', profile, signal, value => validatorActiveListing(value, expected));
}

export async function readValidatorGenesisPin(request, profile, signal) {
 const expected = genesisDigest(profile.genesisHash);
 if (!expected) throw Error('The configured validator Genesis pin is invalid.');
 const {chain} = await readProtocolObservation(request, 'synergy_getReadiness', profile, signal, rpcReadinessObservation);
 const reported = genesisDigest(chain.genesis);
 if (!reported) throw Error('The selected RPC returned an unsupported Genesis hash.');
 if (reported !== expected) throw Error('The selected RPC Genesis hash does not match the configured pin.');
 return reported;
}

async function readPinnedActiveListing(request, profile, address, signal) {
 const reportedGenesis = await readValidatorGenesisPin(request, profile, signal);
 signal?.throwIfAborted();
 const value = await request('synergy_getValidators', [], {endpoint: profile.rpc, signal});
 signal?.throwIfAborted();
 return {...validatorActiveListing(value, address), reportedGenesis};
}
