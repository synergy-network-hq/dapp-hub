import {genesisDigest} from './genesis-pin.js';
import {localSha256} from './local-sha256.js';
import {validInstallNetworkId} from './nodeNetwork.js';
import {readUpgradeJsonFile} from './saved-upgrade-intent.js';
import {exactJsonNumber,exactObservationU64,parseExactNumbers} from './validator-operations-observation.js';

// Testnet v3 613fa6ab: node-platform/tools/linux-node/activate_authority_recovery.py.
const root='/opt/Synergy';
const format='synergy-authority-recovery-activation-v1';
const certificate='network/authority-recovery-certificate.json';
const authority='network/authority.json';
const admission='network/rpc-gateway-admission.json';
const required=['config/node.json','installation.json',authority,'network/transport-registry.json',certificate];
const immutable=['genesis.json','authority-root.pub','network-manifest.json','transport-root.pub'];
const planError='The selected file is not a supported Canary authority-recovery plan.';
const completionError='The selected file is not a supported authority-recovery completion receipt.';
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const object=value=>value!=null && typeof value==='object' && !Array.isArray(value);
const keysMatch=(value,keys)=>object(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const digest=value=>typeof value==='string' && genesisDigest(value)===value;

export function authorityRecoveryScope(form) {
 return form?.chain_id==='99999' && validInstallNetworkId(form.network_id) && digest(form.manifest_sha256)
  ? {network:form.network_id,packagePin:form.manifest_sha256} : null;
}

function parse(raw,error) {
 try {return parseExactNumbers(raw);} catch {throw Error(error);}
}

export async function readAuthorityRecoveryPlan(file,expected,scope,current=()=>true) {
 const pin=genesisDigest(expected);
 if (!pin || !scope || !validInstallNetworkId(scope.network) || !digest(scope.packagePin)) {
  throw Error('Enter the independent plan SHA-256 and exact Canary draft scope before review.');
 }
 const selected=await readUpgradeJsonFile(file,32*1024,current);
 if (!selected) return null;
 try {
  if (!current()) return null;
  const actual=await localSha256(selected.bytes);
  if (!current()) return null;
  if (actual!==pin) throw Error('The selected authority-recovery plan SHA-256 differs from the independently supplied digest.');
  const p=parse(selected.raw,planError);
  if (!keysMatch(p,['format','root','role','package_sha256','chain_id','network_id','immutable_network','before','after'])
   || p.format!==format || p.root!==root || !['validator','rpc_gateway'].includes(p.role) || exactObservationU64(p.chain_id)!=='99999'
   || !validInstallNetworkId(p.network_id) || !digest(p.package_sha256) || !object(p.after)
   || !keysMatch(p.immutable_network,immutable) || !immutable.every(name=>digest(p.immutable_network[name]))) throw Error(planError);
  const names=[...required];
  if (p.role==='validator') names.push('config/start-authorized.json');
  if (Object.hasOwn(p.after,admission)) names.push(admission);
  if ((p.role==='rpc_gateway' && !names.includes(admission)) || !keysMatch(p.before,names) || !keysMatch(p.after,names)
   || !names.every(name=>digest(p.after[name]) && (digest(p.before[name]) || (name===certificate && p.before[name]===null)))) {
   throw Error(planError);
  }
  if (p.network_id!==scope.network || p.package_sha256!==scope.packagePin) {
   throw Error('The plan does not match the current Canary network and package digest.');
  }
  return {
   findings:{role:p.role,plannedFiles:names.length,preservedNetworkPins:immutable.length,
    changedFiles:names.filter(name=>p.before[name]!==p.after[name]).length,priorCertificateRecorded:p.before[certificate]!==null},
   planPin:pin,packagePin:p.package_sha256,certificatePin:p.after[certificate],authorityPin:p.after[authority],
   previousAuthorityPin:p.before[authority],
  };
 } finally {
  new Uint8Array(selected.bytes).fill(0);
 }
}

export async function readAuthorityRecoveryCompletion(file,plan,current=()=>true) {
 const selected=await readUpgradeJsonFile(file,4*1024,current);
 if (!selected) return null;
 try {
  if (!current()) return null;
  const value=parse(selected.raw,completionError);
  if (!keysMatch(value,['format','root','plan_sha256','certificate_sha256','authority_sha256','package_sha256','native_preflight_passed'])
   || value.format!==format || value.root!==root || value.native_preflight_passed!==true
   || !['plan_sha256','certificate_sha256','authority_sha256','package_sha256'].every(key=>digest(value[key]))) throw Error(completionError);
  if (value.plan_sha256!==plan.planPin || value.certificate_sha256!==plan.certificatePin
   || value.authority_sha256!==plan.authorityPin || value.package_sha256!==plan.packagePin) {
   throw Error('The saved completion receipt does not match the reviewed plan and its recovery inputs.');
  }
  return {nativePreflightReported:true};
 } finally {
  new Uint8Array(selected.bytes).fill(0);
 }
}

async function compareAuthorityBindings(bytes,plan,current) {
 let value;
 try {value=parseExactNumbers(decoder.decode(bytes),32);} catch {return 'unsupported';}
 if (!object(value)) return 'unsupported';
 // The owner compares these exact JSON byte arrays in its saved activation stage.
 for (const [name,pin] of [['previous_authority_binding',plan.previousAuthorityPin],['successor_authority_binding',plan.authorityPin]]) {
  const list=value[name];
  if (!Array.isArray(list) || !list.length) return 'unsupported';
  const binding=new Uint8Array(list.length);
  try {
   for (let index=0;index<list.length;index++) {
    const token=exactJsonNumber(list[index]);
    if (!/^(0|[1-9][0-9]{0,2})$/.test(token) || Number(token)>255) return 'unsupported';
    binding[index]=Number(token);
   }
   const actual=await localSha256(binding);
   if (!current()) return null;
   if (actual!==pin) return 'differs';
  } finally {
   binding.fill(0);
  }
 }
 return 'matches';
}

export async function compareAuthorityRecoveryPublicFile(file,kind,plan,current=()=>true) {
 const isCertificate=kind==='certificate';
 const pin=isCertificate ? plan?.certificatePin : plan?.authorityPin;
 const limit=(isCertificate ? 8 : 16)*1024*1024;
 if ((!isCertificate && kind!=='authority') || !digest(pin)) throw Error('Review the authority-recovery plan before selecting public evidence.');
 if (!Number.isSafeInteger(file?.size) || file.size<1 || file.size>limit) {
  throw Error(`Choose a nonempty public file of at most ${isCertificate ? 8 : 16} MiB.`);
 }
 if (!current()) return null;
 let bytes;
 try {
  try {bytes=await file.arrayBuffer();} catch {throw Error('The selected public file could not be read in full.');}
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength!==file.size) throw Error('The selected public file could not be read in full.');
  if (!current()) return null;
  const actual=await localSha256(bytes);
  if (!current()) return null;
  if (actual!==pin) return {matches:false};
  if (!isCertificate) return {matches:true};
  const bindings=await compareAuthorityBindings(bytes,plan,current);
  return current() ? {matches:true,bindings} : null;
 } finally {
  if (bytes instanceof ArrayBuffer) new Uint8Array(bytes).fill(0);
 }
}
