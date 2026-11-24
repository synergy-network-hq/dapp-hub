import assert from 'node:assert/strict';
import test from 'node:test';
import {
 applyValidatorProfileToDraft, networkProfileSchema, networkProfileStoreKey,
 readNetworkProfiles, signedOriginFiles, validateValidatorNetworkProfile,
} from '../src/network-provisioning.js';
import {nodeRoleCatalog} from '../src/operator-workflow.js';

const validator = {
 schema: networkProfileSchema, profile_id: 'public-testnet', network_name: 'PoSy Testnet',
 network_id: 'next-posy-testnet', chain_id: 1266, node_name: 'validator-01',
 role: 'validator', genesis_hash: 'a'.repeat(64), gateway: null,
 origin: Object.fromEntries(signedOriginFiles.map(name => [name, 'b'.repeat(64)])),
};
const internal = {...validator, profile_id: 'stored-gateway', role: 'rpc_gateway', gateway: {
 public_hostname: 'rpc.example.test', tls: 'required', protocol: 'synergy-json-rpc-v1',
 listen_address: '127.0.0.1:8552', validator_address: 'synv1upstream', validator_relay_port: 8551,
 allowed_origins: [], vpn_provider_sha256: null,
}};

test('operator catalog excludes infrastructure even when the master declares it', () => {
 assert.deepEqual(nodeRoleCatalog().map(role => role.id), ['validator', 'observer_light']);
 assert.deepEqual(nodeRoleCatalog(['validator', 'rpc_gateway', 'sentry', 'ai_compute']).map(role => role.id),
  ['validator', 'ai_compute']);
});

test('a saved internal profile remains readable but cannot seed an operator draft', () => {
 const stored = {profiles: [internal, validator], selections: {target: internal.profile_id}};
 const storage = {getItem: key => key === networkProfileStoreKey ? JSON.stringify(stored) : null};
 assert.deepEqual(readNetworkProfiles(storage), stored);
 assert.throws(() => validateValidatorNetworkProfile(internal), /validator provisioning profiles/);
 assert.throws(() => applyValidatorProfileToDraft({}, internal), /validator provisioning profiles/);
});

test('applying the selected validator profile keeps the release pins and fills Val1 scope', () => {
 const before = {release_id: 'approved-release', manifest_sha256: 'c'.repeat(64),
  network_id: 'old-canary', chain_id: '99999', node_name: 'validator-02'};
 const after = applyValidatorProfileToDraft(before, validator);
 assert.deepEqual(after, {...before, network_id: 'next-posy-testnet', chain_id: '1266', node_name: 'validator-01'});
 assert.equal(before.chain_id, '99999');
});
