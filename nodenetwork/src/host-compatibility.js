// This is platform compatibility, not host enrollment or operation authority.
// The native controller currently has only Unix transport and Linux local support.
export function hostCompatibility(resource) {
 if (!resource || resource.loading !== false || resource.error || !resource.data ||
     typeof resource.data.localValidatorSupported!=='boolean' ||
     (resource.data.platform!=='linux'&&resource.data.localValidatorSupported))
  return {remote:false,local:false,message:'Native platform compatibility has not been verified. Public network monitoring remains available.'};
 const {platform,localValidatorSupported}=resource.data;
 const remote=platform==='macos'||platform==='linux';
 const local=platform==='linux'&&localValidatorSupported===true;
 return {remote,local,message:remote
  ? (local?'Local Linux and authenticated remote Linux targets are supported.':'Use an authenticated remote Linux target; local validators are unavailable on this platform.')
  : 'This Portal platform has no qualified native controller transport. Use Portal on macOS or Linux to manage an authenticated Linux target. Public network monitoring remains available.'};
}

export function hostTargetSupported(compatibility,target) {
 return target?.kind==='remote'?compatibility.remote===true:target?.kind==='local'&&compatibility.local===true;
}

export function requireTargetMode(compatibility,kind) {
 if(kind==='monitor')return;
 if(!hostTargetSupported(compatibility,{kind}))throw Error(compatibility.message);
}
