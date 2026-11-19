import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readNetworkComparison,networkComparisonScope} from '../src/network-comparison.js';
const genesis='a'.repeat(64),foreign='b'.repeat(64);
const selected={id:'selected',rpc:'https://selected.example',chainId:1266,genesisHash:genesis};
const reference={...selected,id:'reference',rpc:'https://reference.example'};
function readiness(hash=genesis,incarnation=5){
 const chain={chain_id:1266,network_id:'synergy-testnet-v3',chain_incarnation:incarnation,genesis_hash:hash};
 return {ready:true,chain,health:{status:'healthy',chain_state_available:true,fail_closed:false,latest_height:10,chain}};
}
function requestFor(reports,calls=[]){return async(method,params,{endpoint})=>{
 calls.push([method,endpoint]);
 if(method==='synergy_getChainId')return 1266;
 assert.equal(method,'synergy_getReadiness');
 return reports[endpoint];
};}
test('configured pins reject shared foreign agreement and independently bind both RPC reports',async()=>{
 const bothForeign=requestFor({[selected.rpc]:readiness(foreign),[reference.rpc]:readiness(foreign)});
 const rejected=await readNetworkComparison(bothForeign,selected,reference);
 assert.equal(rejected.outcome,'unavailable');assert.equal(rejected.selected,null);assert.equal(rejected.reference,null);
 for(const foreignEndpoint of [selected.rpc,reference.rpc]){
  const result=await readNetworkComparison(requestFor({[selected.rpc]:readiness(),[reference.rpc]:readiness(),[foreignEndpoint]:readiness(foreign)}),selected,reference);
  assert.equal(result.outcome,'unavailable');
  assert.equal(foreignEndpoint===selected.rpc?result.selected:result.reference,null);
 }
 const matched=await readNetworkComparison(requestFor({[selected.rpc]:readiness(),[reference.rpc]:readiness()}),selected,reference);
 assert.equal(matched.outcome,'match');assert.equal(matched.selected.chain.genesis,genesis);
});
test('malformed pins refuse before either RPC call and cancellation is not an unavailable result',async()=>{
 for(const endpoint of ['selected','reference']){
  const calls=[];
  await assert.rejects(()=>readNetworkComparison(requestFor({},calls),endpoint==='selected'?{...selected,genesisHash:'bad'}:selected,endpoint==='reference'?{...reference,genesisHash:'bad'}:reference),/Genesis pin is invalid/);
  assert.equal(calls.length,0);
 }
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>readNetworkComparison(requestFor({}),selected,reference,controller.signal),{name:'AbortError'});
});
test('unpinned reports remain observations and differing incarnations remain mismatches',async()=>{
 const unpinned={...selected,genesisHash:null},other={...reference,genesisHash:null};
 const reports={[selected.rpc]:readiness(foreign),[reference.rpc]:readiness(foreign)};
 assert.equal((await readNetworkComparison(requestFor(reports),unpinned,other)).outcome,'match');
 reports[reference.rpc]=readiness(foreign,6);
 const mismatch=await readNetworkComparison(requestFor(reports),unpinned,other);
 assert.equal(mismatch.outcome,'mismatch');assert.deepEqual(mismatch.differences,['incarnation']);
});
test('changing either configured pin or read permission invalidates the displayed comparison scope',()=>{
 const scope=networkComparisonScope(selected,[reference],true);
 assert.notEqual(networkComparisonScope({...selected,genesisHash:foreign},[reference],true),scope);
 assert.notEqual(networkComparisonScope(selected,[{...reference,genesisHash:foreign}],true),scope);
 assert.notEqual(networkComparisonScope(selected,[reference],false),scope);
 assert.equal(networkComparisonScope({...selected},[{...reference}],true),scope);
});
