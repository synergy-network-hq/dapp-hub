// Authenticated candidate execution smoke is not network or process qualification.
export function runtimeProbeView(v,p){
 const pins=['manifest_sha256','provider_report_sha256','genesis_sha256','authority_sha256','authority_root_sha256','registry_sha256','issuer_root_sha256','network_manifest_sha256','candidate_node_sha256'];
 const yes=['native_origin_verified','package_verified'],no=['mutation_performed','keys_generated','services_started','network_qualified','production_qualified','automatic_retry'];
 const keys=['schema','release_id','network_id','chain_id',...pins,...yes,...no];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||v.schema!=='nodenetwork-upgrade-native-preflight-v1'||v.release_id!==p.release_id||v.manifest_sha256!==p.manifest_sha256||typeof v.network_id!=='string'||!/^synergy-posy-canary-[a-z0-9-]+$/.test(v.network_id)||v.network_id.length>128||v.chain_id!=='99999'||pins.some(k=>typeof v[k]!=='string'||!/^[0-9a-f]{64}$/.test(v[k]))||yes.some(k=>v[k]!==true)||no.some(k=>v[k]!==false))throw Error('Unsupported candidate Linux origin/crypto smoke. No upgrade or network qualification was inferred.');
 return {...v};
}
