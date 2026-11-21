import {validInstallNetworkId, validInstallNodeName} from './nodeNetwork.js';

export const networkProfileSchema = 'synergy-network-provisioning-v1';
export const signedOriginFiles = [
 'genesis.json', 'authority.json', 'authority-root.pub',
 'network-manifest.json', 'transport-registry.json', 'transport-root.pub',
];
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
export const networkProfileStoreKey = 'synergy.nodenetwork.provisioning-profiles.v1';

export function networkTargetKey(target) {
 if (!target) return '';
 return JSON.stringify([target.kind, target.host ?? null, target.port ?? 22, target.root, target.guest ?? null]);
}

export function validateNetworkProfile(value) {
 if (!exact(value, ['schema', 'profile_id', 'network_name', 'network_id', 'chain_id', 'node_name',
   'role', 'genesis_hash', 'origin', 'gateway']) || value.schema !== networkProfileSchema
   || !validInstallNetworkId(value.profile_id) || !validInstallNetworkId(value.network_id)
   || typeof value.network_name !== 'string' || !value.network_name.trim() || value.network_name.length > 96
   || /[\x00-\x1f\x7f]/.test(value.network_name) || !validInstallNodeName(value.node_name)
   || !Number.isSafeInteger(value.chain_id) || value.chain_id <= 0
   || !['validator', 'rpc_gateway'].includes(value.role) || !digest(value.genesis_hash)) {
  throw Error('Enter a valid profile, network identity, Genesis, and managed role.');
 }
 if (!exact(value.origin, signedOriginFiles) || !signedOriginFiles.every(name => digest(value.origin[name]))) {
  throw Error('Enter the SHA-256 digest of each authenticated network artifact.');
 }
 if (value.role === 'validator') {
  if (value.gateway !== null) throw Error('A validator profile cannot expose a public gateway.');
  return value;
 }
 const gateway = value.gateway;
 const gatewayFields = ['public_hostname', 'tls', 'protocol', 'listen_address', 'validator_address',
  'validator_relay_port', 'allowed_origins', 'vpn_provider_sha256'];
 if (Object.hasOwn(gateway ?? {}, 'vpn_credential_locator_sha256')) {
  gatewayFields.push('vpn_credential_locator_sha256');
 }
 if (!exact(gateway, gatewayFields)
   || typeof gateway.public_hostname !== 'string' || gateway.public_hostname.length > 253
   || !gateway.public_hostname.includes('.')
   || !gateway.public_hostname.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
   || gateway.tls !== 'required' || gateway.protocol !== 'synergy-json-rpc-v1'
   || typeof gateway.listen_address !== 'string' || !/^(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(gateway.listen_address)
   || Number(gateway.listen_address.split(':').at(-1)) > 65535
   || typeof gateway.validator_address !== 'string' || !/^synv1[a-z0-9]{1,123}$/.test(gateway.validator_address)
   || !Number.isInteger(gateway.validator_relay_port) || gateway.validator_relay_port < 1 || gateway.validator_relay_port > 65535
   || !Array.isArray(gateway.allowed_origins) || gateway.allowed_origins.length > 16
   || new Set(gateway.allowed_origins).size !== gateway.allowed_origins.length
   || gateway.allowed_origins.some(origin => typeof origin !== 'string' || !/^https:\/\/[a-zA-Z0-9.:-]{1,253}$/.test(origin))) {
  throw Error('Enter the approved public hostname, loopback listener, and signed upstream address and relay port.');
 }
 const provider = gateway.vpn_provider_sha256;
 const locator = gateway.vpn_credential_locator_sha256;
 if ((provider !== null && !digest(provider)) || (locator != null && (!digest(provider) || !digest(locator)))) {
  throw Error('Enter the VPN provider and credential locator SHA-256 digests.');
 }
 return value;
}

export function readNetworkProfiles(storage) {
 const raw = storage.getItem(networkProfileStoreKey);
 if (raw === null) return {profiles: [], selections: {}};
 if (raw.length > 256 * 1024) throw Error('Saved network profiles exceed the supported size.');
 const store = JSON.parse(raw);
 if (!exact(store, ['profiles', 'selections']) || !Array.isArray(store.profiles)
   || store.profiles.length > 64 || !store.selections || typeof store.selections !== 'object'
   || Array.isArray(store.selections)) throw Error('Saved network profiles are unavailable.');
 const ids = new Set(store.profiles.map(profile => validateNetworkProfile(profile).profile_id));
 if (ids.size !== store.profiles.length || Object.values(store.selections).some(id => !ids.has(id))) {
  throw Error('Saved network profile assignments are inconsistent.');
 }
 return store;
}

function ordered(value) {
 if (Array.isArray(value)) return value.map(ordered);
 if (value === null || typeof value !== 'object') return value;
 return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
}

export function sameNetworkProfile(left, right) {
 return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}
