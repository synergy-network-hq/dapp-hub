import assert from 'node:assert/strict';
import test from 'node:test';
import {removalScope, sameRemovalScope, uninstallParameters} from '../src/offboarding.js';

const remote = {kind: 'remote', host: 'test-node.example.invalid', root: '/opt/Synergy'};

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
 assert.deepEqual(uninstallParameters(scope, '/opt/Synergy'), {confirmation: '/opt/Synergy'});
 for (const text of ['', '/opt/synergy', '/opt/Synergy ', '/opt/Synergy/', '/opt/Synergy/config']) {
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
