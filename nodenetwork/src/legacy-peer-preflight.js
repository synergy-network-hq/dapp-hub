const fields=['schema','plan_sha256','provider_sha256','account_id','peer_id','ready','account_verified','peer_verified','public_key_verified','blocker','mutation_performed','retirement_authorized'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pin=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function legacyPeerPreflightView(reply){
 const v=reply?.result;
 if(!exact(reply,['version','ok','result'])||reply.version!==1||reply.ok!==true||!exact(v,fields)||v.schema!=='nodenetwork-legacy-peer-retirement-preflight-v1'||!pin(v.plan_sha256)||!pin(v.provider_sha256)||v.account_id!=='da99e12f611ghl16dvjg'||v.peer_id!=='dboqb9if611ohpqo0e1g'||['ready','public_key_verified','mutation_performed','retirement_authorized'].some(k=>v[k]!==false)||v.account_verified!==true||v.peer_verified!==true||v.blocker!=='independent_peer_key_binding_unavailable')throw Error('Unsupported legacy peer prerequisites. No retirement is authorized.');
 return structuredClone(v);
}
