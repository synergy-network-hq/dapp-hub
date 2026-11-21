import assert from 'node:assert/strict';
import test from 'node:test';
import {logicalRemovalObservation, removalPreflightObservation, targetInventoryObservation} from '../src/removal-preflight.js';

const fixture = {
 root:'/opt/synergy',destructive:true,managedAccountRemoval:true,outsideRootAuditComplete:false,forensicErasureProven:false,
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
  {...fixture,root:'/opt/Synergy'}, {...fixture,outsideRootAuditComplete:true},
  changed({id:'custody'}), changed({files:1}), changed({directories:19_999}),
  changed({sockets:'0'}), changed({file_bytes:'123\n'}), changed({file_bytes:'0123'}),
 ]) assert.throws(() => removalPreflightObservation(invalid), /unsupported removal scope/);
});

test('standalone inventory shares exact scope totals and keeps an observed empty root distinct from invalid evidence', () => {
 const inventory = {schema:'nodenetwork-target-inventory-v1',root:fixture.root,outsideRootAuditComplete:false,scopes:fixture.scopes};
 const {root, sections, memberCount} = removalPreflightObservation(fixture);
 assert.deepEqual(targetInventoryObservation(inventory), {root, sections, memberCount});
 const empty = {...inventory,scopes:inventory.scopes.map(({id})=>({id,files:0,directories:0,sockets:0,file_bytes:'0'}))};
 assert.equal(targetInventoryObservation(empty).memberCount,0);
 for (const invalid of [fixture,{...inventory,root:'/opt/Synergy'},{...inventory,outsideRootAuditComplete:true},
  {...inventory,members:[{path:'keys/private'}]},{...inventory,scopes:[{...empty.scopes[0],file_bytes:'1'},...empty.scopes.slice(1)]}]) {
  assert.throws(()=>targetInventoryObservation(invalid),/unsupported node inventory evidence/);
 }
});

test('requires logical removal evidence for the exact reviewed root with no other result fields', () => {
 const receipt={schema:'nodenetwork-logical-removal-v1',root:fixture.root,logical_removal_verified:true,
  forensic_erasure_proven:false,backup_created:false,remaining_attributed_records:0};
 const submitted={confirmation:fixture.root};
 assert.deepEqual(logicalRemovalObservation(receipt,submitted,fixture),{root:fixture.root});
 for (const invalid of [{...receipt,root:'/opt/Synergy'},{...receipt,logical_removal_verified:false},
  {...receipt,forensic_erasure_proven:true},{...receipt,backup_created:true},
  {...receipt,remaining_attributed_records:1},{...receipt,remaining_attributed_records:'0'},
  {...receipt,records:['private fixture']}]) {
  assert.throws(()=>logicalRemovalObservation(invalid,submitted,fixture),/Removal outcome is uncertain/);
 }
 assert.throws(()=>logicalRemovalObservation(receipt,{confirmation:'/other/root'},fixture),/Removal outcome is uncertain/);
 assert.throws(()=>logicalRemovalObservation(receipt,submitted,{root:'/other/root'}),/Removal outcome is uncertain/);
});
