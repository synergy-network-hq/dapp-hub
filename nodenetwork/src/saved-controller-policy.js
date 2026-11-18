import {genesisDigest} from './genesis-pin.js';
import {localSha256} from './local-sha256.js';
import {installParameters,validReleaseId} from './nodeNetwork.js';
import {exactObservationU64,parseExactNumbers} from './validator-operations-observation.js';

// Testnet v3 613fa6ab: linux-node/bootstrap.py and controller.py.
export const savedControllerPolicyLimit = 128 * 1024;
const unsupported = 'The file is not a supported saved NodeNetwork controller policy.';
const operations = new Set([
 'target','inventory','health','install_preflight','upgrade_preflight','recovery_preflight','uninstall_preflight',
 'vpn_status','diagnostics','identity_preflight','identity_status','formation_preflight','formation_status','formation_export',
 'genesis_stage_preflight','genesis_binding_preflight','install','commission','register','vpn_enroll','start','stop','restart',
 'upgrade','uninstall','identity_generate','formation_prepare','genesis_stage','genesis_bind',
]);
const engineNames = ['controller.py','synergy_linux.py','lifecycle.py','conformance.py','apqe_layout.py','vpn.py','canary_rpc_relay.py'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && value === genesisDigest(value);
const networkName = value => value.length >= 2 && value.length <= 128
 && /^[a-z0-9]/.test(value) && !/[^a-z0-9_-]/.test(value);
const chainNumber = value => {
 const digits = exactObservationU64(value);
 return digits === null || digits === '0' ? null : digits;
};

function validateRelease([name,value]) {
 if (!validReleaseId(name) || !object(value) || !digest(value.manifest_sha256)
  || typeof value.inventory_authenticated !== 'boolean') throw Error(unsupported);
 if (!Object.hasOwn(value,'networks')) return;
 if (!object(value.networks)) throw Error(unsupported);
 const networks = Object.entries(value.networks);
 if (networks.length > 128 || networks.some(([network,chain])=>!networkName(network) || !chainNumber(chain))) throw Error(unsupported);
}

function policyObject(raw) {
 let policy;
 try {
  policy = parseExactNumbers(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
 } catch {throw Error(unsupported);}
 if (!object(policy) || policy.format !== 'synergy-nodenetwork-host-policy-v1' || policy.root !== '/opt/Synergy'
  || policy.community_enrollment !== false || !Array.isArray(policy.qualified_operations)
  || policy.qualified_operations.length > operations.size || new Set(policy.qualified_operations).size !== policy.qualified_operations.length
  || !policy.qualified_operations.every(name=>operations.has(name)) || !object(policy.releases)
  || !object(policy.engine_files) || Object.keys(policy.engine_files).length !== engineNames.length
  || !engineNames.every(name=>Object.hasOwn(policy.engine_files,name) && digest(policy.engine_files[name]))) throw Error(unsupported);
 const releases = Object.entries(policy.releases);
 if (releases.length > 128) throw Error(unsupported);
 releases.forEach(validateRelease);
 return policy;
}

export async function readSavedControllerPolicy(file,expectedSha256,form,current = () => true) {
 const draft = installParameters(form);
 const expected = genesisDigest(expectedSha256);
 if (!expected) throw Error('Enter the independently supplied policy SHA-256 before selecting the file.');
 if (!Number.isSafeInteger(file?.size) || file.size < 1 || file.size > savedControllerPolicyLimit) {
  throw Error('Choose a nonempty NodeNetwork controller policy JSON file of at most 128 KiB.');
 }
 if (!current()) return null;
 let bytes;
 try {
  bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) throw Error();
 } catch {throw Error('The selected controller policy could not be read in full.');}
 if (!current()) return null;
 const policySha256 = await localSha256(bytes);
 if (!current()) return null;
 if (policySha256 !== expected) return {status:'pin-mismatch'};
 const policy = policyObject(bytes);
 const selected = Object.hasOwn(policy.releases,draft.release_id) ? policy.releases[draft.release_id] : null;
 const networks = selected?.networks;
 const chain = networks && Object.hasOwn(networks,draft.network_id) ? chainNumber(networks[draft.network_id]) : null;
 const scope = ['disposable-test-only','disposable-software-lifecycle-only'].includes(policy.qualification_scope)
  ? 'disposable' : Object.hasOwn(policy,'qualification_scope') ? 'other' : 'unlabelled';
 return {status:'compared',policySha256,scope,releaseListed:Boolean(selected),
  manifestMatches:selected ? selected.manifest_sha256 === draft.manifest_sha256 : null,
  inventoryAuthenticated:selected?.inventory_authenticated ?? null,
  networkListed:selected ? chain !== null : null,reportedChain:chain,
  chainMatches:chain === null ? null : chain === String(draft.chain_id),installListed:policy.qualified_operations.includes('install')};
}
