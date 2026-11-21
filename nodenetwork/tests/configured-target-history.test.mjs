import assert from 'node:assert/strict';
import test from 'node:test';
import {configuredTargetFingerprint, filterRequests} from '../src/request-history.js';
const remote = {kind:'remote',host:'VALIDATOR-FIXTURE.EXAMPLE.INVALID',root:'/opt/synergy'};
test('configured history uses the native current incarnation, never a renderer-computed host hash', async()=>{
 const first='a'.repeat(64), next='b'.repeat(64);
 const observe=async target=>{assert.equal(target.host,remote.host.toLowerCase());return {targetDigest:first};};
 assert.equal(await configuredTargetFingerprint(remote,observe),first);
 assert.equal(await configuredTargetFingerprint(remote,async()=>({targetDigest:next})),next);
 const row={target_digest:first,state:'uncertain',operation:'install'};
 assert.deepEqual(filterRequests([row,{...row,target_digest:next}],{status:'unresolved',operation:'all',target:first}),[row]);
});
test('unavailable scope or unsupported targets never infer a journal match',async()=>{
 for(const invalid of [null,{...remote,root:'/opt/Synergy'},{...remote,host:'operator@fixture'},{...remote,port:0},{kind:'local',host:'fixture',root:remote.root}])
  await assert.rejects(configuredTargetFingerprint(invalid,()=>assert.fail('unexpected native scope read')));
 for(const scope of [null,{targetDigest:'x'},{targetDigest:'a'.repeat(64),extra:true}])
  await assert.rejects(configuredTargetFingerprint(remote,async()=>scope),/native target journal scope/);
});
