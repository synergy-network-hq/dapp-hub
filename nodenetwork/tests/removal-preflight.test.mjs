import assert from 'node:assert/strict';
import test from 'node:test';
import {removalPreflightObservation} from '../src/removal-preflight.js';

const fixture = {
 root:'/opt/Synergy',destructive:true,managedAccountRemoval:true,outsideRootAuditComplete:false,forensicErasureProven:false,
 scopes:[
  {id:'chain_data',files:2,directories:1,sockets:0,file_bytes:'18446744073709551616'},
  {id:'custody',files:1,directories:0,sockets:0,file_bytes:'1'},
  {id:'recovery',files:0,directories:0,sockets:0,file_bytes:'0'},
  {id:'other',files:0,directories:0,sockets:1,file_bytes:'0'},
 ],
};

test('keeps exact logical file bytes, distinct types and account impact', () => {
 const review = removalPreflightObservation(fixture);
 assert.equal(review.memberCount,5);
 assert.equal(review.accountRemoval,true);
 assert.deepEqual(review.sections[0],{id:'chain_data',label:'Chain data',files:2,directories:1,sockets:0,fileBytes:'18446744073709551616'});
 assert.deepEqual(review.sections[3],{id:'other',label:'Other in-root members',files:0,directories:0,sockets:1,fileBytes:'0'});
 assert.equal(removalPreflightObservation({...fixture,managedAccountRemoval:false}).accountRemoval,false);
});

test('refuses unredacted inventories, contradictory flags, malformed counts and oversized summaries', () => {
 const changed = data => ({...fixture,scopes:[{...fixture.scopes[0],...data},...fixture.scopes.slice(1)]});
 for (const invalid of [
  {...fixture,inventory:{members:['private path']}}, {...fixture,forensicErasureProven:true},
  {...fixture,root:'/opt/synergy'}, {...fixture,outsideRootAuditComplete:true},
  changed({id:'custody'}), changed({files:1}), changed({directories:19_999}),
  changed({sockets:'0'}), changed({file_bytes:'123\n'}), changed({file_bytes:'0123'}),
 ]) assert.throws(() => removalPreflightObservation(invalid), /unsupported removal scope/);
});
