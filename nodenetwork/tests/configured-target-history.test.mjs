import assert from 'node:assert/strict';
import test from 'node:test';
import {configuredTargetFingerprint, filterRequests} from '../src/request-history.js';

const root = '/opt/Synergy';
const defaultRemote = '339c7f3add8333afcacd9a24f3e59a026aad8de56975310271444473da96c252';
const remote = {kind:'remote',host:'VALIDATOR-FIXTURE.EXAMPLE.INVALID',root};

test('matches the native v1 fingerprints for local, default SSH and explicit IPv6 targets', async () => {
 assert.equal(await configuredTargetFingerprint({kind:'local',root}), '12f8f8950509dcba72d0a36fb6bc54379c8242213366f6acb02d328bf10ce8b8');
 assert.equal(await configuredTargetFingerprint(remote), defaultRemote);
 assert.equal(await configuredTargetFingerprint({...remote,host:remote.host.toLowerCase(),port:22}), defaultRemote);
 assert.equal(await configuredTargetFingerprint({kind:'remote',host:'[2001:db8::1234]',port:2222,root}),
  '5be522ca2c219d47e5fc80f0938c6ffa668c1d158cde365548993bf63b0f2a9f');
});

test('filters the native unresolved states for the exact configuration and refuses unsupported targets', async () => {
 const target = await configuredTargetFingerprint(remote);
 const another = await configuredTargetFingerprint({...remote,port:2222});
 assert.notEqual(another, target);
 const intent = {target_digest:target,state:'dispatch_intent',operation:'install'};
 const uncertain = {target_digest:target,state:'uncertain',operation:'upgrade'};
 const refused = {target_digest:target,state:'response_received',response_ok:false,operation:'restart'};
 assert.deepEqual(filterRequests([intent,uncertain,refused,{...intent,target_digest:another}],{
  status:'unresolved',operation:'all',target,
 }), [intent,uncertain]);
 for (const invalid of [null,{...remote,root:'/opt/synergy'},{...remote,host:'operator@fixture'},{...remote,port:0},
  {kind:'local',host:'fixture',root}]) {
  await assert.rejects(configuredTargetFingerprint(invalid));
 }
});
