import {readProtocolObservation, rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {validatorLookupAddress} from './validator-lookup.js';
import {confirmReportedGenesis, genesisDigest} from './genesis-pin.js';

const listLimit = 512;
const unsupported = 'The selected RPC returned an unsupported active validator list.';

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
 return confirmReportedGenesis(chain.genesis, expected);
}

async function readPinnedActiveListing(request, profile, address, signal) {
 const reportedGenesis = await readValidatorGenesisPin(request, profile, signal);
 signal?.throwIfAborted();
 const value = await request('synergy_getValidators', [], {endpoint: profile.rpc, signal});
 signal?.throwIfAborted();
 return {...validatorActiveListing(value, address), reportedGenesis};
}
