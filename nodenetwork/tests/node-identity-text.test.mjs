import assert from 'node:assert/strict';
import test from 'node:test';
import {validatorIdentityText, sameValidatorIdentity} from '../src/node-identity-text.js';
import {validatorLookupPath, validatorLookupObservation} from '../src/validator-lookup.js';
import {validatorActiveListing} from '../src/validator-active-list.js';
import {validatorBlockRows} from '../src/validator-blocks.js';

const first = 'synv1.2.' + 'Aa0_-Z'.repeat(10) + 'aB9_';
const other = 'synv1.2.' + first.slice(8).toLowerCase();
const detail = address => ({validator:{address}, profileEvidence:{validator:true}, setupStatus:'active_consensus'});
test('R1 class I text and lookup preserve all 64 case-sensitive payload characters', () => {
 assert.equal(first.length,72);
 assert.equal(validatorIdentityText(first),first);
 assert.equal(validatorLookupPath(first),'validators/'+first);
 assert.equal(validatorLookupObservation(detail(first),first).address,first);
 assert.equal(sameValidatorIdentity(other,first),false);
 assert.throws(()=>validatorLookupObservation(detail(other),first),/mismatched/);
});
test('R1 rejects alternate class/version, truncation, padding, whitespace and Unicode', () => {
 for (const value of [
  first.replace('synv1','synv2'),first.replace('.2.','.1.'),first.slice(0,-1),first+'=',
  ' '+first, first+'\n', first.replace('A','Ａ'),first.replace('synv1','SYNV1'),
 ]) assert.throws(()=>validatorIdentityText(value));
 assert.throws(()=>validatorIdentityText('synv'+'a'.repeat(34),{allowHistorical:false}));
});
test('active listings distinguish case-sensitive identities and reject mixed legacy rows', () => {
 const row=address=>({address,status:'Active'});
 assert.equal(validatorActiveListing([row(first),row(other)],first).count,2);
 assert.equal(validatorActiveListing([row(other)],first).listed,false);
 assert.throws(()=>validatorActiveListing([row(first),row(first)],first),/unsupported/);
 assert.throws(()=>validatorActiveListing([row('synv'+'a'.repeat(34))],first),/unsupported/);
});
test('indexed block attribution and identifiers remain exact for R1 selectors', () => {
 const block={number:'1',hash:'AbC',validator_address:first,timestamp:'2026-11-28T00:00:00Z'};
 assert.equal(validatorBlockRows([block],first)[0].hash,'AbC');
 assert.equal(validatorBlockRows([{...block,validator_address:other}],first),null);
 assert.equal(validatorBlockRows([block,{...block,number:'2',hash:'abc'}],first).length,2);
});
