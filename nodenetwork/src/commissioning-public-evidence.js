import {genesisStageFiles} from './genesis-stage-files.js';
import {genesisDigest} from './genesis-pin.js';
import {localSha256} from './local-sha256.js';
import {exactObservationU64,parseExactNumbers} from './validator-operations-observation.js';

// Testnet v3 613fa6ab: apqe_layout.py::seal_commissioning and lifecycle.py::_authorized_validator_ids.
const profile = 'engineering_canary_pq_vsession_v1';
export const commissioningPublicArtifacts = Object.freeze([
 ...genesisStageFiles.map(({name,maxBytes})=>({name,maxBytes})),
 {name:'network-manifest.json',maxBytes:16 * 1024 * 1024},
 {name:'transport-registry.json',maxBytes:1024 * 1024},
 {name:'transport-root.pub',maxBytes:64 * 1024},
]);
const publicNames = commissioningPublicArtifacts.map(({name})=>name);
const contents = ['config/node.json','config/start-authorized.json',...publicNames.map(name=>`network/${name}`),
 ...['validator.pub.json','enrollment.json','custody.json','unlock'].map(name=>`keys/apqe/${name}`)];
const manifestLimit = 32 * 1024;
const startupLimit = 256 * 1024;
const maxValidators = 256;
const statuses = new Set(['active','shadow','jailed','removed']);
const manifestError = 'The file is not a supported APQE commissioning manifest.';
const policyError = 'The file is not a supported engineering startup policy.';
const authorityError = 'The selected authority file has an unsupported public roster.';
const object = value=>value && typeof value==='object' && !Array.isArray(value);
const fieldsMatch = (value,names)=>object(value) && Object.keys(value).length===names.length
 && names.every(name=>Object.hasOwn(value,name));
const isDigest = value=>typeof value==='string' && genesisDigest(value)===value;
const validatorId = value=>typeof value==='string' && value.length<=128 && Boolean(value.trim())
 && !/[\x00-\x20\x7f\u202a-\u202e\u2066-\u2069]/.test(value);
const decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});

export function commissioningDraftIdentity(form) {
 const {network_id:network,chain_id:chain,node_name:node} = form ?? {};
 if (typeof network!=='string' || network.length<2 || network.length>128 || !/^[a-z0-9]/.test(network) || /[^a-z0-9_-]/.test(network)
  || typeof node!=='string' || node.length<1 || node.length>64 || /[^A-Za-z0-9_-]/.test(node)
  || typeof chain!=='string' || chain.length<1 || chain.length>20 || !/^[1-9]/.test(chain) || /[^0-9]/.test(chain)
  || BigInt(chain)>18446744073709551615n) return null;
 return {network,chain,node};
}

async function selectedBytes(file,maxBytes,current) {
 if (!Number.isSafeInteger(file?.size) || file.size<1 || file.size>maxBytes) {
  throw Error(`Choose a nonempty file of at most ${maxBytes.toLocaleString('en-US')} bytes.`);
 }
 if (!current()) return null;
 try {
  const bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength!==file.size) throw Error();
  return bytes;
 } catch {throw Error('The selected file could not be read in full.');}
}

function parsed(bytes,error,maxDepth = 8) {
 try {return parseExactNumbers(decoder.decode(bytes),maxDepth);} catch {throw Error(error);}
}

export async function readCommissioningManifest(file,pin,form,current = ()=>true) {
 const expected = genesisDigest(pin);
 const draft = commissioningDraftIdentity(form);
 if (!expected || !draft) throw Error('Enter the expected commissioning digest and exact provisioning identity before review.');
 const bytes = await selectedBytes(file,manifestLimit,current);
 if (!current() || !bytes) return null;
 const sha256 = await localSha256(bytes);
 if (!current()) return null;
 if (sha256!==expected) throw Error('The selected commissioning manifest SHA-256 differs from the independently supplied digest.');
 const value = parsed(bytes,manifestError);
 if (!fieldsMatch(value,['format','root','network_id','chain_id','node_name','files'])
  || value.format!=='synergy-apqe-commissioning-v1' || value.root!=='/opt/Synergy'
  || !fieldsMatch(value.files,contents) || contents.some(name=>!isDigest(value.files[name]))) throw Error(manifestError);
 if (value.network_id!==draft.network || exactObservationU64(value.chain_id)!==draft.chain || value.node_name!==draft.node) {
  throw Error('The commissioning network, chain, or node name differs from the current provisioning draft.');
 }
 return {network:draft.network,chain:draft.chain,policyPin:value.files['config/start-authorized.json'],
  publicPins:Object.fromEntries(publicNames.map(name=>[name,value.files[`network/${name}`]]))};
}

export async function readCommissioningStartupPolicy(file,manifest,current = ()=>true) {
 const bytes = await selectedBytes(file,startupLimit,current);
 if (!current() || !bytes) return null;
 const sha256 = await localSha256(bytes);
 if (!current()) return null;
 if (sha256!==manifest.policyPin) throw Error('The selected startup policy SHA-256 differs from the commissioning manifest.');
 const value = parsed(bytes,policyError);
 if (!fieldsMatch(value,['network_id','chain_id','all_validators_ready','all_pairs_vpn_verified',
  'validator_addresses','profile','production_approved','public_file_sha256']) || value.profile!==profile
  || value.production_approved!==false || value.all_validators_ready!==true || value.all_pairs_vpn_verified!==true
  || !Array.isArray(value.validator_addresses) || value.validator_addresses.length<1 || value.validator_addresses.length>maxValidators
  || !value.validator_addresses.every(validatorId) || new Set(value.validator_addresses).size!==value.validator_addresses.length
  || !fieldsMatch(value.public_file_sha256,publicNames) || publicNames.some(name=>!isDigest(value.public_file_sha256[name]))) throw Error(policyError);
 if (value.network_id!==manifest.network || exactObservationU64(value.chain_id)!==manifest.chain) {
  throw Error('The startup policy network or chain differs from the commissioning manifest.');
 }
 if (publicNames.some(name=>value.public_file_sha256[name]!==manifest.publicPins[name])) {
  throw Error('The startup policy and commissioning manifest disagree on the public file digests.');
 }
 return {roster:new Set(value.validator_addresses)};
}

function authorityRoster(bytes,manifest) {
 const authority = parsed(bytes,authorityError,32)?.payload;
 if (!object(authority) || exactObservationU64(authority.version)!=='1'
  || !Array.isArray(authority.validators) || authority.validators.length<1 || authority.validators.length>maxValidators) throw Error(authorityError);
 if (authority.network_id!==manifest.network || exactObservationU64(authority.chain_id)!==manifest.chain) {
  throw Error('The authority file network or chain differs from the commissioning manifest.');
 }
 const seen = new Set();
 const active = new Set();
 for (const entry of authority.validators) {
  const {validator_id:id,status} = entry?.record ?? {};
  if (!validatorId(id) || !statuses.has(status) || seen.has(id)) throw Error(authorityError);
  seen.add(id);
  if (status==='active') active.add(id);
 }
 return active;
}

export async function reviewCommissioningPublicArtifacts(files,manifest,policy,current = ()=>true) {
 if (!Array.isArray(files) || files.length!==publicNames.length) {
  throw Error('Select exactly the six named public network files for this review.');
 }
 const selected = new Map(files.map(file=>[file?.name,file]));
 if (selected.size!==publicNames.length || publicNames.some(name=>!selected.has(name))) {
  throw Error('Select exactly the six named public network files for this review.');
 }
 const mismatches = [];
 let authority;
 for (const {name,maxBytes} of commissioningPublicArtifacts) {
  const bytes = await selectedBytes(selected.get(name),maxBytes,current);
  if (!current() || !bytes) return null;
  const sha256 = await localSha256(bytes);
  if (!current()) return null;
  if (sha256!==manifest.publicPins[name]) mismatches.push(name);
  else if (name==='authority.json') authority=bytes;
 }
 if (mismatches.length) return {status:'digest-mismatch',mismatches};
 const active = authorityRoster(authority,manifest);
 return {status:'compared',allPublicDigestsMatch:true,policyCount:policy.roster.size,activeCount:active.size,
  rosterMatches:active.size===policy.roster.size && [...active].every(id=>policy.roster.has(id))};
}
