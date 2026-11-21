import assert from 'node:assert/strict';
import test from 'node:test';
import {removalScope, sameRemovalScope, uninstallParameters} from '../src/offboarding.js';

const remote = {kind: 'remote', host: 'test-node.example.invalid', root: '/opt/synergy'};

test('review captures the exact scoped host and effective SSH port', () => {
 const scope = removalScope(remote);
 assert.deepEqual(scope, {...remote, port: 22});
 assert.equal(sameRemovalScope(scope, removalScope({...remote, port: 22})), true);
 assert.equal(sameRemovalScope(scope, removalScope({...remote, port: 2222})), false);
 assert.equal(sameRemovalScope(scope, removalScope({...remote, host: 'another.example.invalid'})), false);
 assert.equal(sameRemovalScope(scope, removalScope({kind: 'local', root: remote.root})), false);
});

test('typed root confirmation gives the controller only its existing exact field', () => {
 const scope = removalScope(remote);
 assert.deepEqual(uninstallParameters(scope, '/opt/synergy'), {confirmation: '/opt/synergy'});
 for (const text of ['', '/opt/Synergy', '/opt/synergy ', '/opt/synergy/', '/opt/synergy/config']) {
  assert.throws(() => uninstallParameters(scope, text), /exactly/);
 }
});

test('deferred, malformed and unsupported targets cannot produce an uninstall request', () => {
 for (const target of [null, {}, {kind: 'remote', root: remote.root}, {...remote, root: '/other'}]) {
  assert.equal(removalScope(target), null);
  assert.throws(() => uninstallParameters(target, remote.root), /exactly/);
 }
 assert.equal(sameRemovalScope(null, removalScope(remote)), false);
});

test('managed guest removal review retains exact physical host and provisioned guest identity',()=>{
 const guest={guest_id:'validator-5',create_request_sha256:'a'.repeat(64),ssh_host_fingerprint:'SHA256:'+ 'A'.repeat(43),ssh_host_public_key:'ssh-ed25519 '+'A'.repeat(68)};
 const scope=removalScope({...remote,guest});assert.deepEqual(scope.guest,guest);
 assert.equal(sameRemovalScope(scope,removalScope(remote)),false);
 for(const change of [{guest_id:'other'},{create_request_sha256:'b'.repeat(64)},{ssh_host_fingerprint:'SHA256:'+'B'.repeat(43)}])
  assert.equal(sameRemovalScope(scope,removalScope({...remote,guest:{...guest,...change}})),false);
});
