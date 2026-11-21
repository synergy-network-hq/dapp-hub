const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const isCurrentCanaryReadProfile=profile=>profile?.id==='posy-canary-current';

// Public gateway reports, not independent finality verification or admission.
export function canaryRuntimeObservation(value,profile,receivedAt=Date.now()) {
 const invalid=()=>{throw Error('Current Canary runtime identity or telemetry is unavailable or mismatched.');};
 if(!isCurrentCanaryReadProfile(profile)||profile.chainId!==99999||typeof profile.networkId!=='string'||!profile.networkId||!hash(profile.genesisHash)
  ||!object(value)||value.schema_version!==1||value.chain_id!==profile.chainId||value.network_identity!==profile.networkId||value.genesis_hash!==profile.genesisHash
  ||!count(value.process_id)||!value.process_id||!count(value.observed_at_unix_ms)||!count(value.finalized_height)
  ||!(value.epoch===null||count(value.epoch)&&value.epoch>0)||!(value.epoch_context_root===null||hash(value.epoch_context_root)))invalid();
 const c=value.common_finalized_commitment;
 if(c!==null&&(!object(c)||Object.keys(c).sort().join(',')!=='block_id,finality_certificate_id,height,protected_execution_root,state_root'
  ||!count(c.height)||!c.height||c.height>value.finalized_height||!['block_id','state_root','finality_certificate_id','protected_execution_root'].every(k=>hash(c[k]))))invalid();
 return {chainId:value.chain_id,networkId:value.network_identity,genesisHash:value.genesis_hash,
  processId:value.process_id,observedAt:value.observed_at_unix_ms,receivedAt,epoch:value.epoch,
  epochContextRoot:value.epoch_context_root,finalizedHeight:value.finalized_height,commitment:c===null?null:{...c}};
}
