import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {compareSavedVpnRetirement,savedVpnRecordLimit,savedVpnRetirementPins} from '../src/saved-vpn-retirement.js';
import {vpnBindingRecord,vpnFixturePeerId,vpnRecordFile,vpnRetirementRecord} from './fixtures/saved-vpn-retirement.mjs';

const binding=()=>vpnRecordFile(`${JSON.stringify(vpnBindingRecord)}\n`);
const retirement=(claims=vpnRetirementRecord)=>vpnRecordFile(JSON.stringify(claims));
const reviewed={bindingStatus:'matched',retirementStatus:'matched',peerMatches:true,retired:true,absenceVerified:true};
const pins=(b,r)=>({bindingPin:b.pin,retirementPin:r.pin});
const compare=(b,r,current)=>compareSavedVpnRetirement({binding:b,retirement:r},pins(b,r),current);

test('compares exact pinned owner binding and retirement while returning only verdicts', async()=>{
 const b=binding(),r=retirement();
 assert.notEqual(b.pin,r.pin);
 assert.deepEqual(savedVpnRetirementPins(b.pin.toUpperCase(),r.pin),pins(b,r));
 assert.equal(savedVpnRetirementPins(b.pin,`${r.pin}\n`),null);
 assert.equal(savedVpnRetirementPins('',r.pin),null);
 const result=await compare(b,r);
 assert.deepEqual(result,reviewed);
 assert.doesNotMatch(JSON.stringify(result),/fixture|100\.80|[a-f0-9]{64}/);
 assert.deepEqual(await compare(b,retirement({...vpnRetirementRecord,peer_id:vpnFixturePeerId.toUpperCase()})),{...reviewed,peerMatches:false});
});

test('separates independently supplied digest mismatches from unsupported matching bytes', async()=>{
 const b=binding(),r=retirement();
 assert.deepEqual(await compareSavedVpnRetirement({binding:b,retirement:r},{bindingPin:r.pin,retirementPin:b.pin}),{
  bindingStatus:'pin-mismatch',retirementStatus:'pin-mismatch',peerMatches:null,retired:null,absenceVerified:null,
 });
 const matchingTrimmed=vpnRecordFile(new TextDecoder().decode(b.bytes).trimEnd());
 assert.deepEqual(await compareSavedVpnRetirement({binding:matchingTrimmed,retirement:r},pins(b,r)),{
  ...reviewed,bindingStatus:'pin-mismatch',peerMatches:null,
 });
 const badBinding=vpnRecordFile(JSON.stringify({...vpnBindingRecord,management_public_key_exposed:true}));
 assert.deepEqual(await compare(badBinding,r),{...reviewed,bindingStatus:'format-unsupported',peerMatches:null});
});

test('distinguishes false and absent owner flags and rejects non-Boolean claims', async()=>{
 const b=binding();
 assert.deepEqual(await compare(b,retirement({peer_id:vpnFixturePeerId,retired:false,absence_verified:false,metadata:{private:'unreported'}})),
  {...reviewed,retired:false,absenceVerified:false});
 assert.deepEqual(await compare(b,retirement({peer_id:vpnFixturePeerId})),{...reviewed,retired:null,absenceVerified:null});
 for (const invalid of [1,'true',null,[]]) {
  const result=await compare(b,retirement({...vpnRetirementRecord,absence_verified:invalid}));
  assert.deepEqual(result,{...reviewed,retirementStatus:'format-unsupported',peerMatches:null,retired:null,absenceVerified:null});
 }
 for (const invalid of [1,'   ',undefined,'unexpected\nline']) {
  const result=await compare(b,retirement({...vpnRetirementRecord,peer_id:invalid}));
  assert.equal(result.retirementStatus,'format-unsupported');
 }
});

test('rejects ambiguous JSON, malformed UTF-8, wrong shapes and files outside bounds', async()=>{
 const b=binding(),r=retirement();
 const duplicate=vpnRecordFile(`{"peer_id":"ignored","peer_\\u0069d":"${vpnFixturePeerId}","retired":true,"absence_verified":true}`);
 const duplicateMetadata=vpnRecordFile(`{"peer_id":"${vpnFixturePeerId}","details":{"claim":1,"claim":2}}`);
 const oversized=vpnRecordFile(' '.repeat(savedVpnRecordLimit+1));
 for (const malformed of [duplicate,duplicateMetadata,vpnRecordFile([0xc0,0xb0]),vpnRecordFile('[true]'),
  vpnRecordFile(`{"peer_id":"${vpnFixturePeerId}","metadata":${'['.repeat(9)}0${']'.repeat(9)}}`)]) {
  assert.equal((await compare(b,malformed)).retirementStatus,'format-unsupported');
 }
 for (const invalid of [vpnRecordFile(JSON.stringify({...vpnBindingRecord,unexpected:true})),
  vpnRecordFile(JSON.stringify({...vpnBindingRecord,binding_method:'changed'})),
  vpnRecordFile(JSON.stringify({...vpnBindingRecord,peer_id:10}))]) {
  assert.equal((await compare(invalid,r)).bindingStatus,'format-unsupported');
 }
 const guarded={...oversized,arrayBuffer:()=>{assert.fail('read beyond preflight size limit');}};
 assert.equal((await compare(b,guarded)).retirementStatus,'unavailable');
 assert.equal((await compare({...b,size:b.size+1},r)).bindingStatus,'unavailable');
});

test('checks the attribution writer metadata while keeping arbitrary provider evidence private', async()=>{
 const fromBinding=overrides=>vpnRecordFile(JSON.stringify({...vpnBindingRecord,...overrides}));
 const r=retirement();
 const malformed=[{wireguard_public_key:null},{wireguard_public_key:1},{hostname:'{"host":"pretend"}'},
  {hostname:{}},{peer_name:'wrong name'},{peer_name:'fixture-name\n'},{ip:100},{ip:'127.1'},
  {ip:'0x7f.0.0.1'},{ip:'100.80.0.256'},{ip:'100.80.0.12/24'},{ip:'fd00:::12'}];
 for (const invalid of malformed) {
  assert.deepEqual(await compare(fromBinding(invalid),r),{...reviewed,bindingStatus:'format-unsupported',peerMatches:null});
 }
 assert.deepEqual(await compare(fromBinding({ip:'fd00::12',hostname:'managed.fixture.local',
  one_off_usage_evidence:{internalReceipt:'unprojected',counter:1}}),r),reviewed);
});

test('retiring permission during the first local read suppresses the second read and result', async()=>{
 const b=binding(),r=retirement();
 let finish,readRetirement=false,current=true;
 const reviewing=compare({...b,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})},
  {...r,arrayBuffer:()=>{readRetirement=true;return r.arrayBuffer();}},()=>current);
 current=false;
 finish(await b.arrayBuffer());
 await assert.rejects(reviewing,/no longer current/);
 assert.equal(readRetirement,false);
});

const ownerDirectory=process.env.SYNERGY_VPN_RETIREMENT_OWNER_FIXTURES;
if (ownerDirectory) test('complies with pinned bind_server output and lifecycle retirement guard scratch cases',async()=>{
 const read=name=>vpnRecordFile(readFileSync(join(ownerDirectory,name)));
 const b=read('vpn-server-binding.json');
 assert.deepEqual(await compare(b,read('vpn-retirement.json')),reviewed);
 assert.deepEqual(await compare(b,read('vpn-retirement-wrong-peer.json')),{...reviewed,peerMatches:false});
 assert.deepEqual(await compare(b,read('vpn-retirement-not-absent.json')),{...reviewed,absenceVerified:false});
 assert.deepEqual(await compare(b,read('vpn-retirement-not-reported.json')),{...reviewed,absenceVerified:null});
 assert.deepEqual(await compare(b,read('vpn-retirement-not-boolean.json')),{
  ...reviewed,retirementStatus:'format-unsupported',peerMatches:null,retired:null,absenceVerified:null,
 });
});
