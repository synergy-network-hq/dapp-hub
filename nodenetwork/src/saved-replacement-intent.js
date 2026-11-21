import {commissioningDraftIdentity,readCommissioningManifest} from './commissioning-public-evidence.js';
import {genesisDigest} from './genesis-pin.js';
import {localSha256} from './local-sha256.js';
import {parseSoftwareInventory,readUpgradeJsonFile,savedUpgradeLimits} from './saved-upgrade-intent.js';
import {exactObservationU64,parseExactNumbers} from './validator-operations-observation.js';

// Testnet v3 613fa6ab: lifecycle.py::finish_replacement and _replace_application_locked.
const root = '/opt/Synergy';
const preserved = ['bin/netbird','tools/netbird-client','evidence/host-integrations.json'];
const boundedProtectedPath = /^(?:evidence\/vpn-[\p{L}\p{N}_-]+\.json|systemd\/[\p{L}\p{N}_.-]*vpn[\p{L}\p{N}_.-]*)(?![\s\S])/u;
const unsupported = 'The file is not a supported saved application replacement intent.';
const digest = value => typeof value==='string' && genesisDigest(value)===value;
const object = value => value!=null && typeof value==='object' && !Array.isArray(value);
const keysMatch = (value,keys) => object(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));

export function replacementIntentPins(commissioning,intent) {
 const stagePin=genesisDigest(commissioning);
 const hasIntent=typeof intent==='string' && Boolean(intent.trim());
 const intentPin=hasIntent ? genesisDigest(intent) : null;
 return stagePin && (!hasIntent || intentPin) ? {stagePin,intentPin} : null;
}

export async function readReplacementStageManifest(file,expected,form,current) {
 const manifest=await readCommissioningManifest(file,expected,form,current);
 return manifest ? {pin:genesisDigest(expected)} : null;
}

export async function compareSavedReplacementIntent(file,{candidate,stage,intentPin},current = () => true) {
 if (!digest(candidate?.pin) || !object(candidate.files) || !digest(stage?.pin) || (intentPin!==null && !digest(intentPin))) {
  throw Error('Review the exact candidate package and commissioning manifest before selecting the intent.');
 }
 const selected=await readUpgradeJsonFile(file,savedUpgradeLimits.intent,current);
 if (!selected) return null;
 try {
  if (!current()) return null;
  if (intentPin!==null) {
   const actual=await localSha256(selected.bytes);
   if (!current()) return null;
   if (actual!==intentPin) throw Error('The saved replacement intent SHA-256 differs from the independently supplied digest.');
  }
  let value;
  try {value=parseExactNumbers(selected.raw,16);} catch {throw Error(unsupported);}
  if (!keysMatch(value,['root','token','receipt','vpn_sha256']) || value.root!==root || typeof value.token!=='string'
   || value.token.length!==129 || value.token[64]!==':') throw Error(unsupported);
  const [candidatePin,stagePin]=value.token.split(':');
  if (!digest(candidatePin) || !digest(stagePin)) throw Error(unsupported);

  const receipt=value.receipt;
  if (!object(receipt) || receipt.root!==root || receipt.format!=='synergy-universal-linux-v1'
   || !['validator','rpc_gateway'].includes(receipt.role) || typeof receipt.consensus_started!=='boolean' || !digest(receipt.package_sha256)
   || !commissioningDraftIdentity({...receipt,chain_id:exactObservationU64(receipt.chain_id)})) throw Error(unsupported);
  parseSoftwareInventory(receipt.package_files,unsupported);

  const hashes=value.vpn_sha256;
  const entries=object(hashes) ? Object.entries(hashes) : [];
  if (entries.length<preserved.length || entries.length>256 || !preserved.every(name=>Object.hasOwn(hashes,name))
   || entries.some(([name,pin])=>!digest(pin) || name.length>256 || (!preserved.includes(name) && !boundedProtectedPath.test(name)))) {
   throw Error(unsupported);
  }
  const result={intentDigestChecked:intentPin!==null,candidateMatches:candidatePin===candidate.pin,stageMatches:stagePin===stage.pin,
   recordedProtectedFiles:entries.length,protectedCandidate:null};
  if (!result.candidateMatches || !result.stageMatches) return result;

  const overlap=entries.filter(([name])=>Object.hasOwn(candidate.files,name));
  return {...result,protectedCandidate:{netbirdMatches:candidate.files['bin/netbird']===hashes['bin/netbird'],
   overlapCount:overlap.length,conflictCount:overlap.filter(([name,pin])=>candidate.files[name]!==pin).length}};
 } finally {
  new Uint8Array(selected.bytes).fill(0);
 }
}
