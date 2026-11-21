import assert from 'node:assert/strict';
import test from 'node:test';
import {readSyncHistory, saveSyncSample, selectSyncHistory, syncHistoryKey, syncHistoryLimit, syncHistoryRows, syncHistorySource} from '../src/rpc-sync-history.js';

const profile = {id: 'fixture', rpc: 'https://rpc.example.invalid/', chainId: 1266};
const chain = {chainId: 1266, network: 'fixture-testnet', incarnation: '5', genesis: 'fixture-genesis'};
const nextChain = {...chain, incarnation: '6'};
const source = await syncHistorySource(profile);
const nextSource = await syncHistorySource({...profile, rpc: 'https://updated.example.invalid/'});
const reported = (receivedAt, current = '9007199254740993', highest = '9007199254741001', context = chain) => ({
 chain: context, receivedAt, sync: {mode: 'reported', current, highest, rawHealth: 'fixture secret'},
});

function storage(initial = null) {
 let value = initial;
 return {
  getItem(key) {assert.equal(key, syncHistoryKey); return value;},
  setItem(key, input) {assert.equal(key, syncHistoryKey); value = input;},
 };
}

test('persists exact ordered samples for only the selected RPC and reported context', () => {
 const device = storage();
 assert.notEqual(source, nextSource);
 assert.match(source, /^[a-f0-9]{64}$/);
 saveSyncSample(source, reported(1000), device);
 saveSyncSample(source, reported(2000, '9007199254741002'), device);
 saveSyncSample(source, reported(3000, '10', '12', nextChain), device);
 saveSyncSample(nextSource, reported(4000, '1', '4'), device);
 const raw = device.getItem(syncHistoryKey);
 assert.ok(!raw.includes(profile.rpc) && !raw.includes('fixture secret'));
 const history = readSyncHistory(storage(raw));
 const rows = syncHistoryRows(selectSyncHistory(history, source, chain));
 assert.deepEqual(rows.map(row => [row.current, row.gap, row.change]), [
  ['9007199254741002', 'Reference below local block', '+9'],
  ['9007199254740993', '8', 'No earlier sample'],
 ]);
 assert.deepEqual(selectSyncHistory(history, source).map(sample => sample.current), ['10']);
 assert.deepEqual(selectSyncHistory(history, nextSource, chain).map(sample => sample.current), ['1']);
 assert.deepEqual(selectSyncHistory(history, source, {...chain, genesis: 'changed-genesis'}), []);
});

test('refuses unavailable, duplicate and older observations and bounds device retention', () => {
 const device = storage();
 for (let index = 1; index <= syncHistoryLimit + 2; index++) saveSyncSample(source, reported(index), device);
 const before = device.getItem(syncHistoryKey);
 const saved = readSyncHistory(device);
 assert.equal(saved.samples.length, syncHistoryLimit);
 assert.equal(saved.samples.at(-1).receivedAt, 3);
 assert.throws(()=>saveSyncSample(source, reported(2), device), /same|at this time or later/);
 assert.throws(()=>saveSyncSample(nextSource, reported(2), device), /older than the retained history/);
 assert.throws(()=>saveSyncSample(source, {...reported(999), sync: {mode: 'manager-unavailable'}}, device), /No supported public sync sample/);
 assert.equal(device.getItem(syncHistoryKey), before);
});

test('preserves unsupported originals and reports failed device writes', () => {
 const device = storage();
 saveSyncSample(source, reported(1000), device);
 const before = device.getItem(syncHistoryKey);
 const {samples} = JSON.parse(before);
 for (const raw of ['{broken', 'x'.repeat(98305), JSON.stringify({version: 1, samples: [samples[0], samples[0]]}),
  JSON.stringify({version: 1, samples: [{...samples[0], current: 1}]}), JSON.stringify({version: 2, samples})]) {
  const unsupported = storage(raw);
  assert.throws(()=>readSyncHistory(unsupported), /original record is retained/);
  assert.throws(()=>saveSyncSample(source, reported(2000), unsupported), /original record is retained/);
  assert.equal(unsupported.getItem(syncHistoryKey), raw);
 }
 device.setItem = () => {throw Error('synthetic failure');};
 assert.throws(()=>saveSyncSample(source, reported(2000), device), /previous history is retained/);
 assert.equal(device.getItem(syncHistoryKey), before);
});
