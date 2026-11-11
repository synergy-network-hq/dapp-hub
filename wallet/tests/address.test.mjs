import test from 'node:test';
import assert from 'node:assert/strict';
import {bech32m} from 'bech32';
import {isValidSynergyAddress} from '../src/wallet-address.js';
import {formatProtectedWalletAddress,formatEvmAccountAddress,parseProtectedWalletAddress} from '../src/public-address/protected-address.js';
import {CONTACT_KEY,readContacts,saveContact,removeContact} from '../src/wallet-contacts.js';

test('protected Wallet addresses are exactly 44 characters with the same EIP-55 body as EVM',()=>{
 const body='52908400098527886E0F7030069857D2E4169EE7';
 const id=Uint8Array.from(Buffer.from(body,'hex'));
 const address=formatProtectedWalletAddress(id);
 assert.equal(address,`synw${body}`);
 assert.equal(address.length,44);
 assert.equal(formatEvmAccountAddress(id),`0x${body}`);
 assert.deepEqual(parseProtectedWalletAddress(address),id);
 assert.throws(()=>formatProtectedWalletAddress(new Uint8Array(19)),/20 bytes/);
 assert.equal(isValidSynergyAddress(address),true);
 for(const bad of [address.toLowerCase(),`synw${'1'.repeat(85)}`,bech32m.encode('synm',Array(30).fill(1))])
  assert.equal(isValidSynergyAddress(bad),false);
 assert.equal(isValidSynergyAddress(bech32m.encode('syna',Array(30).fill(1))),true);
});

test('legacy saved addresses remain visible and removable but cannot become new contacts',()=>{
 const address=bech32m.encode('synw',Array(30).fill(1));
 const saved={id:'test-id',name:'Legacy',address};
 const values=new Map([[CONTACT_KEY,JSON.stringify([saved])]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 assert.equal(isValidSynergyAddress(address),false);
 assert.deepEqual(readContacts(storage),[saved]);
 assert.throws(()=>saveContact(storage,{name:'New',address}),/valid Synergy address/);
 assert.deepEqual(removeContact(storage,saved),[]);
});
