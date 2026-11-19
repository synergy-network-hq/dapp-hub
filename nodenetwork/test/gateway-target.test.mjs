import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gatewayTargetCapability,gatewayInstallParameters,gatewayGenerateParameters,gatewayCommissionParameters,gatewayTargetView,gatewayInstallView,gatewayInstallStatusView} from '../src/gateway-target.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
function status(state='ready'){
 const value={schema:'nodenetwork-gateway-target-v1',available:true,blocker:null,state,network_id:'synergy-posy-canary-20261117',chain_id:'99999',genesis_sha256:'a'.repeat(64),generation_request_sha256:null,gateway_address:null,enrollment_sha256:null,commission_request_sha256:null,admission_sha256:null,configuration_sha256:null,transport_custody_verified:false,services_started:false,public_listener:false,production_qualified:false,automatic_retry:false};
 if(['identity_ready','commissioned'].includes(state))Object.assign(value,{generation_request_sha256:'b'.repeat(64),gateway_address:'synv5abc123',enrollment_sha256:sha('{"public":true}')});
 if(state==='commissioned')Object.assign(value,{commission_request_sha256:'c'.repeat(64),admission_sha256:'d'.repeat(64),configuration_sha256:'e'.repeat(64),transport_custody_verified:true});
 return value;
}
test('gateway installation keeps existing five fields and cannot silently change the selected network',()=>{
 const form={release_id:'qualified-r1',manifest_sha256:'a'.repeat(64),network_id:'synergy-posy-canary-20261117',chain_id:'99999',node_name:'observer-01'};
 assert.deepEqual(Object.keys(gatewayInstallParameters(form)).sort(),['chain_id','manifest_sha256','network_id','node_name','release_id']);
 for(const changed of [{chain_id:'1266'},{network_id:'different-network'},{manifest_sha256:'not-a-pin'}])assert.throws(()=>gatewayInstallParameters({...form,...changed}));
});
test('gateway generation is scoped to an affirmative native origin read',()=>{
 assert.deepEqual(gatewayGenerateParameters(status()),{genesis_sha256:'a'.repeat(64)});
 for(const bad of [null,{...status(),available:false},status('identity_ready'),{...status(),genesis_sha256:'A'.repeat(64)}])assert.throws(()=>gatewayGenerateParameters(bad));
});
test('gateway commissioning hashes the exact bounded UTF8 public bytes and accepts no custody wrapper',async()=>{
 const admissionJson='{"signed":"public"}\n',configurationJson=JSON.stringify({node_configuration:{mode:'observe'},relay_specification:{listen_address:'127.0.0.1:8552',role:{kind:'gateway'}}});
 const parameters=await gatewayCommissionParameters({admissionJson,configurationJson});
 assert.deepEqual(parameters,{admission_json:admissionJson,admission_sha256:sha(admissionJson),configuration_json:configurationJson,configuration_sha256:sha(configurationJson)});
 for(const input of [{admissionJson:'[]',configurationJson},{admissionJson,configurationJson:'{}'},{admissionJson,configurationJson:JSON.stringify({...JSON.parse(configurationJson),unlock:'secret'})},{admissionJson:'é'.repeat(65537),configurationJson},{admissionJson,configurationJson:configurationJson+'\0'}])await assert.rejects(gatewayCommissionParameters(input));
});
test('target observations distinguish generated custody from native verified commissioning and service activation',async()=>{
 for(const state of ['ready','identity_ready','commissioned'])assert.deepEqual(await gatewayTargetView(status(state)),status(state));
 for(const [key,value]of [['services_started',true],['public_listener',true],['production_qualified',true],['automatic_retry',true],['transport_custody_verified',true],['admission_sha256','d'.repeat(64)],['extra',false],['chain_id',99999]])await assert.rejects(gatewayTargetView({...status('identity_ready'),[key]:value}));
 const exported={...status('identity_ready'),enrollment_json:'{"public":true}'};
 assert.deepEqual(await gatewayTargetView(exported,'gateway_target_export'),exported);
 await assert.rejects(gatewayTargetView({...exported,enrollment_json:'{}'},'gateway_target_export'));
 await assert.rejects(gatewayTargetView({...status(),enrollment_json:'{"public":true}'},'gateway_target_export'));
});
test('reconciliation closes only the exact positively verified generation or commission request',async()=>{
 assert.equal((await gatewayTargetView(status('identity_ready'),'gateway_target_reconcile',{request_sha256:'b'.repeat(64)})).state,'identity_ready');
 assert.equal((await gatewayTargetView(status('commissioned'),'gateway_target_reconcile',{request_sha256:'c'.repeat(64)})).state,'commissioned');
 await assert.rejects(gatewayTargetView(status('commissioned'),'gateway_target_reconcile',{request_sha256:'9'.repeat(64)}));
 const absent={...status(),available:false,blocker:'owner_unavailable',state:'absent',network_id:null,chain_id:null,genesis_sha256:null};
 assert.equal((await gatewayTargetView(absent)).available,false);
 await assert.rejects(gatewayTargetView(absent,'gateway_target_reconcile',{request_sha256:'b'.repeat(64)}));
 await assert.rejects(gatewayTargetView({...absent,state:'uncertain',generation_request_sha256:'b'.repeat(64)}));
});
test('gateway target capabilities require one exact kind on the correct installation state',()=>{
 const state={installed:true,operations:[{operation:'gateway_target_generate',kind:'mutation',available:true}]};
 assert.equal(gatewayTargetCapability(state,'gateway_target_generate'),true);
 for(const bad of [null,{...state,installed:false},{...state,operations:[...state.operations,...state.operations]},{...state,operations:[{operation:'gateway_target_generate',kind:'read',available:true}]}])assert.equal(gatewayTargetCapability(bad,'gateway_target_generate'),false);
 assert.equal(gatewayTargetCapability({installed:false,operations:[{operation:'gateway_install',kind:'mutation',available:true}]},'gateway_install'),true);
 assert.equal(gatewayTargetCapability(state,'gateway_target_start'),false);
});
test('gateway installation evidence cannot be borrowed from a validator or another selected release',()=>{
 const p={release_id:'r1',manifest_sha256:'a'.repeat(64),network_id:'synergy-posy-canary-test',chain_id:99999,node_name:'gateway-01'};
 const v={schema:'nodenetwork-installed-gateway-v1',root:'/opt/synergy',role:'rpc_gateway',release_id:p.release_id,manifest_sha256:p.manifest_sha256,network_id:p.network_id,chain_id:'99999',node_name:p.node_name,declared_members:93,host_integrations_registered:false,consensus_started:false};
 assert.deepEqual(gatewayInstallView(v,'gateway_install',p),v);
 for(const [k,value]of [['role','validator'],['schema','nodenetwork-installed-validator-v1'],['network_id','other'],['consensus_started',true],['host_integrations_registered',true],['declared_members',0]])assert.throws(()=>gatewayInstallView({...v,[k]:value},'gateway_install',p));
 const preflight={release:'r1',root:'/opt/synergy',packageVerified:true,networkSelectionApproved:true,genesisAuthorityVerified:false,activationAuthorized:false};
 assert.deepEqual(gatewayInstallView(preflight,'gateway_install_preflight',p),preflight);assert.throws(()=>gatewayInstallView({...preflight,activationAuthorized:true},'gateway_install_preflight',p));
 const read={request_sha256:'b'.repeat(64)},status={schema:'nodenetwork-gateway-install-status-v1',request_sha256:read.request_sha256,request:{version:1,operation:'gateway_install',parameters:p},installation:v,origin_verified:true,install_audit_verified:true,grant_absent:true,services_started:false};
 assert.deepEqual(gatewayInstallStatusView(status,read),status);
 for(const [k,value]of [['grant_absent',false],['origin_verified',false],['install_audit_verified',false],['request_sha256','c'.repeat(64)],['extra',true]])assert.throws(()=>gatewayInstallStatusView({...status,[k]:value},read));
});
