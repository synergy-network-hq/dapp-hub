import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {nodeNetworkTarget} from '../src/nodeNetwork.js';
test('managed guest selection persists physical identity and refuses direct or malformed substitutions',()=>{
 const bytes=Buffer.concat([Buffer.from('\0\0\0\x0bssh-ed25519\0\0\0 '),Buffer.alloc(32,7)]);
 const guest={guest_id:'validator-guest',create_request_sha256:'a'.repeat(64),ssh_host_public_key:`ssh-ed25519 ${bytes.toString('base64')}`,ssh_host_fingerprint:`SHA256:${createHash('sha256').update(bytes).digest('base64').replace(/=+$/,'')}`};
 const physical={kind:'remote',host:'host.example',port:2222,root:'/opt/synergy'};
 assert.deepEqual(nodeNetworkTarget(physical),physical);
 assert.deepEqual(nodeNetworkTarget({...physical,guest}),{...physical,guest});
 assert.equal(nodeNetworkTarget({...physical,guest}).host,'host.example');
 assert.throws(()=>nodeNetworkTarget({...physical,guest:{...guest,endpoint:'127.0.0.1:22'}}),/malformed/);
 assert.throws(()=>nodeNetworkTarget({kind:'local',guest}),/physical host/);
 assert.throws(()=>nodeNetworkTarget({...physical,guest:{...guest,create_request_sha256:'not-a-receipt'}}),/malformed/);
});
test('selection uses only dedicated native review and never flattens guest endpoint',async()=>{
 let calls=0;globalThis.__nnSelect={native:true,invoke:async(command,args)=>{calls++;assert.equal(command,'portal_nodenetwork_select_guest');assert.deepEqual(args,{target:{kind:'remote',host:'host.example'},guestId:'validator-guest'});return null;}};
 try{
 const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";','const isTauri=()=>globalThis.__nnSelect.native;const invoke=(...args)=>globalThis.__nnSelect.invoke(...args);');
 const {nodeNetworkSelectGuest}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 assert.equal(await nodeNetworkSelectGuest({kind:'remote',host:'host.example'},'validator-guest'),null);assert.equal(calls,1);
 await assert.rejects(nodeNetworkSelectGuest({guest:{}},'validator-guest'),/physical host/);assert.equal(calls,1);
 globalThis.__nnSelect.native=false;await assert.rejects(nodeNetworkSelectGuest({},'validator-guest'),/native Portal/);
 }finally{delete globalThis.__nnSelect;}
});
