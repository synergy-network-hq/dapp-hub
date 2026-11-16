export const genesisStageFiles = [
 {name: 'genesis.json', pin: 'genesis_sha256', field:'genesisSha256', maxBytes: 4 * 1024 * 1024, utf8:true},
 {name: 'authority.json', pin: 'authority_sha256', field:'authoritySha256', maxBytes: 1024 * 1024, utf8:true},
 {name: 'authority-root.pub', pin: 'authority_root_sha256', field:'authorityRootSha256', maxBytes: 8 * 1024, utf8:false},
];
const digest = value => typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);

// Browser previews keep the local digest comparison. Native staging uses its dedicated pickers.
export async function inspectGenesisStageFile(input, file) {
 if (!Number.isSafeInteger(file?.size) || file.size < 1 || file.size > input.maxBytes) {
  throw Error(`Select a nonempty ${input.name} input of at most ${input.maxBytes.toLocaleString('en-US')} bytes.`);
 }
 let bytes;
 try {
  bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw Error();
 } catch {
  throw Error('The selected file could not be read in full.');
 }
 if (input.utf8) {
  try {
   new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
   throw Error('This input must use UTF-8.');
  }
 }
 if (!globalThis.crypto?.subtle) throw Error('Local SHA-256 is unavailable in this Portal runtime.');
 const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
 return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function genesisStageLocalReview(value) {
 const unsupported='The native review returned unsupported public Genesis input evidence.';
 if (value?.schema!=='nodenetwork-genesis-stage-local-review-v1' || Object.keys(value).length!==3 || !digest(value.requestSha256)
  || !Array.isArray(value.inputs) || value.inputs.length!==genesisStageFiles.length) throw Error(unsupported);
 const inputs=genesisStageFiles.map(({name,maxBytes},index)=>{
  const row=value.inputs[index];
  if (!row || Object.keys(row).length!==3 || row.name!==name || !Number.isSafeInteger(row.bytes)
   || row.bytes<1 || row.bytes>maxBytes || !digest(row.sha256)) throw Error(unsupported);
  return {name,bytes:row.bytes,sha256:row.sha256};
 });
 return {requestSha256:value.requestSha256,inputs};
}

export function genesisStageScope(policy,formation,form) {
 if (!policy?.artifactPins || !formation?.pending || formation.kind!=='Formation custody' || !digest(formation.formationSha256)
  || policy.validatorAddress!==formation.validatorAddress || (form.network_id&&form.network_id!==formation.networkId)
  || (form.chain_id&&form.chain_id!==formation.chainId) || genesisStageFiles.some(({pin})=>!digest(policy.artifactPins[pin]))) return null;
 return {validatorAddress:formation.validatorAddress,networkId:formation.networkId,chainId:formation.chainId,
  formationSha256:formation.formationSha256,
  pins:Object.fromEntries(genesisStageFiles.map(({pin,field})=>[field,policy.artifactPins[pin]]))};
}

export function genesisStageInputsMatch(review,scope) {
 return Boolean(digest(review?.requestSha256) && Array.isArray(review.inputs) && scope && genesisStageFiles.every(({name,field},index)=>
  review.inputs[index]?.name===name && review.inputs[index].sha256===scope.pins[field]));
}

export function genesisStageReceipt(value,scope) {
 if (value?.schema!=='nodenetwork-genesis-stage-v1' || Object.keys(value).length!==8 || value.address!==scope.validatorAddress
  || value.staged!==true || value.genesis_authority_verified!==true || value.membership_verified!==true
  || genesisStageFiles.some(({pin,field})=>value[pin]!==scope.pins[field])) {
  throw Error('Genesis staging outcome is uncertain. Preserve the target state and review staged Genesis before another change.');
 }
 return {title:'Staged signed Genesis',validatorAddress:value.address,staged:true,
  artifactPins:Object.fromEntries(genesisStageFiles.map(({pin})=>[pin,value[pin]]))};
}
