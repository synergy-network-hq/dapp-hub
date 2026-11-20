// This observation never authorizes a route change, removal or bootstrap.
const fields=['schema','challenge','target','machine_id_sha256','plan_sha256','preserved','metrics','legacy','candidate_units','blockers','mutation_performed','removal_authorized','automatic_retry'];
const required=['explicit_retirement_approval_required','legacy_inventory_requires_attribution','metrics_resolution_required'];
const codes=[...required,'foreign_resources','inventory_bound_exceeded','protected_attribution_failed','legacy_attribution_failed','legacy_peer_retirement_required'];
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pin=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const obsoleteUnits = ['synergy-canary-rpc-relay.service', 'synergy-vpn.service'];

export function legacyGatewayServiceView(value, stopping) {
 const units = list => Array.isArray(list) && list.length <= obsoleteUnits.length
  && list.every((unit, index) => obsoleteUnits.includes(unit) && list.indexOf(unit) === index);
 if (!exact(value, ['schema', 'reviewed_sha256', 'services_stopped', 'active_units', 'stopped_units', 'chain1266_verified'])
     || value.schema !== 'nodenetwork-legacy-canary-service-view-v1' || !pin(value.reviewed_sha256)
     || value.chain1266_verified !== true || !units(value.active_units) || !units(value.stopped_units)
     || value.services_stopped !== (value.active_units.length === 0)
     || (stopping ? !value.services_stopped : value.stopped_units.length !== 0)) {
  throw Error('Obsolete Canary service state could not be verified.');
 }
 return value;
}

export function legacyGatewayPlanTarget(target,operator){return target?.kind==='remote'&&target.host==='167.86.83.83'&&(target.port??22)===22&&target.root==='/opt/synergy'&&!target.guest&&operator==='root';}
export function legacyGatewayPlanView(v,target){
 const refuse=()=>{throw Error('Unsupported legacy gateway handoff observation. No retirement or route change is authorized.');};
 const oldOnly=v?.schema==='nodenetwork-legacy-canary-retirement-plan-v1';
 const needed=oldOnly?['explicit_retirement_approval_required','legacy_inventory_requires_attribution','legacy_peer_retirement_required']:required;
 const files=['nginx_rpc','nginx_origin_only','nginx_origin_aop','nginx_source_map','tls_public_certificate','tunnel_unit',...(oldOnly?['canary_frontend']:[])];
 const lp=[...(oldOnly?[]:['chain1266_executable_sha256']),'canary_executable_sha256','canary_unit_sha256','vpn_unit_sha256','lower_root_entries_sha256','upper_root_entries_sha256'];
 if(!legacyGatewayPlanTarget(target,'root')||!exact(v,fields)||(!oldOnly&&v.schema!=='nodenetwork-legacy-gateway-handoff-plan-v1')||!exact(v.target,['kind','host','port','root'])||v.target.kind!==target.kind||v.target.host!==target.host||v.target.port!==(target.port??22)||v.target.root!==target.root||v.machine_id_sha256!=='8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d'||!pin(v.challenge)||!pin(v.plan_sha256)||['mutation_performed','removal_authorized','automatic_retry'].some(k=>v[k]!==false))refuse();
 const p=v.preserved,m=v.metrics,l=v.legacy;
 if(!exact(p,['files','tunnel_active','rpc_listener_owned','ws_listener_owned',...(oldOnly?['rpc_tunnel_pid','metrics_pid']:[])])||!exact(p.files,files)||files.some(k=>!pin(p.files[k]))||['tunnel_active','rpc_listener_owned','ws_listener_owned'].some(k=>typeof p[k]!=='boolean')||!exact(m,['unit_sha256','service_active','listener_owned','consumer_ip','resolution'])||!pin(m.unit_sha256)||typeof m.service_active!=='boolean'||typeof m.listener_owned!=='boolean'||m.consumer_ip!=='209.145.50.9'||m.resolution!=='unresolved'||!exact(l,[...lp,'canary_active','vpn_active',...(oldOnly?['old_network','vpn_binding','canary_pid','vpn_pid']:[])])||lp.some(k=>!pin(l[k]))||typeof l.canary_active!=='boolean'||typeof l.vpn_active!=='boolean'||JSON.stringify(v.candidate_units)!==JSON.stringify([...(oldOnly?[]:['synergy-chain1266-role@rpc-gateway.service']),'synergy-canary-rpc-relay.service','synergy-vpn.service']))refuse();
 if(!Array.isArray(v.blockers)||v.blockers.length>codes.length||needed.some(k=>!v.blockers.includes(k))||v.blockers.some((k,i)=>!codes.includes(k)||(i>0&&v.blockers[i-1]>=k))||(['tunnel_active','rpc_listener_owned','ws_listener_owned'].some(k=>!p[k])&&!v.blockers.includes('protected_attribution_failed'))||(m.listener_owned&&!m.service_active)||(!m.listener_owned&&!v.blockers.includes('legacy_attribution_failed')))refuse();
 if(oldOnly){
  const n=l.old_network,b=l.vpn_binding,pid=x=>Number.isSafeInteger(x)&&x>=0;
  if(!exact(n,['network_id','chain_id','genesis_sha256','node_config_sha256','relay_config_sha256'])||n.network_id!=='posy-apqe-canary-process-49028'||n.chain_id!==99999||n.genesis_sha256!=='d28ab09b6857f670482580a786edd939b090e88aa9378cdd0ad91379a724a9d7'||!pin(n.node_config_sha256)||!pin(n.relay_config_sha256)
   ||!exact(b,['enrollment_sha256','binding_sha256','peer_id','peer_name','hostname','ip','wireguard_public_key','management_origin','retirement_verified'])
   ||b.enrollment_sha256!=='f27a0e0031ba00f2a234e77e55449ca5f4b9a15dec7e2c8da3da5bde6ea37573'||b.binding_sha256!=='1629d857606c040ecbd7ed9d5dc692ac697dda3b129cc1f8b2bb9834e594d5f2'||b.peer_id!=='dboqb9if611ohpqo0e1g'||b.peer_name!=='synergy-canary-rpc-99999'||b.hostname!=='vmi3381382'||b.ip!=='10.69.51.205'||b.wireguard_public_key!=='EhHDd/L7fXX+c8x2nyJx8wWUwGRij3AmioVZKiH4/2M='||b.management_origin!=='https://vpn-coordinator.synergy-network.io'||b.retirement_verified!==false
   ||![l.canary_pid,l.vpn_pid,p.rpc_tunnel_pid,p.metrics_pid].every(pid)||(l.canary_pid!==0)!==l.canary_active||(l.vpn_pid!==0)!==l.vpn_active||(p.metrics_pid!==0)!==m.service_active||(p.tunnel_active&&p.rpc_tunnel_pid===0))refuse();
 }
 return structuredClone(v);
}
