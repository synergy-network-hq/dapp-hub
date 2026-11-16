export const custodyStatusReads = [
 {operation:'identity_status', label:'Read existing-network custody status', title:'Existing-network custody'},
 {operation:'formation_status', label:'Read formation custody status', title:'Formation custody'},
];

const digest = value => typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);

export function custodyStatusObservation(operation, value) {
 const read = custodyStatusReads.find(item => item.operation === operation);
 const unsupported = 'The selected controller returned unsupported pending custody evidence.';
 if (!read || !value || typeof value !== 'object' || Array.isArray(value)) throw Error(unsupported);
 if (value.pending === false && Object.keys(value).length === 1) return {kind:read.title, pending:false};
 if (value.pending !== true || value.possession_verified !== true || value.membership_granted !== false
  || typeof value.network_id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,127}$/.test(value.network_id)
  || typeof value.chain_id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value.chain_id) || BigInt(value.chain_id) > 18446744073709551615n
  || typeof value.address !== 'string' || !/^synv1[a-z0-9]{10,90}$/.test(value.address)) throw Error(unsupported);
 const common = {kind:read.title, pending:true, networkId:value.network_id, chainId:value.chain_id, validatorAddress:value.address};
 if (operation === 'identity_status') {
  if (value.genesis_authority_verified !== true || !digest(value.genesis_sha256)) throw Error(unsupported);
  return {...common, genesisSha256:value.genesis_sha256};
 }
 if (value.schema !== 'nodenetwork-formation-v1' || !digest(value.formation_sha256)
  || !digest(value.formation_id) || value.formation_id === '0'.repeat(64) || !digest(value.request_sha256)) throw Error(unsupported);
 return {...common, formationSha256:value.formation_sha256};
}
