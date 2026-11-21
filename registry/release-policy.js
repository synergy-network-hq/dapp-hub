// Discovery metadata is never release authorization. Native APQE verifies authority.
export const RELEASE_REPOSITORY='https://github.com/synergy-network-hq/dapp-hub';
export const RELEASE_SIGNATURE_POLICY=Object.freeze({provider:'APQE',algorithm:'ML-DSA-87',signatureBytes:4627});
const supportedCapabilities=new Set(['readNetwork','readWallet','requestTransactions','externalLinks']);

function validCapabilities(values){
 if(!Array.isArray(values))return false;
 const distinct=new Set(values);
 return distinct.size===values.length&&[...distinct].every(value=>supportedCapabilities.has(value));
}

export function validReleaseNotes(value){
 return typeof value==='string'&&value.trim().length>0&&value.length<=4000&&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)&&new TextEncoder().encode(value).byteLength<=4000;
}
export function assessRelease(release){
 const blockers=[];
 if(!release)blockers.push('No release artifact has been published.');
 else {
  if(!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(release.version||''))blockers.push('Invalid release version.');
  const prefix=`${RELEASE_REPOSITORY}/releases/download/v${release.version}/`;
  let url;try{url=new URL(release.artifact?.url);}catch{}
  if(!url||url.href!==prefix+url.pathname.split('/').at(-1)||!url.href.startsWith(prefix)||url.username||url.password||url.search||url.hash||!/^[-a-zA-Z0-9_.]+$/.test(url.pathname.split('/').at(-1)))blockers.push('Artifact must use the versioned official HTTPS release location.');
  if(!/^[a-f0-9]{64}$/.test(release.artifact?.sha256||'')||!Number.isSafeInteger(release.artifact?.bytes)||release.artifact.bytes<=0||release.artifact.bytes>268435456)blockers.push('Invalid artifact digest or bounded size.');
  let signatureSize=0;try{signatureSize=atob(release.signature?.value||'').length;}catch{}
  if(signatureSize!==4627)blockers.push('Invalid ML-DSA-87 signature encoding or size.');
  const {capabilities,requiredCapabilities,manifestSchemaVersion}=release;
  const declaredValid=validCapabilities(capabilities);
  if(!declaredValid)blockers.push('Unknown or duplicate release capability.');
  const explicitSchema=Object.hasOwn(release,'manifestSchemaVersion');
  const explicitRequirements=Object.hasOwn(release,'requiredCapabilities');
  if(Object.hasOwn(release,'schemaVersion')||
     ((explicitSchema||explicitRequirements)&&(!explicitSchema||manifestSchemaVersion!==2||!explicitRequirements))){
   blockers.push('Required grants require an explicit package manifest schema version of 2.');
  }else if(explicitRequirements&&(!declaredValid||!validCapabilities(requiredCapabilities)||
    !requiredCapabilities.length||!requiredCapabilities.every(capability=>capabilities.includes(capability)))){
   blockers.push('Required capabilities must be a nonempty, unique subset of the declared release capabilities.');
  }
  if(release.signature?.provider!=='APQE'||release.signature?.algorithm!=='ML-DSA-87'||!release.signature?.keyId||!release.signature?.value)blockers.push('An APQE ML-DSA-87 release signature is required.');
  if(!release.qualification?.profile||!/^[a-f0-9]{64}$/.test(release.qualification?.reportSha256||''))blockers.push('Qualified release evidence is required.');
  if(Object.hasOwn(release,'notes')&&!validReleaseNotes(release.notes))blockers.push('Invalid release notes.');
 }
 return {metadataValid:blockers.length===0,installationAuthorized:false,blockers:[...blockers,'Native APQE signature, trusted release authority and qualification verification are required.']};
}
