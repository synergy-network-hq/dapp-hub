import assert from 'node:assert/strict';
import test from 'node:test';
import {filterValidatorBlocks, reviewValidatorBlocks, validatorBlockRows} from '../src/validator-blocks.js';
import {validatorLookupObservation} from '../src/validator-lookup.js';

const address = 'synv' + 'a'.repeat(34);
const receipt = Date.parse('2026-11-15T12:00:00Z');
const current = {
 number: '9007199254740993', hash: '1'.repeat(64), parent_hash: 'unreviewed parent fixture',
 validator_address: address, timestamp: '2026-11-15T11:00:00Z', indexed_at: '2026-11-15T11:00:10.000Z', tx_count: 0,
};
const earlier = {
 ...current, number: '9007199254740992', hash: '2'.repeat(64), timestamp: '2026-11-13T10:00:00.000Z', indexed_at: null, tx_count: null,
};

test('preserves exact block observations and optional index fields for the selected address', () => {
 const rows = validatorBlockRows([current, earlier], address);
 assert.deepEqual(rows[0], {
  number: current.number, hash: current.hash, blockTimestamp: '2026-11-15T11:00:00.000Z',
  indexedAt: '2026-11-15T11:00:10.000Z', transactions: '0',
 });
 assert.equal(rows[1].indexedAt, null);
 assert.equal(rows[1].transactions, null);
 assert.deepEqual(validatorBlockRows([], address), []);
});

test('unsupported, off-address and ambiguous records make the slice unavailable', () => {
 for (const entries of [
  null, Array(51).fill(current), [current, current],
  [{...current, validator_address: 'synv' + 'b'.repeat(34)}],
  [{...current, timestamp: '2026-02-31T12:00:00Z'}],
  [{...current, tx_count: -1}],
  [{...current, number: Number.MAX_SAFE_INTEGER + 1}],
  [{...current, hash: 'malformed data'}],
 ]) assert.equal(validatorBlockRows(entries, address), null);
});

test('interval export is anchored to receipt and snapshots only its typed projection', () => {
 const future = {...current, number: '9007199254740994', hash:'3'.repeat(64), timestamp:'2026-11-16T00:00:00Z'};
 const indexedBlocks = validatorBlockRows([future,current,earlier], address);
 assert.equal(filterValidatorBlocks(indexedBlocks,'all',receipt).length,3);
 assert.deepEqual(filterValidatorBlocks(indexedBlocks,'7d',receipt).map(row=>row.number),[current.number,earlier.number]);
 const preview = reviewValidatorBlocks({address,receivedAt:receipt,indexedBlocks},'24h');
 assert.deepEqual(preview.blocks.map(row=>row.number),[current.number]);
 assert.equal(preview.receivedAt,'2026-11-15T12:00:00.000Z');
 assert.doesNotMatch(JSON.stringify(preview), /unreviewed parent|validator_address/);
 indexedBlocks[1].number = 'modified';
 assert.equal(preview.blocks[0].number,current.number);
 assert.throws(()=>reviewValidatorBlocks({address,receivedAt:receipt,indexedBlocks:[]},'24h'), /interval/);
});

test('historical indexed attribution leaves the separate validator profile gate unchanged', () => {
 const observed = validatorLookupObservation({
  validator:{address,name:'fixture'}, profileEvidence:{validator:false}, setupStatus:'setup_pending',
  recentProducedBlocks:[current],
 }, address, receipt);
 assert.equal(observed.hasProfile,false);
 assert.equal(observed.indexedBlocks.length,1);
});
