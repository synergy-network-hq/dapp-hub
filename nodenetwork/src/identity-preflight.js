import {genesisStageFiles} from './genesis-stage-files.js';

export const identityPreflightReads = [
 {operation: 'identity_preflight', label: 'Check existing-network inputs', title: 'Existing-network preflight'},
 {operation: 'formation_preflight', label: 'Check formation inputs', title: 'Formation preflight'},
 {operation: 'genesis_binding_preflight', label: 'Review staged Genesis binding', title: 'Staged Genesis binding'},
 {operation: 'genesis_stage_preflight', label: 'Read Genesis staging policy', title: 'Genesis staging policy'},
];

const digest = value => typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);
const validatorAddress = address => {
 const tail = typeof address === 'string' && address.startsWith('synv1') ? address.slice(5) : '';
 return tail.length >= 10 && tail.length <= 90 && !/[^a-z0-9]/.test(tail);
};

export function identityPreflightObservation(operation, value) {
 const read = identityPreflightReads.find(item => item.operation === operation);
 const unsupported = 'The selected controller returned unsupported validator preparation evidence.';
 if (!read || !value || typeof value !== 'object' || Array.isArray(value)) throw Error(unsupported);
 if (operation === 'genesis_stage_preflight') {
  if (Object.keys(value).length !== 5 || value.schema !== 'nodenetwork-genesis-stage-policy-v1'
   || !validatorAddress(value.address) || genesisStageFiles.some(({pin}) => !digest(value[pin]))) throw Error(unsupported);
  return {title: read.title, validatorAddress: value.address,
   artifactPins: Object.fromEntries(genesisStageFiles.map(({pin}) => [pin, value[pin]]))};
 }
 const {network_id: networkId, chain_id: chainId} = value;
 if (typeof networkId !== 'string' || networkId.length < 2 || networkId.length > 128
  || !/^[a-z0-9]/.test(networkId) || /[^a-z0-9_-]/.test(networkId)
  || typeof chainId !== 'string' || !chainId.length || chainId.length > 20 || chainId[0] === '0'
  || /[^0-9]/.test(chainId) || BigInt(chainId) > 18_446_744_073_709_551_615n) throw Error(unsupported);
 const common = {title: read.title, networkId, chainId};
 if (operation === 'genesis_binding_preflight') {
  if (Object.keys(value).length !== 9 || value.schema !== 'nodenetwork-genesis-binding-v1'
   || value.genesis_authority_verified !== true || value.membership_verified !== true || !digest(value.genesis_sha256)
   || !validatorAddress(value.address)
   || typeof value.bound !== 'boolean' || typeof value.stage_receipt_verified !== 'boolean') throw Error(unsupported);
  return {...common, genesisSha256: value.genesis_sha256, validatorAddress: value.address,
   bound: value.bound, stageReceiptVerified: value.stage_receipt_verified};
 }
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
