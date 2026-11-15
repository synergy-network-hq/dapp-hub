export const identityPreflightReads = [
 {operation: 'identity_preflight', label: 'Check existing-network inputs', title: 'Existing-network preflight'},
 {operation: 'formation_preflight', label: 'Check formation inputs', title: 'Formation preflight'},
];

const digest = value => typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);

export function identityPreflightObservation(operation, value) {
 const read = identityPreflightReads.find(item => item.operation === operation);
 const unsupported = 'The selected controller returned unsupported validator preparation evidence.';
 if (!read || !value || typeof value !== 'object' || Array.isArray(value)) throw Error(unsupported);
 const {network_id: networkId, chain_id: chainId} = value;
 if (typeof networkId !== 'string' || networkId.length < 2 || networkId.length > 128
  || !/^[a-z0-9]/.test(networkId) || /[^a-z0-9_-]/.test(networkId)
  || typeof chainId !== 'string' || !chainId.length || chainId.length > 20 || chainId[0] === '0'
  || /[^0-9]/.test(chainId) || BigInt(chainId) > 18_446_744_073_709_551_615n) throw Error(unsupported);
 const common = {title: read.title, networkId, chainId};
 if (operation === 'identity_preflight') {
  if (Object.keys(value).length !== 4 || value.genesis_authority_verified !== true || !digest(value.genesis_sha256)) {
   throw Error(unsupported);
  }
  return {...common, genesisSha256: value.genesis_sha256};
 }
 if (Object.keys(value).length !== 5 || value.schema !== 'nodenetwork-formation-v1'
  || !digest(value.formation_sha256) || !digest(value.formation_id) || value.formation_id === '0'.repeat(64)) {
  throw Error(unsupported);
 }
 return {...common, formationSha256: value.formation_sha256, formationId: value.formation_id};
}
