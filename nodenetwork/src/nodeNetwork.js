export function nodeNetworkTarget(value) {
 if(value?.root!==undefined&&value.root!=='/opt/synergy')throw Error('Saved validator root is unsupported; recover the original configuration before selecting a target.');
 if(value?.kind==='local')return {kind:'local',root:'/opt/synergy'};
 if(value?.kind!=='remote' || typeof value.host!=='string')throw new Error('Choose this machine or a remote host.');
 const host=value.host.trim().toLowerCase();
 const ipv6=/^\[[0-9a-f:]+\]$/.test(host);
 const hostname=host.length<=253 && host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
 if(!host || !(ipv6||hostname))throw new Error('Enter a hostname or IP address without credentials, paths or commands.');
 try {new URL(`https://${host}`);}catch{throw new Error('Invalid remote hostname or IP address.');}
 const rawPort=value.port;
 if(rawPort!=null&&typeof rawPort!=='string'&&typeof rawPort!=='number')throw Error('SSH port must be a decimal number.');
 if(typeof rawPort==='string'&&rawPort!==''&&!/^[0-9]{1,5}$/.test(rawPort))throw Error('SSH port must contain decimal digits only.');
 const port=rawPort==null||rawPort===''?22:Number(rawPort);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Enter an SSH port between 1 and 65535.');
 return {kind:'remote',host,...(port!==22?{port}:{}),root:'/opt/synergy'};
}

export async function readNodeNetwork(request, profile, signal) {
 const options={endpoint:profile.rpc,signal};
 const chain=await request('synergy_chainStatus',[],options);
 if (!Number.isSafeInteger(chain?.chain_id) || chain.chain_id!==Number(profile.chainId)) {
  throw new Error(`Network mismatch: expected chain ${profile.chainId}. No node operations are authorized.`);
 }
 const chainReceivedAt=Date.now();
 const names=['node','posy','sync'];
 const results=await Promise.allSettled(names.map(async name=>{
  const value=await request(`synergy_${name}Status`,[],options);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${name} status response is unavailable or unsupported; no healthy or empty state is inferred.`);
  return {value,receivedAt:Date.now()};
 }));
 const observations={}, errors={},receivedAt={};
 results.forEach((result,index)=>{
  if(result.status==='fulfilled'){observations[names[index]]=result.value.value;receivedAt[names[index]]=result.value.receivedAt;}
  else errors[names[index]]=String(result.reason?.message||result.reason);
 });
 return {chain,chainReceivedAt,observations,receivedAt,errors,checkedAt:Date.now()};
}

export function controllerOperation(target,operation){
 const unavailable={available:false,blocker:'Inspect an enrolled target to establish unambiguous controller capabilities.'};
 if(!Array.isArray(target?.operations)||target.operations.length>100)return unavailable;
 const matches=target.operations.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.operation===operation);
 if(matches.length!==1)return unavailable;
 const entry=matches[0];
 return entry.available===true?{available:true,blocker:null}:{available:false,blocker:typeof entry.blocker==='string'&&entry.blocker.length>0&&entry.blocker.length<=512&&!/[\u0000-\u001f\u007f]/.test(entry.blocker)?entry.blocker:unavailable.blocker};
}
export function provisioningChecks(form){
 const checks=[
  ['release_id','Release ID',value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value),'Enter the approved release ID using letters, digits, dots, underscores or hyphens.'],
  ['manifest_sha256','Manifest SHA-256',value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),'Enter the exact 64-character lowercase manifest SHA-256.'],
  ['network_id','Network incarnation',value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{1,127}$/.test(value),'Enter the exact approved network incarnation.'],
  ['chain_id','Chain ID',value=>typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)&&Number.isSafeInteger(Number(value)),'Enter a positive safe integer chain ID in decimal digits without leading zeros.'],
  ['node_name','Node name',value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value),'Enter a node name using up to 64 letters, digits, underscores or hyphens.'],
 ];
 return checks.map(([field,label,accept,message])=>({field,label,valid:accept(form?.[field]),message}));
}
export function installParameters(form){
 const failed=provisioningChecks(form).find(check=>!check.valid);if(failed)throw Error(failed.message);
 return {release_id:form.release_id,manifest_sha256:form.manifest_sha256,network_id:form.network_id,chain_id:Number(form.chain_id),node_name:form.node_name};
}
