import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessRelease,RELEASE_REPOSITORY} from './release-policy.js';

const candidate=()=>({
 capabilities:['readWallet'],
 version:'1.0.0',
 artifact:{url:`${RELEASE_REPOSITORY}/releases/download/v1.0.0/app.tar`,sha256:'a'.repeat(64),bytes:100},
 signature:{provider:'APQE',algorithm:'ML-DSA-87',keyId:'test',value:Buffer.alloc(4627).toString('base64')},
 qualification:{profile:'test',reportSha256:'b'.repeat(64)},
});

test('unsigned discovery never authorizes installation',()=>{
 const result=assessRelease(null);assert.equal(result.installationAuthorized,false);assert.equal(result.metadataValid,false);
});
test('even structurally complete metadata needs native APQE and qualification',()=>{
 const release=candidate();
 assert.equal(assessRelease(release).metadataValid,true);assert.equal(assessRelease(release).installationAuthorized,false);
 assert.equal(assessRelease({...release,notes:'Line one\nLine two'}).metadataValid,true);
 assert.equal(assessRelease({...release,notes:'🌱'.repeat(1001)}).metadataValid,false);
 release.signature.algorithm='Ed25519';assert.equal(assessRelease(release).metadataValid,false);
});
test('mutable or foreign artifact URLs are rejected',()=>{
 for(const url of ['http://github.com/a','https://evil.example/app.tar',`${RELEASE_REPOSITORY}/releases/latest/download/app.tar`])assert.equal(assessRelease({version:'1.0.0',artifact:{url}}).metadataValid,false);
});

test('accepts explicit schema 2 with a subset of required capabilities as inert metadata',()=>{
 const release={...candidate(),manifestSchemaVersion:2,capabilities:['readWallet','externalLinks'],requiredCapabilities:['readWallet']};
 const checked=assessRelease(release);
 assert.equal(checked.metadataValid,true);
 assert.equal(checked.installationAuthorized,false);
 assert.equal(assessRelease({...release,requiredCapabilities:['externalLinks','readWallet']}).metadataValid,true);
 assert.equal(assessRelease({...release,appId:'wallet',publisher:'Fixture'}).metadataValid,true);
});

test('rejects implicit or unsupported manifest schema markers',()=>{
 for(const fields of [
  {requiredCapabilities:['readWallet']},
  {schemaVersion:2},
  {manifestSchemaVersion:2},
  {manifestSchemaVersion:1},
  {manifestSchemaVersion:1,requiredCapabilities:['readWallet']},
  {manifestSchemaVersion:3,requiredCapabilities:['readWallet']},
  {manifestSchemaVersion:'2',requiredCapabilities:['readWallet']},
  {schemaVersion:1,manifestSchemaVersion:2,requiredCapabilities:['readWallet']},
 ]){
  assert.equal(assessRelease({...candidate(),...fields}).metadataValid,false,JSON.stringify(fields));
 }
});

test('rejects empty, duplicate, unknown, or undeclared required capabilities and artifact version drift',()=>{
 const release={...candidate(),manifestSchemaVersion:2,requiredCapabilities:['readWallet']};
 for(const requiredCapabilities of [[],['readWallet','readWallet'],['shell'],['readNetwork'],['ReadWallet'],'readWallet',[null]]){
  assert.equal(assessRelease({...release,requiredCapabilities}).metadataValid,false,JSON.stringify(requiredCapabilities));
 }
 assert.equal(assessRelease({...release,version:'1.0.1'}).metadataValid,false);
});
