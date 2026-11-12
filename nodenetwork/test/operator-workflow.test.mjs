import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptedReview,approvedReviewScope,checkedTarget,diagnosticsView,identityStatusView,identityView,NODE_ROLES,nodeRoleCatalog,vpnView,workflowGate} from '../src/operator-workflow.js';
import {emptyProvisioningDraft} from '../src/provisioning-draft.js';
import {installParameters,nodeNetworkTarget} from '../src/nodeNetwork.js';

const form={release_id:'release-42',manifest_sha256:'b'.repeat(64),network_id:'test-rotation-b',chain_id:'1266',node_name:'operator-node-42'};
const target=nodeNetworkTarget({kind:'remote',host:'target.example',port:'2202'});
const targetState=(installed,...ops)=>checkedTarget({controllerVersion:1,root:target.root,installed,operations:ops.map(operation=>({operation,available:true}))},target);
const gate=(operation,options={})=>workflowGate({target,form,operation,permitted:true,...options});
const review=(operation,parameters={})=>({target:JSON.stringify(target),scope:approvedReviewScope(operation,parameters)});

test('identity generation sends only the digest reviewed on this target',()=>{
 const state=targetState(true,'identity_generate','identity_preflight');
 const selection={genesis_authority_verified:true,network_id:'test-identity',chain_id:'999999',genesis_sha256:'7'.repeat(64)};
 const checked=identityView(selection,false);
 assert.equal(gate('identity_generate',{state}).available,false);
 assert.equal(gate('identity_generate',{state,identityReview:{...checked,target:'other host'}}).available,false);
 assert.deepEqual(gate('identity_generate',{state,identityReview:{...checked,target:JSON.stringify(target)}}).parameters,{genesis_sha256:selection.genesis_sha256});
 const result={...selection,address:'synv11lrh6jcxaejkj4zv994j7qwn2rk6u3ar4emn',possession_verified:true,membership_granted:false};
 assert.deepEqual(identityView({...result,unlock:'must not render'},true),result);
 assert.throws(()=>identityView({...result,membership_granted:true},true));
 assert.deepEqual(identityStatusView({pending:false}),{pending:false});
 assert.deepEqual(identityStatusView({...result,pending:true,unlock:'must not render'}),{...result,pending:true});
 assert.throws(()=>identityStatusView({pending:true}));
});

test('validator role comes first and blank draft cannot select an observation network',()=>{
 assert.equal(NODE_ROLES[0].id,'validator');
 assert.ok(NODE_ROLES.slice(1).every(role=>role.description.includes('unavailable')));
 assert.deepEqual(nodeRoleCatalog(['archive','validator','observer_light']).map(role=>role.id),['validator','archive','observer_light']);
 assert.equal(nodeRoleCatalog(['validator','validator']),NODE_ROLES);
 assert.equal(emptyProvisioningDraft().chain_id,'');
 assert.throws(()=>installParameters({...form,chain_id:''}));
 assert.equal(installParameters(form).chain_id,1266);
 assert.equal(installParameters({...form,chain_id:'1000007'}).chain_id,1000007);
});

test('unsupported, missing, and ambiguous target capability fail closed',()=>{
 assert.throws(()=>checkedTarget({controllerVersion:1,root:'/tmp/Synergy',installed:true,operations:[]},target));
 assert.throws(()=>checkedTarget({controllerVersion:1,root:target.root,operations:[]},target));
 assert.equal(gate('start').available,false);
 assert.equal(gate('start',{state:targetState(true,'start','start')}).available,false);
 assert.equal(gate('start',{permitted:false,state:targetState(true,'start')}).available,false);
 assert.equal(gate('start',{state:targetState(false,'start')}).available,false);
 assert.equal(gate('start',{state:targetState(true,'start')}).available,true);
});

test('install review affirms exact release and binds exact target and all install parameters',()=>{
 const state=targetState(false,'install','install_preflight');
 const parameters=installParameters(form);
 const response={packageVerified:true,networkSelectionApproved:true,release:form.release_id,root:target.root,activationAuthorized:false};
 assert.ok(acceptedReview('install_preflight',parameters,response,target));
 for(const bad of [{...response,release:'other'},{...response,root:'/tmp/Synergy'},{...response,networkSelectionApproved:false},{...response,packageVerified:'true'}])assert.equal(acceptedReview('install_preflight',parameters,bad,target),false);
 assert.equal(gate('install_preflight',{state}).available,true);
 assert.equal(gate('install',{state}).available,false);
 const same=review('install_preflight',parameters);
 assert.deepEqual(gate('install',{state,review:same}),{available:true,parameters});
 for(const changes of [{chain_id:'4242'},{network_id:'different-network'},{node_name:'other'},{manifest_sha256:'c'.repeat(64)},{release_id:'other'}])assert.equal(gate('install',{state,review:same,form:{...form,...changes}}).available,false);
 assert.equal(gate('install',{state,review:same,target:{...target,port:22}}).available,false);
 assert.equal(gate('install',{state:targetState(true,'install'),review:same}).available,false);
});

test('upgrade uses only release inputs; removal requires review and exact root confirmation',()=>{
 const state=targetState(true,'upgrade','upgrade_preflight','uninstall','uninstall_preflight');
 const parameters={release_id:form.release_id,manifest_sha256:form.manifest_sha256};
 const same=review('upgrade_preflight',parameters);
 assert.ok(acceptedReview('upgrade_preflight',parameters,{packageVerified:true,release:form.release_id,automaticRestart:false},target));
 assert.deepEqual(gate('upgrade',{state,review:same,form:{...form,network_id:'',chain_id:'',node_name:''}}),{available:true,parameters});
 assert.equal(gate('upgrade',{state,review:review('uninstall_preflight')}).available,false);
 assert.equal(gate('uninstall',{state,confirmation:target.root}).available,false);
 assert.equal(gate('uninstall',{state,confirmation:target.root+'/',review:review('uninstall_preflight')}).available,false);
 assert.deepEqual(gate('uninstall',{state,confirmation:target.root,review:review('uninstall_preflight')}),{available:true,parameters:{confirmation:target.root}});
 assert.equal(acceptedReview('uninstall_preflight',{}, {root:target.root,destructive:true},target),false);
 assert.ok(acceptedReview('uninstall_preflight',{}, {root:target.root,destructive:true,inventory:{root:target.root,members:[]}},target));
});

test('VPN response accepts CIDR and exposes only typed status fields',()=>{
 const status={schema:'nodenetwork-vpn-status-v1',service_registered:true,enrollment_staged:false,enrollment_recorded:true,reconciliation_required:false,server_bound:true,connected:true,overlay_address:'100.80.10.4/16',unexpected:'ignored'};
 assert.equal(vpnView(status).overlay_address,status.overlay_address);
 assert.equal(vpnView(status).unexpected,undefined);
 assert.throws(()=>vpnView({...status,connected:'true'}));
 assert.throws(()=>vpnView({...status,overlay_address:'https://example.org'}));
 assert.equal(gate('vpn_enroll',{state:targetState(true,'vpn_status')}).available,false);
 const state=targetState(true,'vpn_enroll');
 const vpnStatus={...status,enrollment_staged:true,enrollment_recorded:false,server_bound:false,connected:false,overlay_address:null};
 assert.equal(gate('vpn_enroll',{state}).available,false);
 assert.equal(gate('vpn_enroll',{state,vpnStatus:{...vpnStatus,reconciliation_required:true}}).available,false);
 assert.deepEqual(gate('vpn_enroll',{state,vpnStatus}),{available:true,parameters:{}});
});

test('diagnostics preserve unavailable measurements and exact chain IDs without rendering raw logs',()=>{
 const input={schema:'nodenetwork-diagnostics-v1',observed_at_ms:123,installation:{chain_id:'18446744073709551615'},services:{node:{pid:42,memory_bytes:-1,cpu_usage_ns:0}},log:{available:true,raw:'never rendered',window_bytes:1024,severity:{warn:1}}};
 const value=diagnosticsView(input);
 assert.equal(value.installation.chain_id,input.installation.chain_id);
 assert.equal(value.services.node.pid,42);
 assert.equal(value.services.node.memory_bytes,null);
 assert.equal(value.services.node.cpu_usage_ns,0);
 assert.equal(value.services.vpn.pid,null);
 assert.equal(value.log.raw,undefined);
 assert.equal(value.log.severity.warn,1);
 assert.equal(value.log.severity.error,null);
 assert.equal(diagnosticsView({...input,log:{available:false}}).log,null);
 assert.throws(()=>diagnosticsView({...input,observed_at_ms:Infinity}));
 assert.throws(()=>diagnosticsView({...input,schema:'unqualified'}));
});
