import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('native VPN IPC carries only selected target and action, handles cancel/refusal without retry',async()=>{
 const calls=[];let response=null;
 globalThis.__nnVpnTest={native:true,invoke:async(...args)=>{calls.push(args);return response;}};
 try{
  const source=(await readFile(new URL('../src/native-services.js',import.meta.url),'utf8')).replace('import {isTauri,invoke} from "@tauri-apps/api/core";', 'const isTauri=()=>globalThis.__nnVpnTest.native;const invoke=(...args)=>globalThis.__nnVpnTest.invoke(...args);');
  const {nodeNetworkVpn}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(`../src/${path.slice(2)}`,import.meta.url).href}${quote}`)).toString('base64')}`);
  const target={kind:'remote',host:'guest.example',port:22,root:'/opt/synergy'};
  assert.equal(await nodeNetworkVpn(target,'enroll'),null);
  assert.deepEqual(calls,[['portal_nodenetwork_vpn',{target,operation:'enroll'}]]);
  response={version:1,ok:false,error:{code:'reconciliation_required',message:'Observe exact original intent'}};
  await assert.rejects(nodeNetworkVpn(target,'reconcile'),/reconciliation_required/);
  assert.equal(calls.length,2);
  await assert.rejects(nodeNetworkVpn(target,'arbitrary-delete'),/Unsupported/);
  assert.equal(calls.length,2);
  globalThis.__nnVpnTest.native=false;
  await assert.rejects(nodeNetworkVpn(target,'retire'),/native Portal/);
  assert.equal(calls.length,2);
 }finally{delete globalThis.__nnVpnTest;}
});
