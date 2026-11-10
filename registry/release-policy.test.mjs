import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessRelease,RELEASE_REPOSITORY} from './release-policy.js';
test('unsigned discovery never authorizes installation',()=>{
 const result=assessRelease(null);assert.equal(result.installationAuthorized,false);assert.equal(result.metadataValid,false);
});
test('even structurally complete metadata needs native APQE and qualification',()=>{
 const release={capabilities:['readWallet'],version:'1.0.0',artifact:{url:`${RELEASE_REPOSITORY}/releases/download/v1.0.0/app.tar`,sha256:'a'.repeat(64),bytes:100},signature:{provider:'APQE',algorithm:'ML-DSA-87',keyId:'test',value:Buffer.alloc(4627).toString('base64')},qualification:{profile:'test',reportSha256:'b'.repeat(64)}};
 assert.equal(assessRelease(release).metadataValid,true);assert.equal(assessRelease(release).installationAuthorized,false);
 release.signature.algorithm='Ed25519';assert.equal(assessRelease(release).metadataValid,false);
});
test('mutable or foreign artifact URLs are rejected',()=>{
 for(const url of ['http://github.com/a','https://evil.example/app.tar',`${RELEASE_REPOSITORY}/releases/latest/download/app.tar`])assert.equal(assessRelease({version:'1.0.0',artifact:{url}}).metadataValid,false);
});
