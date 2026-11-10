// Public observations never grant enrollment, installation or signing authority.
export const CANARY_PROFILE = Object.freeze({
 id:'posy-canary', name:'PoSy Canary', chainId:99999,
 rpc:'https://canary-rpc.synergy-network.io',
});

export function nodeNetworkTarget(value) {
 if(value?.kind==='local')return {kind:'local',root:'/opt/Synergy'};
 if(value?.kind!=='remote' || typeof value.host!=='string')throw new Error('Choose this machine or a remote host.');
 const host=value.host.trim().toLowerCase();
 const ipv6=/^\[[0-9a-f:]+\]$/.test(host);
 const hostname=host.length<=253 && host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
 if(!host || !(ipv6||hostname))throw new Error('Enter a hostname or IP address without credentials, paths or commands.');
 try {new URL(`https://${host}`);}catch{throw new Error('Invalid remote hostname or IP address.');}
 const port=value.port==null||value.port===''?22:Number(value.port);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Enter an SSH port between 1 and 65535.');
 return {kind:'remote',host,...(port!==22?{port}:{}),root:'/opt/Synergy'};
}

export async function readNodeNetwork(request, profile, signal) {
 const options={endpoint:profile.rpc,signal};
 const chain=await request('synergy_chainStatus',[],options);
 if (!Number.isSafeInteger(chain?.chain_id) || chain.chain_id!==Number(profile.chainId)) {
  throw new Error(`Network mismatch: expected chain ${profile.chainId}. No node operations are authorized.`);
 }
 const chainReceivedAt=Date.now();
 const names=['node','posy','sync'];
 const results=await Promise.allSettled(names.map(async name=>({value:await request(`synergy_${name}Status`,[],options),receivedAt:Date.now()})));
 const observations={}, errors={},receivedAt={};
 results.forEach((result,index)=>{
  if(result.status==='fulfilled'){observations[names[index]]=result.value.value;receivedAt[names[index]]=result.value.receivedAt;}
  else errors[names[index]]=String(result.reason?.message||result.reason);
 });
 return {chain,chainReceivedAt,observations,receivedAt,errors,checkedAt:Date.now()};
}

export const R5_BASELINE=Object.freeze({release_id:'synergy-linux-389c509e47e55219',manifest_sha256:'43eae3fdc42a2bff9e0ba2fa369d708fb60d14e90c6e18a6f344f5071c6cb23b'});
export function controllerOperation(target,operation){
 const entry=target?.operations?.find(row=>row.operation===operation);
 return entry?.available===true?{available:true,blocker:null}:{available:false,blocker:entry?.blocker||'Inspect an enrolled target to establish controller capabilities.'};
}
export function installParameters(form){
 const chain_id=Number(form.chain_id);
 if(!Number.isSafeInteger(chain_id)||chain_id<=0)throw new Error('Enter a nonzero safe integer chain ID.');
 if(!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(form.network_id||''))throw new Error('Enter the exact approved network incarnation.');
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(form.node_name||''))throw new Error('Enter a node name using letters, digits, underscores or hyphens.');
 if(!/^[a-zA-Z0-9._-]{1,128}$/.test(form.release_id||'')||! /^[0-9a-f]{64}$/.test(form.manifest_sha256||''))throw new Error('Enter an approved release ID and exact manifest SHA-256.');
 return {release_id:form.release_id,manifest_sha256:form.manifest_sha256,network_id:form.network_id,chain_id,node_name:form.node_name};
}
