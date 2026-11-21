import assert from 'node:assert/strict';
import test from 'node:test';
import {queryableValidatorBlock, readValidatorRpcBlock, validatorRpcBlockObservation} from '../src/validator-rpc-block.js';

const address = 'synv' + 'a'.repeat(37);
const digest = 'd'.repeat(64);
const genesis = 'f'.repeat(64);
const chain = {chain_id:1266, network_id:'synergy-testnet-v3', chain_incarnation:5, genesis_hash:genesis};
const expected = {chainId:1266, network:chain.network_id, incarnation:'5', genesis};
const profile = {chainId:1266,rpc:'https://endpoint.example.invalid',genesisHash:genesis};
const row = {number:'5470172', hash:digest};
const block = {
 chain, chain_id:1266, chain_incarnation:'5', block_id:digest, hash:digest, height:5470172, block_index:'5470172',
 validator:address, validator_id:address, finalized:true, finality_status:'finalized', finality_proof_type:'authority_signature',
 source:'canonical_finality_store', finality_source:'canonical_finality_store', transaction_format:'synergy_native_v3',
 release_id:'synergy-testnet-v3-chain-1266', authority_address:address, authority_id:'outside projection', transactions:['outside projection'],
};
const readiness = {chain,ready:true,health:{chain,status:'healthy',chain_state_available:true,fail_closed:false,latest_height:5470172}};

test('returns only the selected validator, block and source context after an exact typed match', () => {
 assert.deepEqual(validatorRpcBlockObservation(block,row,address,expected,1000), {
  address,height:row.number,hash:digest,incarnation:'5',receivedAt:1000,
 });
 for (const value of [{...block,hash:'c'.repeat(64)}, {...block,block_id:'c'.repeat(64)},
  {...block,height:5470173}, {...block,block_index:`${row.number}\n`}]) {
  assert.throws(() => validatorRpcBlockObservation(value,row,address,expected), /height or hash differs/);
 }
 for (const value of [{...block,validator:'synv'+'b'.repeat(37)}, {...block,validator_id:null}, {...block,authority_address:'different'}]) {
  assert.throws(() => validatorRpcBlockObservation(value,row,address,expected), /different validator/);
 }
 for (const value of [{...block,finality_proof_type:'qc'}, {...block,finalized:false}, {...block,source:'legacy_chain'}, {}]) {
  assert.throws(() => validatorRpcBlockObservation(value,row,address,expected), /no supported finalized block attribution/);
 }
 for (const value of [{...block,chain_id:99999}, {...block,chain_incarnation:'6'}, {...block,chain:{...chain,genesis_hash:'a'.repeat(64)}}]) {
  assert.throws(() => validatorRpcBlockObservation(value,row,address,expected), /different chain context/);
 }
 assert.throws(() => validatorRpcBlockObservation(null,row,address,expected), /no block at the indexed height/);
});

test('bounds the numeric request and requires a matching pinned readiness before requesting a block', async () => {
 const calls = [];
 const request = async (method, params, options) => {
  calls.push({method,params,options});
  if (method === 'synergy_getChainId') return '0x4f2';
  if (method === 'synergy_getReadiness') return readiness;
  return block;
 };
 const signal = new AbortController().signal;
 await assert.rejects(readValidatorRpcBlock(request,{...profile,genesisHash:'c'.repeat(64)},address,row,signal), /does not match the configured pin/);
 assert.deepEqual(calls.map(call=>call.method), ['synergy_getChainId','synergy_getReadiness']);
 calls.length = 0;
 for (const malformed of [{...row,number:'9007199254740993'}, {...row,number:'5470172\n'}, {...row,hash:'placeholder'}, {...row,number:0}]) {
  assert.equal(queryableValidatorBlock(malformed),false);
  await assert.rejects(readValidatorRpcBlock(request,profile,address,malformed,signal), /supported height and hash/);
 }
 assert.equal(calls.length,0);
 const matched = await readValidatorRpcBlock(request,profile,address,row,signal);
 assert.equal(matched.height,row.number);
 assert.deepEqual(calls.map(call=>[call.method,call.params]), [['synergy_getChainId',[]],['synergy_getReadiness',[]],['synergy_getBlockByNumber',[5470172]]]);
 assert.ok(calls.every(call=>call.options.endpoint===profile.rpc && call.options.signal===signal));
});
