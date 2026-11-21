import test from 'node:test';
import assert from 'node:assert/strict';
import {transportStagingView} from '../src/transport-workflow.js';
const names=['config/node.json','config/start-authorized.json','network/genesis.json','network/authority.json','network/authority-root.pub','network/network-manifest.json','network/transport-registry.json','network/transport-root.pub'];
const receipt={schema:'nodenetwork-native-transport-staged-v1',staged:true,address:'synv11ssfh8clfcxxa9zqalgm8zzwmu42nlhy7veg',review_sha256:'a'.repeat(64),artifact_sha256:Object.fromEntries(names.map(name=>[name,'b'.repeat(64)])),fleet_readiness_verified:false,commissioned:false,runtime_admission:false};
test('transport receipt shows exact public files without claiming commissioning or leaking extra values',()=>{
 assert.deepEqual(transportStagingView({...receipt,unexpected:'not displayed'}),receipt);
 for(const flag of ['fleet_readiness_verified','commissioned','runtime_admission'])assert.throws(()=>transportStagingView({...receipt,[flag]:true}));
});
test('missing, foreign, or malformed transport artifacts fail closed',()=>{
 const missing={...receipt.artifact_sha256};delete missing[names[0]];
 const foreign={...missing,'../keys/private': 'b'.repeat(64)};
 for(const artifact_sha256 of [missing,foreign,{...receipt.artifact_sha256,[names[0]]:'not-a-digest'},null])assert.throws(()=>transportStagingView({...receipt,artifact_sha256}));
 assert.throws(()=>transportStagingView({...receipt,review_sha256:null}));
 assert.throws(()=>transportStagingView({...receipt,address:'not a validator identity'}));
 assert.throws(()=>transportStagingView({...receipt,staged:false}));
});
