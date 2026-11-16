import {genesisDigest} from './genesis-pin.js';
import {localSha256} from './local-sha256.js';
import {exactJsonNumber, parseExactNumbers} from './validator-operations-observation.js';

export const savedVpnRecordLimit = 32 * 1024;

// Testnet v3 613fa6ab: vpn.py bind_server writes the binding. lifecycle.py
// remove consumes only the retirement peer ID and the two Boolean flags.
const bindingMethod = 'fresh peer ID + one-off enrollment evidence + unique peer name + native IP';
const bindingFields = [
 'peer_id','wireguard_public_key','ip','hostname','peer_name','server_binding_verified',
 'binding_method','one_off_usage_evidence','management_public_key_exposed',
];

function recordText(value) {
 return typeof value === 'string' && value.trim() && !exactJsonNumber(value) && !/[\u0000-\u001f\u007f]/.test(value)
  ? value : null;
}

function addressLiteral(value) {
 if (!recordText(value)) return false;
 if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value)) {
  return value.split('.').every(octet=>Number(octet)<=255);
 }
 if (!value.includes(':') || !/^[a-f0-9:.]{2,45}$/i.test(value)) return false;
 try {
  return Boolean(new URL(`http://[${value}]/`).hostname);
 } catch {
  return false;
 }
}

function bindingPeer(record) {
 if (Object.keys(record).length !== bindingFields.length || !bindingFields.every(field=>Object.hasOwn(record,field))) return null;
 const {peer_id,wireguard_public_key,ip,hostname,peer_name} = record;
 // vpn.enroll restricts the attributed peer name. The separate operating
 // system hostname may differ. bind_server copies provider usage evidence as-is.
 return record.server_binding_verified === true && record.management_public_key_exposed === false
  && record.binding_method === bindingMethod && recordText(wireguard_public_key) && addressLiteral(ip)
  && recordText(hostname) && /^[\p{L}\p{N}_.-]{1,253}$/u.test(hostname)
  && recordText(peer_name) && /^[A-Za-z0-9_-]{1,63}$/.test(peer_name) ? recordText(peer_id) : null;
}

function retirementClaims(record) {
 const peerId = recordText(record.peer_id);
 const flags = ['retired','absence_verified'];
 if (!peerId || flags.some(flag => Object.hasOwn(record,flag) && typeof record[flag] !== 'boolean')) return null;
 return {peerId,retired:record.retired ?? null,absenceVerified:record.absence_verified ?? null};
}

function assertCurrent(current) {
 if (!current()) throw Error('The saved VPN review is no longer current.');
}

async function reviewFile(file, pin, readRecord, current) {
 assertCurrent(current);
 if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > savedVpnRecordLimit) return {status:'unavailable'};
 let bytes, actual;
 try {
  bytes = await file.arrayBuffer();
 } catch {
  assertCurrent(current);
  return {status:'unavailable'};
 }
 assertCurrent(current);
 if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) return {status:'unavailable'};
 try {
  actual = await localSha256(bytes);
 } catch {
  assertCurrent(current);
  return {status:'unavailable'};
 }
 assertCurrent(current);
 if (actual !== pin) return {status:'pin-mismatch'};
 try {
  const raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const record = parseExactNumbers(raw);
  const claims = record && typeof record === 'object' && !Array.isArray(record) ? readRecord(record) : null;
  if (claims) return {status:'matched',claims};
 } catch {
  // Decoder and parser errors can include the private input.
 }
 return {status:'format-unsupported'};
}

export function savedVpnRetirementPins(binding, retirement) {
 const bindingPin=genesisDigest(binding), retirementPin=genesisDigest(retirement);
 return bindingPin && retirementPin ? {bindingPin,retirementPin} : null;
}

export async function compareSavedVpnRetirement(files, pins, current = () => true) {
 const expected = savedVpnRetirementPins(pins?.bindingPin,pins?.retirementPin);
 if (!expected) throw Error('Both independently supplied SHA-256 pins are required.');
 const binding = await reviewFile(files.binding,expected.bindingPin,bindingPeer,current);
 const retirement = await reviewFile(files.retirement,expected.retirementPin,retirementClaims,current);
 assertCurrent(current);
 return {
  bindingStatus:binding.status,
  retirementStatus:retirement.status,
  peerMatches:binding.claims && retirement.claims ? binding.claims === retirement.claims.peerId : null,
  retired:retirement.claims?.retired ?? null,
  absenceVerified:retirement.claims?.absenceVerified ?? null,
 };
}
