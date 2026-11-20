const fields=['schema','plan_sha256','provider_sha256','account_id','peer_id','ready','account_verified','peer_verified','public_key_verified','blocker','mutation_performed','retirement_authorized'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pin=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function legacyPeerPreflightView(v){
 if(!exact(v,fields)||v.schema!=='nodenetwork-legacy-peer-retirement-preflight-v1'||!pin(v.plan_sha256)||!pin(v.provider_sha256)||v.account_id!=='da99e12f611ghl16dvjg'||v.peer_id!=='dboqb9if611ohpqo0e1g'||['ready','public_key_verified','mutation_performed','retirement_authorized'].some(k=>v[k]!==false)||v.account_verified!==true||v.peer_verified!==true||v.blocker!=='independent_peer_key_binding_unavailable')throw Error('Unsupported legacy peer prerequisites. No retirement is authorized.');
 return structuredClone(v);
}

export function legacyPeerKeyView(value) {
 const fields = [
  'schema', 'plan_sha256', 'account_id', 'peer_id', 'wireguard_public_key_sha256',
  'ip', 'peer_name', 'provider_binary_sha256', 'provider_revision',
  'verified', 'mutation_performed', 'retirement_authorized',
 ];
 if (!exact(value, fields) || value.schema !== 'nodenetwork-legacy-peer-key-proof-v1'
  || !pin(value.plan_sha256) || !pin(value.provider_binary_sha256)
  || !pin(value.wireguard_public_key_sha256) || typeof value.provider_revision !== 'string'
  || !/^[a-f0-9]{40}$/.test(value.provider_revision)
  || value.account_id !== 'da99e12f611ghl16dvjg' || value.peer_id !== 'dboqb9if611ohpqo0e1g'
  || value.peer_name !== 'synergy-canary-rpc-99999' || value.ip !== '10.69.51.205'
  || value.verified !== true || value.mutation_performed !== false || value.retirement_authorized !== false) {
  throw Error('Unsupported legacy peer key observation. No retirement is authorized.');
 }
 return structuredClone(value);
}

export function legacyPeerRetirementView(value) {
 const fields = ['format','account_id','peer_id','peer_name','hostname','ip','management_origin',
  'enrollment_sha256','binding_sha256','retired','absence_verified'];
 if (!exact(value, fields) || value.format !== 'synergy-vpn-retirement-v1'
  || value.account_id !== 'da99e12f611ghl16dvjg' || value.peer_id !== 'dboqb9if611ohpqo0e1g'
  || value.peer_name !== 'synergy-canary-rpc-99999' || value.hostname !== 'vmi3381382' || value.ip !== '10.69.51.205'
  || value.management_origin !== 'https://vpn-coordinator.synergy-network.io'
  || !pin(value.enrollment_sha256) || !pin(value.binding_sha256)
  || value.retired !== true || value.absence_verified !== true) {
  throw Error('The coordinator did not return a verified obsolete peer retirement receipt.');
 }
 return structuredClone(value);
}
