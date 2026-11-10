// Discovery metadata is never release authorization. Native APQE verifies authority.
export const RELEASE_REPOSITORY='https://github.com/synergy-network-hq/dapp-hub';
export const RELEASE_SIGNATURE_POLICY=Object.freeze({provider:'APQE',algorithm:'ML-DSA-87',signatureBytes:4627});
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
  if(!Array.isArray(release.capabilities)||new Set(release.capabilities).size!==release.capabilities.length||release.capabilities.some(cap=>!['readNetwork','readWallet','requestTransactions','externalLinks'].includes(cap)))blockers.push('Unknown or duplicate release capability.');
  if(release.signature?.provider!=='APQE'||release.signature?.algorithm!=='ML-DSA-87'||!release.signature?.keyId||!release.signature?.value)blockers.push('An APQE ML-DSA-87 release signature is required.');
  if(!release.qualification?.profile||!/^[a-f0-9]{64}$/.test(release.qualification?.reportSha256||''))blockers.push('Qualified release evidence is required.');
 }
 return {metadataValid:blockers.length===0,installationAuthorized:false,blockers:[...blockers,'Native APQE signature, trusted release authority and qualification verification are required.']};
}
