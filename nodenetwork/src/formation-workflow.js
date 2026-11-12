// Presentation only. Controller verifies authority, possession and custody.
const pin=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const address=value=>typeof value==='string'&&/^synv1[0-9a-z]{10,90}$/.test(value);
const network=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{1,127}$/.test(value);
const chain=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
export function formationView(value,prepared=false) {
 if(value?.schema!=='nodenetwork-formation-v1'||!pin(value.formation_sha256)||!pin(value.formation_id)||value.formation_id==='0'.repeat(64)||
    !network(value.network_id)||!chain(value.chain_id)||(prepared&&(
     value.pending!==true||!address(value.address)||value.possession_verified!==true||value.membership_granted!==false||!pin(value.request_sha256)
    )))throw Error('The target did not confirm the reviewed network formation and host-local preparation.');
 return {network_id:value.network_id,chain_id:value.chain_id,formation_id:value.formation_id,formation_sha256:value.formation_sha256,
  ...(prepared?{pending:true,address:value.address,possession_verified:true,membership_granted:false,request_sha256:value.request_sha256}:{})};
}
export function formationStatusView(value) {
 if(value?.pending===false&&Object.keys(value).length===1)return {pending:false};
 return formationView(value,true);
}
export function genesisBindingView(value,prepared,expectedHash=null) {
 if(value?.schema!=='nodenetwork-genesis-binding-v1'||!network(value.network_id)||!chain(value.chain_id)||!pin(value.genesis_sha256)||
    !address(value.address)||value.genesis_authority_verified!==true||value.membership_verified!==true||typeof value.bound!=='boolean'||
    (value.bound&&(!pin(value.request_sha256)||!pin(value.enrollment_sha256)))||
    (expectedHash!==null&&(value.bound!==true||value.genesis_sha256!==expectedHash))||
    !prepared?.pending||value.address!==prepared.address||value.network_id!==prepared.network_id||value.chain_id!==prepared.chain_id)
  throw Error('The target did not verify exact signed Genesis and the previously prepared identity.');
 return {network_id:value.network_id,chain_id:value.chain_id,address:value.address,genesis_sha256:value.genesis_sha256,
  genesis_authority_verified:true,membership_verified:true,bound:value.bound,
  ...(value.bound?{request_sha256:value.request_sha256,enrollment_sha256:value.enrollment_sha256}:{})};
}
export function publicExportView(value,expectedAddress) {
 if(value===null)return null;
 if(!address(value?.address)||value.address!==expectedAddress||!pin(value.sha256))
  throw Error('The native export did not confirm the expected public identity and artifact digest.');
 return {address:value.address,sha256:value.sha256};
}

export function genesisStageView(value,prepared){
 if(value===null)return null;
 if(value?.schema!=='nodenetwork-genesis-stage-v1'||value.staged!==true||value.genesis_authority_verified!==true||
    value.membership_verified!==true||prepared?.pending!==true||!address(value.address)||value.address!==prepared.address||
    !['genesis_sha256','authority_sha256','authority_root_sha256','request_sha256'].every(field=>pin(value[field])))
  throw Error('The target did not confirm the exact signed Genesis staging receipt.');
 const {address:validator,genesis_sha256,authority_sha256,authority_root_sha256,request_sha256}=value;
 return {address:validator,genesis_sha256,authority_sha256,authority_root_sha256,request_sha256,staged:true};
}
