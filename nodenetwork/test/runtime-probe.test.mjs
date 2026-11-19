import {acceptedReview,approvedReviewScope} from '../src/operator-workflow.js';
import {test} from 'node:test';import assert from 'node:assert/strict';import {runtimeProbeView} from '../src/runtime-probe.js';
const parameters={release_id:'candidate',manifest_sha256:'a'.repeat(64)};
function fixture(){return {schema:'nodenetwork-upgrade-native-preflight-v1',...parameters,provider_report_sha256:'b'.repeat(64),network_id:'synergy-posy-canary-test',chain_id:'99999',genesis_sha256:'c'.repeat(64),authority_sha256:'d'.repeat(64),authority_root_sha256:'e'.repeat(64),registry_sha256:'f'.repeat(64),issuer_root_sha256:'1'.repeat(64),network_manifest_sha256:'2'.repeat(64),candidate_node_sha256:'3'.repeat(64),native_origin_verified:true,package_verified:true,mutation_performed:false,keys_generated:false,services_started:false,network_qualified:false,production_qualified:false,automatic_retry:false};}
test('runtime smoke preserves distinct manifests and does not qualify upgrade or network',()=>{const v=runtimeProbeView(fixture(),parameters);assert.notEqual(v.manifest_sha256,v.network_manifest_sha256);assert.equal(v.network_qualified,false);assert.equal(v.keys_generated,false);});
test('runtime smoke rejects foreign selection, incomplete hashes and invented qualification',()=>{
 for(const patch of [{manifest_sha256:'b'.repeat(64)},{release_id:'other'},{chain_id:99999},{network_id:'production'},{registry_sha256:null},{candidate_node_sha256:'bad'},{services_started:true},{keys_generated:true},{network_qualified:true},{production_qualified:true},{automatic_retry:true},{native_origin_verified:false},{full_process_qualified:true}])assert.throws(()=>runtimeProbeView({...fixture(),...patch},parameters));
});

test('runtime smoke cannot satisfy the existing upgrade approval review',()=>{
 assert.equal(acceptedReview('upgrade_native_preflight',parameters,fixture(),{root:'/opt/synergy'}),false);
 assert.equal(acceptedReview('upgrade_preflight',parameters,fixture(),{root:'/opt/synergy'}),false);
 assert.equal(approvedReviewScope('upgrade_native_preflight',parameters),null);
});
