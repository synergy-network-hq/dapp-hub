import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readNodeNetwork,nodeNetworkObservationScope,legacyTestnetObservationProfile} from '../src/nodeNetwork.js';
import {readValidatorGenesisPin} from '../src/validator-active-list.js';
const genesis='a'.repeat(64),foreign='b'.repeat(64);
const profile={id:'configured',rpc:'https://public.example',chainId:1266,genesisHash:genesis};
function readiness(hash=genesis){
 const chain={chain_id:1266,network_id:'synergy-testnet-v3',chain_incarnation:5,genesis_hash:hash};
 return {ready:true,chain,health:{status:'healthy',chain_state_available:true,fail_closed:false,latest_height:10,chain}};
}
function rpc(report,calls=[],overrides={}){return async(method,params,options)=>{
 calls.push(method);assert.deepEqual(params,[]);assert.equal(options.endpoint,profile.rpc);
 if(Object.hasOwn(overrides,method))return overrides[method];
 if(method==='synergy_chainStatus')return {chain_id:1266,ready:true,lifecycle:'running'};
 if(method==='synergy_getReadiness'){if(report instanceof Error)throw report;return report;}
 return {status:'reported'};
};}
test('pinned Overview requires matching readiness before reading runtime status details',async()=>{
 const calls=[];const result=await readNodeNetwork(rpc(readiness(),calls),profile);
 assert.deepEqual(calls,['synergy_chainStatus','synergy_getReadiness','synergy_nodeStatus','synergy_posyStatus','synergy_syncStatus']);
 assert.equal(result.configuredGenesis,genesis);assert.equal(result.reportedNetwork.genesis,genesis);
 for(const report of [readiness(foreign),null,{},new Error('unavailable')]){
  const blocked=[];
  await assert.rejects(()=>readNodeNetwork(rpc(report,blocked),profile));
  assert.deepEqual(blocked,['synergy_chainStatus','synergy_getReadiness']);
 }
});
test('bad configured pins and wrong chain refuse without later reads',async()=>{
 const calls=[];
 await assert.rejects(()=>readNodeNetwork(rpc(readiness(),calls),{...profile,genesisHash:'bad'}),/Genesis pin is invalid/);
 assert.deepEqual(calls,[]);
 await assert.rejects(()=>readNodeNetwork(rpc(readiness(),calls,{'synergy_chainStatus':{chain_id:99999}}),profile),/Network mismatch/);
 assert.deepEqual(calls,['synergy_chainStatus']);
});
test('unpinned observations preserve partial-status reporting without inventing Genesis assurance',async()=>{
 const calls=[];const result=await readNodeNetwork(rpc(null,calls,{'synergy_posyStatus':null}),{...profile,genesisHash:null});
 assert.equal(calls.includes('synergy_getReadiness'),false);
 assert.equal(result.configuredGenesis,null);assert.equal(result.reportedNetwork,null);
 assert.match(result.errors.posy,/unsupported/);assert.equal(result.observations.node.status,'reported');
});
test('pin/network/permission changes invalidate Overview scope; cancellation never returns stale observations',async()=>{
 const scope=nodeNetworkObservationScope(profile,true);
 for(const changed of [{...profile,genesisHash:foreign},{...profile,networkKey:'other'},{...profile,rpc:'https://other.example'}])assert.notEqual(nodeNetworkObservationScope(changed,true),scope);
 assert.notEqual(nodeNetworkObservationScope(profile,false),scope);
 const controller=new AbortController(),calls=[];
 const request=rpc(readiness(),calls);
 await assert.rejects(()=>readNodeNetwork(async(...args)=>{const result=await request(...args);if(args[0]==='synergy_getReadiness')controller.abort();return result;},profile,controller.signal),{name:'AbortError'});
 assert.deepEqual(calls,['synergy_chainStatus','synergy_getReadiness']);
});


test('legacy validator observations require their own profile and reported Genesis when 1266 is reused',async()=>{
 const endpoint={...profile,id:'testnet',genesisHash:null};
 const legacy=legacyTestnetObservationProfile(endpoint,true);
 const historicalGenesis='2272fe2b48c6e2019b27223f61ba8d8a82b58656fe9daab50c81f224a301ca74';
 assert.equal(legacy.genesisHash,historicalGenesis);
 assert.equal(legacyTestnetObservationProfile({...endpoint,networkKey:'replacement'},true),null);
 assert.equal(legacyTestnetObservationProfile({...endpoint,genesisHash:foreign},true),null);
 assert.equal(legacyTestnetObservationProfile({...endpoint,genesisHash:'invalid'},true),null);
 assert.equal(legacyTestnetObservationProfile(endpoint,false),null);
 assert.equal(await readValidatorGenesisPin(rpc(readiness(historicalGenesis),[],{'synergy_getChainId':'0x4f2'}),legacy),historicalGenesis);
 await assert.rejects(()=>readValidatorGenesisPin(rpc(readiness(foreign),[],{'synergy_getChainId':'0x4f2'}),legacy),/Genesis hash does not match/);
});
