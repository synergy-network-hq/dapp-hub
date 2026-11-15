import {readProtocolObservation, rpcReadinessObservation, unsignedObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {confirmReportedGenesis, genesisDigest} from './genesis-pin.js';
import {validatorLookupAddress} from './validator-lookup.js';

const supportedStatuses = new Set(['Active', 'Inactive', 'Jailed', 'Slashed', 'Pending', 'Shadow']);
const optionalNumbers = ['cluster_id', 'cluster_assignment_epoch', 'cluster_assignment_effective_height',
 'shadow_started_at_height', 'activation_recorded_height', 'activation_effective_height'];
const unsupportedRecord = 'The selected RPC returned an unsupported validator record.';

function exactUnsigned(value) {
 if (typeof value !== 'string' || value.trim() !== value) throw Error(unsupportedRecord);
 try {return unsignedObservation(value);} catch {throw Error(unsupportedRecord);}
}

export function validatorRecordObservation(value, address, readiness, receivedAt = Date.now()) {
 const context = value?.chainContext;
 const {chain} = readiness;
 const genesis = genesisDigest(chain.genesis);
 if (context?.chainId !== chain.chainId || !Number.isSafeInteger(context.incarnation) || context.incarnation < 1
  || String(context.incarnation) !== chain.incarnation || !genesis || genesisDigest(context.genesis) !== genesis) {
  throw Error('The validator record and selected RPC readiness report different chain contexts.');
 }

 const base = {address, incarnation:chain.incarnation, receivedAt};
 const record = value.record;
 if (record === null) return {...base, record:null};
 const reference = record?.activation_tx_hash;
 if (record?.address !== address || !supportedStatuses.has(record.status)
  || (reference !== null && reference !== 'genesis'
   && !(typeof reference === 'string' && reference.length === 71 && /^syntxn-[0-9a-f]{64}$/.test(reference)))) {
  throw Error(unsupportedRecord);
 }
 return {...base, record:{
  status:record.status,
  stakeNwei:exactUnsigned(record.stake_amount),
  minimumNwei:exactUnsigned(record.min_stake_required),
  activationReference:reference,
  ...Object.fromEntries(optionalNumbers.map(key=>[key,record[key] === null ? null : exactUnsigned(record[key])])),
 }};
}

export async function readValidatorRecord(request, readRecord, profile, address, signal, canRead) {
 if (Number(profile.chainId) !== 1266) throw Error('Validator registration reports require a Synergy Testnet chain 1266 endpoint.');
 const selected = validatorLookupAddress(address);
 const pin = genesisDigest(profile.genesisHash);
 if (profile.genesisHash != null && !pin) throw Error('The configured validator Genesis pin is invalid.');
 function requireReadAccess() {
  signal?.throwIfAborted();
  if (!canRead()) throw Error('NodeNetwork read access is unavailable for the validator record.');
 }
 const guardedRequest = (method, params, options) => {
  requireReadAccess();
  return request(method, params, options);
 };
 const readiness = await readProtocolObservation(guardedRequest, 'synergy_getReadiness', profile, signal, rpcReadinessObservation);
 const {chain} = readiness;
 if (chain.network !== 'synergy-testnet-v3' || !genesisDigest(chain.genesis)) {
  throw Error('The selected RPC did not provide a supported Testnet v3 identity.');
 }
 if (pin) confirmReportedGenesis(chain.genesis, pin);
 requireReadAccess();
 const record = await readRecord(selected, {endpoint:profile.rpc, signal});
 requireReadAccess();
 return validatorRecordObservation(record, selected, readiness);
}
