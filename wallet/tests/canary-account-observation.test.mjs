import test from 'node:test';
import assert from 'node:assert/strict';
import {canaryAccountObservation as observe} from '../src/canary-account-observation.js';
const address='syna1ppppppppppppppppppppppppppppppk7ss68';
const account={address,balance_nwei:'0',nonce:0,finalized_height:1661,finalized_block_hash:'a'.repeat(64),state_root:'b'.repeat(64)};
test('missing account stays distinct from a real zero and projects only actual finalized fields',()=>{
 assert.deepEqual(observe(null,address),{kind:'not_observed',address});
 assert.deepEqual(observe({...account,authorization_binding:{},code_hash:null},address),{kind:'reported',address,balanceNwei:'0',nonce:0,finalizedHeight:1661,finalizedBlockHash:'a'.repeat(64),stateRoot:'b'.repeat(64)});
 assert.equal(observe({...account,balance_nwei:((1n<<128n)-1n).toString()},address).kind,'reported');
});
test('foreign, absent, malformed and overflowing finalized evidence fails closed',()=>{
 for (const patch of [{address:'foreign'},{balance_nwei:'01'},{balance_nwei:'-1'},{balance_nwei:'1e3'},{balance_nwei:(1n<<128n).toString()},{balance_nwei:0},{nonce:-1},{nonce:2**53},{finalized_height:2**53},{finalized_height:null},{finalized_block_hash:'a'.repeat(63)},{state_root:'B'.repeat(64)}]) assert.throws(()=>observe({...account,...patch},address));
 for(const field of Object.keys(account)){const value={...account};delete value[field];assert.throws(()=>observe(value,address));}
 for(const value of [undefined,{},[],false]) assert.throws(()=>observe(value,address));
});
