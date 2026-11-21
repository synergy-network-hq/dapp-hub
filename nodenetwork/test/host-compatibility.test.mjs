import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostCompatibility,hostTargetSupported,requireTargetMode} from '../src/host-compatibility.js';

const observed=(platform,localValidatorSupported=false)=>({loading:false,error:null,data:{platform,localValidatorSupported}});
test('native platform observations separate local Linux from remote controller transport',()=>{
 for(const [platform,supported,remote,local] of [['macos',false,true,false],['linux',true,true,true],['linux',false,true,false],['windows',false,false,false],['unknown',false,false,false]]){
  const view=hostCompatibility(observed(platform,supported));
  assert.equal(hostTargetSupported(view,{kind:'local'}),local);
  assert.equal(hostTargetSupported(view,{kind:'remote'}),remote);
  assert.equal(hostTargetSupported(view,null),false);
  assert.equal(hostTargetSupported(view,{kind:'monitor'}),false);
 }
});
test('pending, failed and malformed observations never enable saved target controls',()=>{
 for(const resource of [null,{}, {data:observed('macos').data}, {...observed('macos'),loading:true}, {...observed('macos'),error:'Unavailable'}, observed('macos',true),observed('linux','true'),{loading:false,data:{platform:'macos'}}]){
  const view=hostCompatibility(resource);
  assert.equal(view.local,false);assert.equal(view.remote,false);
  assert.throws(()=>requireTargetMode(view,'remote'));
  assert.throws(()=>requireTargetMode(view,'local'));
  assert.doesNotThrow(()=>requireTargetMode(view,'monitor'));
 }
});
test('monitor-only remains selectable while unsupported target save refuses before persistence',()=>{
 const blocked=hostCompatibility(observed('windows'));
 assert.match(blocked.message,/no qualified native controller transport/);
 assert.match(blocked.message,/Public network monitoring remains available/);
 for(const kind of ['local','remote','foreign'])assert.throws(()=>requireTargetMode(blocked,kind));
 assert.doesNotThrow(()=>requireTargetMode(blocked,'monitor'));
 const mac=hostCompatibility(observed('macos'));
 assert.doesNotThrow(()=>requireTargetMode(mac,'remote'));
 assert.throws(()=>requireTargetMode(mac,'local'));
});

// Exercise the actual settings component without a browser, native invocation or
// persistent test files. Vite is this repository's existing JSX compiler.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transformWithOxc} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const dataUrl=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const sdk=dataUrl(`import React from ${JSON.stringify(new URL(`file://${require.resolve('react')}`).href)};export function Card({children}){return React.createElement('section',null,children)};export function Detail(){return null};export function ErrorMessage(){return null}`);
let {code}=await transformWithOxc(await readFile(new URL('../src/TargetSettings.jsx',import.meta.url),'utf8'),'TargetSettings.jsx',{jsx:{runtime:'automatic'}});
const icons=dataUrl(`import React from ${JSON.stringify(new URL(`file://${require.resolve('react')}`).href)};export function WorkspaceIcon(){return React.createElement('svg',{'aria-hidden':true})}`);
code=code.replace(/['"]\.\/WorkspaceUI\.jsx['"]/g,JSON.stringify(icons)).replace(/['"]@synergy-network\/portal-native\/dapp-sdk['"]/g,JSON.stringify(sdk))
 .replace(/(["'])react(?:\/jsx-runtime)?\1/g,match=>JSON.stringify(new URL(`file://${require.resolve(match.includes('jsx-runtime')?'react/jsx-runtime':'react')}`).href))
 .replace(/(['"])(\.\/[^'"]+)\1/g,(_,quote,path)=>JSON.stringify(new URL(path,new URL('../src/TargetSettings.jsx',import.meta.url)).href));
const {TargetSettings}=await import(dataUrl(code));
function settings(local,kind='remote'){
 return TargetSettings({local,selection:{target:{kind:'remote',host:'saved.example',root:'/opt/synergy'},draft:{kind,host:'saved.example',port:'22'},snapshot:{},updateDraft(){},save(){},loadSavedChoice(){}}});
}
test('actual target settings disables unsupported saves but preserves monitor-only and saved target',()=>{
 const html=renderToStaticMarkup(settings(observed('windows')));
 assert.match(html,/<button[^>]*disabled=""[^>]*>[\s\S]*?This computer/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>[\s\S]*?Remote machine/);
 assert.match(html,/<button disabled="">Save validator target/);
 assert.match(html,/value="saved.example"/);
 assert.match(html,/Public network monitoring remains available/);
 const monitor=renderToStaticMarkup(settings(observed('windows'),'monitor'));
 assert.match(monitor,/<button>Save monitor-only mode/);
 assert.match(monitor,/node keeps running/);
 const mac=renderToStaticMarkup(settings(observed('macos')));
 assert.match(mac,/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Remote machine/);
 assert.match(mac,/<button>Save validator target/);
});
