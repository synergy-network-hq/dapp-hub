// Public presentation only: the native controller verifies APQE artifacts.
const pin=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const network=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{1,127}$/.test(v);
const chain=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
export function networkFormationView(value,expected=null){
 if(value?.pending===false&&Object.keys(value).length===1)return {pending:false};
 if(value?.schema!=='nodenetwork-network-formation-v1'||value.pending!==true||typeof value.signed!=='boolean'||!network(value.network_id)||!chain(value.chain_id)||
  !['formation_sha256','request_sha256','review_sha256','unsigned_genesis_sha256','unsigned_authority_sha256','authority_root_sha256'].every(k=>pin(value[k]))||
  !Array.isArray(value.validator_addresses)||value.validator_addresses.length!==5||new Set(value.validator_addresses).size!==5||value.validator_addresses.some(v=>typeof v!=='string'||!/^synv1[0-9a-z]{10,90}$/.test(v))||
  (value.signed&&!['genesis_sha256','authority_sha256','sign_request_sha256'].every(k=>pin(value[k])))||
  (expected&&(expected.review_sha256!==value.review_sha256||expected.formation_sha256!==value.formation_sha256||expected.network_id!==value.network_id||expected.chain_id!==value.chain_id)))
  throw Error('The target did not confirm the exact prepared engineering Genesis review.');
 const fields=['schema','pending','signed','network_id','chain_id','formation_sha256','request_sha256','review_sha256','validator_addresses','unsigned_genesis_sha256','unsigned_authority_sha256','authority_root_sha256'];
 if(value.signed)fields.push('genesis_sha256','authority_sha256','sign_request_sha256');
 return Object.fromEntries(fields.map(k=>[k,value[k]]));
}
