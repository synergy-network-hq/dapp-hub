import {rpcReadinessObservation, unsignedObservation} from '@synergy-network/dapp-data-view/protocol-observations';

// Pinned testnet-v3 owns these states and the sync-manager fallback envelope.
const managerStates = new Set(['Idle', 'Discovering', 'Downloading', 'Validating', 'Applying', 'Synced']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function rpcSyncObservation(value, readiness) {
 if (!object(value) || typeof value.syncing !== 'boolean' || typeof value.fail_closed !== 'boolean'
  || typeof value.chain_state_available !== 'boolean'
  || ('fallback' in value && typeof value.fallback !== 'boolean')
  || ('sync_manager_available' in value && typeof value.sync_manager_available !== 'boolean')) {
  throw Error('The readiness response contains no supported synchronization report.');
 }
 const identity = value.chain;
 const {chain} = readiness;
 if (!object(identity) || identity.chain_id !== chain.chainId || identity.network_id !== chain.network
  || identity.genesis_hash !== chain.genesis || unsignedObservation(identity.chain_incarnation) !== chain.incarnation) {
  throw Error('Synchronization and readiness describe different reported chain contexts.');
 }

 const current = value.current_block === null ? null : unsignedObservation(value.current_block);
 const highest = unsignedObservation(value.highest_block);
 if (value.chain_state_available !== readiness.chainStateAvailable || current !== readiness.height
  || value.chain_state_available !== (current !== null)) {
  throw Error('Synchronization and readiness disagree on the available local chain tip.');
 }

 if (value.fallback === true || value.sync_manager_available === false) {
  if (value.fallback !== true || value.sync_manager_available !== false) throw Error('The synchronization fallback is unsupported.');
  return {mode: 'manager-unavailable', current, highest};
 }

 if (!managerStates.has(value.state) || typeof value.sync_percentage !== 'number'
  || !Number.isFinite(value.sync_percentage) || value.sync_percentage < 0 || value.sync_percentage > 100
  || value.fail_closed === value.chain_state_available) {
  throw Error('The synchronization manager returned unsupported progress.');
 }
 const stateActive = value.state !== 'Idle' && value.state !== 'Synced';
 const syncingExpected = stateActive || current === null || BigInt(current) < BigInt(highest);
 if (value.syncing !== syncingExpected) throw Error('The synchronization state and reported syncing flag disagree.');
 if (current === null) return {mode: 'tip-unavailable', current, highest};

 const gap = BigInt(highest) - BigInt(current);
 return {
  mode: 'reported',
  current,
  highest,
  gap: gap < 0n ? null : String(gap),
  managerState: value.state,
  syncing: value.syncing,
  percentage: value.sync_percentage,
 };
}

export function rpcReadinessWithSync(value, expected) {
 const readiness = rpcReadinessObservation(value, expected);
 try {
  return {...readiness, sync: rpcSyncObservation(value.health.sync, readiness), syncError: null};
 } catch (failure) {
  return {...readiness, sync: null, syncError: failure.message};
 }
}
