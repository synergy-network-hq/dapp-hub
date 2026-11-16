import {localSha256} from './local-sha256.js';
import {upgradeParameters,validReleaseId} from './nodeNetwork.js';
import {parseExactNumbers} from './validator-operations-observation.js';

// Testnet v3 613fa6ab: node-platform/tools/linux-node/lifecycle.py::upgrade.
export const savedUpgradeLimits = {intent:4 * 1024 * 1024,manifest:1_000_000};
const intentError = 'The file is not a supported saved software upgrade intent.';
const manifestError = 'The file is not a supported Synergy package manifest.';
const root = '/opt/Synergy';
const packageFormat = 'synergy-universal-linux-v1';
const stages = ['fresh','uncommissioned','commissioned'];
const areas = ['bin','lib','assets','systemd','tools','roles'];
const units = ['synergy-node.service','synergy-vpn.service','synergy-canary-rpc-relay.service'];
const unitDirectory = '/etc/systemd/system/';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);
const keysMatch = (value,keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
const sameFiles = (first,second) => keysMatch(first,Object.keys(second)) && Object.keys(second).every(name=>first[name] === second[name]);

function json(raw,error) {
 try {return parseExactNumbers(raw);} catch {throw Error(error);}
}

function softwarePath(name) {
 if (name === 'README.md') return true;
 const parts = name.split('/');
 return name.length <= 100 && parts.length > 1 && areas.includes(parts[0])
  && parts.every(part=>part && part !== '.' && part !== '..' && !/[^\x20-\x7e]|\\/.test(part));
}

function inventory(value,error) {
 const entries = object(value) ? Object.entries(value) : [];
 if (!entries.length || entries.length > 4096 || entries.some(([name,pin]) => !softwarePath(name) || !digest(pin))) throw Error(error);
 // A file and its parent directory cannot both be declared members.
 for (const [name] of entries) {
  const parts = name.split('/');
  while (parts.length > 1) {
   parts.pop();
   if (Object.hasOwn(value,parts.join('/'))) throw Error(error);
  }
 }
 return value;
}

function packageManifest(raw,error) {
 const value = json(raw,error);
 if (!object(value) || value.format !== packageFormat || value.architecture !== 'x86_64'
  || !validReleaseId(value.release_id)) throw Error(error);
 return {release:value.release_id,files:inventory(value.files,error)};
}

async function fileBytes(file,limit,current) {
 if (!Number.isSafeInteger(file?.size) || file.size < 1 || file.size > limit) {
  throw Error(`Choose a nonempty JSON file of at most ${limit.toLocaleString('en-US')} bytes.`);
 }
 if (!current()) return null;
 try {
  const bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) throw Error();
  return {bytes,raw:decoder.decode(bytes)};
 } catch {throw Error('The selected JSON file could not be read in full as UTF-8.');}
}

async function serviceReview(value,current) {
 const {registered,old_integration:previous,new_integration:next,new_units:definitions,new_wrapper:wrapper} = value;
 if (!registered) {
  if (previous !== null || next !== undefined || !keysMatch(definitions,[]) || wrapper !== null) throw Error(intentError);
  return false;
 }
 const paths = previous?.paths;
 if (!Array.isArray(paths) || (paths.length !== 2 && paths.length !== 3)
  || !paths.every((path,index)=>path === unitDirectory + units[index]) || previous.root !== root
  || !keysMatch(previous.sha256,paths) || !paths.every(path=>digest(previous.sha256[path]))
  || next?.root !== root || !Array.isArray(next.paths) || next.paths.length !== paths.length
  || !next.paths.every((path,index)=>path === paths[index]) || !keysMatch(next.sha256,paths)
  || !keysMatch(definitions,units.slice(0,paths.length)) || typeof wrapper !== 'string' || !wrapper.length) throw Error(intentError);
 for (const [index,path] of paths.entries()) {
  const text = definitions[units[index]];
  if (!digest(next.sha256[path]) || typeof text !== 'string' || !text.length) throw Error(intentError);
  const actual = await localSha256(encoder.encode(text));
  if (!current()) return null;
  if (actual !== next.sha256[path]) throw Error(intentError);
 }
 return paths.length === 3;
}

export async function readSavedUpgradeIntent(file,current = () => true) {
 const selected = await fileBytes(file,savedUpgradeLimits.intent,current);
 if (!current() || !selected) return null;
 const value = json(selected.raw,intentError);
 const fields = ['format','root','old_receipt','old_manifest_json','new_package_sha256','new_files',
  'registered','stage','old_integration','new_units','new_wrapper'];
 if (value?.registered === true) fields.push('new_integration');
 const receipt = value?.old_receipt;
 if (!keysMatch(value,fields) || value.format !== 'synergy-software-upgrade-v1' || value.root !== root
  || !stages.includes(value.stage) || typeof value.registered !== 'boolean' || receipt?.root !== root
  || receipt.format !== packageFormat || !digest(receipt.package_sha256) || !digest(value.new_package_sha256)
  || receipt.package_sha256 === value.new_package_sha256 || typeof value.old_manifest_json !== 'string') throw Error(intentError);
 const priorBytes = encoder.encode(value.old_manifest_json);
 if (!priorBytes.length || priorBytes.length > savedUpgradeLimits.manifest) throw Error(intentError);
 const prior = packageManifest(value.old_manifest_json,intentError);
 const nextFiles = inventory(value.new_files,intentError);
 if (!sameFiles(receipt.package_files,prior.files)) throw Error(intentError);
 const priorPin = await localSha256(priorBytes);
 if (!current()) return null;
 if (priorPin !== receipt.package_sha256) throw Error(intentError);
 const relay = await serviceReview(value,current);
 if (!current()) return null;
 return {priorRelease:prior.release,priorPin,priorFiles:prior.files,nextFiles,nextPin:value.new_package_sha256,
  stage:value.stage,registered:value.registered,relay};
}

export async function compareSavedUpgradeManifest(file,intent,references,current = () => true) {
 const approved = upgradeParameters(references);
 const selected = await fileBytes(file,savedUpgradeLimits.manifest,current);
 if (!current() || !selected) return null;
 const candidate = packageManifest(selected.raw,manifestError);
 const pin = await localSha256(selected.bytes);
 if (!current()) return null;
 if (pin !== approved.manifest_sha256 || candidate.release !== approved.release_id) {
  throw Error('The selected package manifest differs from the approved release references in the update draft.');
 }
 if (pin !== intent.nextPin || !sameFiles(intent.nextFiles,candidate.files)) {
  throw Error('The selected package manifest differs from the candidate recorded in the saved intent.');
 }
 const counts = {added:0,changed:0,removed:0,unchanged:0};
 for (const [name,hash] of Object.entries(candidate.files)) {
  if (!Object.hasOwn(intent.priorFiles,name)) counts.added++;
  else if (intent.priorFiles[name] === hash) counts.unchanged++;
  else counts.changed++;
 }
 counts.removed = Object.keys(intent.priorFiles).length - counts.changed - counts.unchanged;
 return {priorRelease:intent.priorRelease,priorPin:intent.priorPin,candidateRelease:candidate.release,candidatePin:pin,
  stage:intent.stage,registered:intent.registered,relay:intent.relay,counts};
}
