// This observation never authorizes a route change, removal or bootstrap.
const fields=['schema','challenge','target','machine_id_sha256','plan_sha256','preserved','metrics','legacy','candidate_units','blockers','mutation_performed','removal_authorized','automatic_retry'];
const required=['explicit_retirement_approval_required','legacy_inventory_requires_attribution','metrics_resolution_required'];
const codes=[...required,'foreign_resources','inventory_bound_exceeded','protected_attribution_failed','legacy_attribution_failed'];
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pin=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function legacyGatewayPlanTarget(target,operator){return target?.kind==='remote'&&target.host==='167.86.83.83'&&(target.port??22)===22&&target.root==='/opt/synergy'&&!target.guest&&operator==='root';}
export function legacyGatewayPlanView(v,target){
 const refuse=()=>{throw Error('Unsupported legacy gateway handoff observation. No retirement or route change is authorized.');};
 const files=['nginx_rpc','nginx_origin_only','nginx_origin_aop','nginx_source_map','tls_public_certificate','tunnel_unit'];
 const lp=['chain1266_executable_sha256','canary_executable_sha256','canary_unit_sha256','vpn_unit_sha256','lower_root_entries_sha256','upper_root_entries_sha256'];
 if(!legacyGatewayPlanTarget(target,'root')||!exact(v,fields)||v.schema!=='nodenetwork-legacy-gateway-handoff-plan-v1'||!exact(v.target,['kind','host','port','root'])||v.target.kind!==target.kind||v.target.host!==target.host||v.target.port!==(target.port??22)||v.target.root!==target.root||v.machine_id_sha256!=='8683ea9f4da9e9c05c26b6d8070cc13c0f5f75b0cd4a4de863492164f4c1e26d'||!pin(v.challenge)||!pin(v.plan_sha256)||['mutation_performed','removal_authorized','automatic_retry'].some(k=>v[k]!==false))refuse();
 const p=v.preserved,m=v.metrics,l=v.legacy;
 if(!exact(p,['files','tunnel_active','rpc_listener_owned','ws_listener_owned'])||!exact(p.files,files)||files.some(k=>!pin(p.files[k]))||['tunnel_active','rpc_listener_owned','ws_listener_owned'].some(k=>typeof p[k]!=='boolean')||!exact(m,['unit_sha256','service_active','listener_owned','consumer_ip','resolution'])||!pin(m.unit_sha256)||typeof m.service_active!=='boolean'||typeof m.listener_owned!=='boolean'||m.consumer_ip!=='209.145.50.9'||m.resolution!=='unresolved'||!exact(l,[...lp,'canary_active','vpn_active'])||lp.some(k=>!pin(l[k]))||typeof l.canary_active!=='boolean'||typeof l.vpn_active!=='boolean'||JSON.stringify(v.candidate_units)!==JSON.stringify(['synergy-chain1266-role@rpc-gateway.service','synergy-canary-rpc-relay.service','synergy-vpn.service']))refuse();
 if(!Array.isArray(v.blockers)||v.blockers.length>codes.length||required.some(k=>!v.blockers.includes(k))||v.blockers.some((k,i)=>!codes.includes(k)||(i>0&&v.blockers[i-1]>=k))||(['tunnel_active','rpc_listener_owned','ws_listener_owned'].some(k=>!p[k])&&!v.blockers.includes('protected_attribution_failed'))||(m.listener_owned&&!m.service_active)||(!m.listener_owned&&!v.blockers.includes('legacy_attribution_failed')))refuse();
 return structuredClone(v);
}
