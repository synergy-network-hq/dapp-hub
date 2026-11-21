import {test} from 'node:test';
import assert from 'node:assert/strict';
import {vpnDiagnosticsView} from '../src/operator-workflow.js';
const address=i=>`synv1${'a'.repeat(20)}${i}`;
const key='A'.repeat(43)+'=';
const match={wireguard_public_key:key,public_key_format_valid:true,status:'Connected'};
function fixture(){return {schema:'nodenetwork-vpn-diagnostics-v1',observed_at_ms:123,enrollment:{service_registered:true,enrollment_staged:false,enrollment_recorded:true,reconciliation_required:false,server_bound:true},trust:{mode:'approved_private_ca',error_code:null},client:{available:true,management_connected:true,signal_connected:true,wireguard_public_key:key,overlay_address:'10.69.1.1/16',error_code:null},peers:[{ip:'10.69.51.205',route_via_wt0:true,reachable:true,error_code:null}],log:{available:false,modified_at_ms:null,sampled_bytes:0,codes:[]},mutation_performed:false,roster:{available:true,error_code:null,source:'approved_signed_transport',peer_status_sample:'before_probes',local_address:address(0),peers:Array.from({length:4},(_,i)=>({address:address(i+1),ip:`10.69.1.${i+2}`,match_count:1,matches:[{...match}],route_via_wt0:true,reachable:true,error_code:null}))}};}
test('signed roster diagnostics retain failed rows separately from baseline peer observations',()=>{
 const input=fixture();input.roster.peers[0]={...input.roster.peers[0],match_count:0,matches:[],route_via_wt0:false,reachable:false,error_code:'peer_missing'};
 input.roster.peers[1]={...input.roster.peers[1],match_count:7,matches:Array.from({length:5},()=>({...match})),error_code:'peer_duplicate'};
 input.roster.peers[2].matches=[{wireguard_public_key:null,public_key_format_valid:false,status:'unknown'}];input.roster.peers[2].error_code='peer_not_connected';
 input.roster.peers[3]={...input.roster.peers[3],reachable:false,error_code:'peer_unreachable'};
 const result=vpnDiagnosticsView(input);assert.deepEqual(result.roster,input.roster);assert.equal(result.peers[0].ip,'10.69.51.205');assert.equal(result.roster.peers.length,4);assert.equal(result.mutation_performed,false);
 assert.ok(!Object.hasOwn(result,'readiness_verified'));assert.ok(!Object.hasOwn(result,'identity_verified'));
 const old=fixture();delete old.roster;assert.ok(!Object.hasOwn(vpnDiagnosticsView(old),'roster'));
});
test('unavailable roster scope/status stays visible without fabricating connectivity or identity',()=>{
 for(const error_code of ['scope_unavailable','status_unavailable']){const input=fixture();input.roster={available:false,error_code,source:'approved_signed_transport',peer_status_sample:'before_probes',local_address:error_code==='scope_unavailable'?null:address(0),peers:[]};assert.deepEqual(vpnDiagnosticsView(input).roster,input.roster);}
});
test('roster projection refuses unknown/private fields, malformed public keys, bounds and foreign sources',()=>{
 const changes=[r=>r.source='unreviewed_provider',r=>r.peer_status_sample='after_probes',r=>r.error_code='token=secret',r=>r.private_key='secret',r=>r.peers.pop(),r=>r.peers[0].ip='https://arbitrary',r=>r.peers[0].address=r.local_address,r=>r.peers[1].address=r.peers[0].address,r=>r.peers[1].ip=r.peers[0].ip,r=>r.peers[0].match_count=1025,r=>r.peers[0].match_count=2,r=>r.peers[0].matches[0].status='raw secret',r=>r.peers[0].matches[0].private_key='secret',r=>r.peers[0].matches[0].public_key_format_valid=false,r=>r.peers[0].matches[0].wireguard_public_key='raw secret',r=>r.peers[0].matches[0].wireguard_public_key='A'.repeat(42)+'B=',r=>{r.peers[0].route_via_wt0=false;r.peers[0].reachable=true;},r=>r.available=false];
 for(const change of changes){const input=fixture();change(input.roster);assert.throws(()=>vpnDiagnosticsView(input),/unsupported VPN diagnostics/);}
});
