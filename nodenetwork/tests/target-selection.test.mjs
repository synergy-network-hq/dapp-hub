import assert from 'node:assert/strict';
import test from 'node:test';
import {
 readTargetSelection,
 saveTargetSelection,
 targetSelectionDraft,
 targetSelectionKey,
 TargetSelectionChanged,
} from '../src/target-selection.js';

const remote = {kind: 'remote', host: 'validator.example.invalid', port: 2222, root: '/opt/Synergy'};

function storage(initial = null) {
 let raw = initial;
 return {
  writes: 0,
  getItem(key) {
   assert.equal(key, targetSelectionKey);
   return raw;
  },
  setItem(key, value) {
   assert.equal(key, targetSelectionKey);
   this.writes += 1;
   raw = value;
  },
 };
}

test('legacy target records survive read and monitor-only persists without host fields', () => {
 const store = storage(JSON.stringify(remote));
 const selected = readTargetSelection(store);
 assert.deepEqual(selected.target, remote);
 assert.deepEqual(targetSelectionDraft(selected.target), {kind: 'remote', host: remote.host, port: '2222'});
 const deferred = saveTargetSelection({kind: 'monitor', host: remote.host, port: '2222'}, selected.raw, store);
 assert.deepEqual(deferred, {target: null, raw: 'null'});
 assert.deepEqual(readTargetSelection(store), deferred);
 assert.equal(targetSelectionDraft(deferred.target).kind, 'monitor');
 assert.equal(store.writes, 1);
 assert.equal(readTargetSelection(storage()).target, null);
 assert.deepEqual(readTargetSelection(storage('{"kind":"local"}')).target, {kind: 'local', root: '/opt/Synergy'});
});

test('a stale form cannot overwrite a monitor-only choice', () => {
 const store = storage(JSON.stringify(remote));
 const baseline = readTargetSelection(store);
 saveTargetSelection({kind: 'monitor'}, baseline.raw, store);
 assert.throws(() => saveTargetSelection({kind: 'local'}, baseline.raw, store), TargetSelectionChanged);
 assert.equal(store.writes, 1);
 assert.equal(readTargetSelection(store).target, null);
});

test('unsupported, oversized and unreadable target records retain their original data', () => {
 for (const raw of ['{', 'true', 'x'.repeat(4097), JSON.stringify({...remote, policy: 'future'})]) {
  const store = storage(raw);
  assert.throws(() => readTargetSelection(store), /original record is retained/);
  assert.throws(() => saveTargetSelection({kind: 'monitor'}, raw, store), /original record is retained/);
  assert.equal(store.getItem(targetSelectionKey), raw);
  assert.equal(store.writes, 0);
 }
});

test('failed persistence leaves the original target in storage', () => {
 const store = storage(JSON.stringify(remote));
 store.setItem = () => {throw new Error('Fixture storage write refused');};
 const baseline = readTargetSelection(store);
 assert.throws(() => saveTargetSelection({kind: 'monitor'}, baseline.raw, store), /current selection and edits are retained/);
 assert.deepEqual(readTargetSelection(store), baseline);
});
