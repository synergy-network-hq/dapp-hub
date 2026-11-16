import {genesisDigest} from './genesis-pin.js';
import {parseExactNumbers} from './validator-operations-observation.js';

export const replacementRecoveryLimit = 1024 * 1024;
const manifestName = 'recovery.json';
const toolNames = ['apqe_layout.py','lifecycle.py','synergy_linux.py'];
const members = new Set([...toolNames,manifestName]);
const blockSize = 512;
const unsupportedArchive = 'The file is not a supported finish-replacement tar.';
const unsupportedManifest = 'The recovery archive contains an invalid recovery manifest.';
const decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});

export function replacementRecoveryPins(base,archive) {
 const basePin = genesisDigest(base);
 const archivePin = genesisDigest(archive);
 return basePin && archivePin ? {base:basePin,archive:archivePin} : null;
}

const zeroes = bytes => !bytes.some(byte => byte !== 0);
const exactFields = (value,fields) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value,field));

function checkedHeader(header) {
 const names = header.subarray(0,100);
 const end = names.indexOf(0);
 if (end < 1 || !zeroes(names.subarray(end)) || header[156] !== 48
  || !zeroes(header.subarray(157,257)) || !zeroes(header.subarray(345,512))
  || decoder.decode(header.subarray(257,265)) !== 'ustar\u000000'
  || decoder.decode(header.subarray(100,108)) !== '0000600\u0000') throw Error(unsupportedArchive);

 const name = decoder.decode(names.subarray(0,end));
 const sizeText = decoder.decode(header.subarray(124,136));
 const checksumText = decoder.decode(header.subarray(148,156));
 if (!members.has(name) || !/^[0-7]{11}\x00$/.test(sizeText) || !/^[0-7]{6}\x00 $/.test(checksumText)) throw Error(unsupportedArchive);
 const checksum = header.reduce((sum,byte,index) => sum + (index >= 148 && index < 156 ? 32 : byte),0);
 const size = Number.parseInt(sizeText,8);
 if (checksum !== Number.parseInt(checksumText,8) || size < 1 || size > replacementRecoveryLimit
  || (name === manifestName && size > 16 * 1024)) throw Error(unsupportedArchive);
 return {name,size};
}

function archiveMembers(bytes) {
 if (bytes.length % blockSize !== 0) throw Error(unsupportedArchive);
 const files = new Map();
 let offset = 0;
 while (offset + 2 * blockSize <= bytes.length) {
  const header = bytes.subarray(offset,offset + blockSize);
  if (zeroes(header)) {
   if (files.size === members.size && zeroes(bytes.subarray(offset))) return files;
   throw Error(unsupportedArchive);
  }
  const {name,size} = checkedHeader(header);
  const body = offset + blockSize;
  const end = body + size;
  const next = body + Math.ceil(size / blockSize) * blockSize;
  if (files.has(name) || next > bytes.length || !zeroes(bytes.subarray(end,next))) throw Error(unsupportedArchive);
  files.set(name,bytes.subarray(body,end));
  offset = next;
 }
 throw Error(unsupportedArchive);
}

function recoveryManifest(bytes) {
 let manifest;
 try {manifest = parseExactNumbers(decoder.decode(bytes));} catch {throw Error(unsupportedManifest);}
 const digest = value => typeof value === 'string' && genesisDigest(value) === value;
 if (!exactFields(manifest,['format','base_package_sha256','files']) || manifest.format !== 'synergy-finish-replacement-v1'
  || !digest(manifest.base_package_sha256) || !exactFields(manifest.files,toolNames)
  || toolNames.some(name => !digest(manifest.files[name]))) throw Error(unsupportedManifest);
 return manifest;
}

async function sha256(bytes) {
 const digest = await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function readReplacementRecoveryFile(file,pins,current = () => true) {
 const expected = replacementRecoveryPins(pins?.base,pins?.archive);
 if (!expected) throw Error('Enter both expected SHA-256 digests before reviewing the bundle.');
 if (!Number.isSafeInteger(file?.size) || file.size < 2 * blockSize || file.size > replacementRecoveryLimit) {
  throw Error('Choose a finish-replacement tar of at most 1 MiB.');
 }
 if (!globalThis.crypto?.subtle) throw Error('Local SHA-256 is unavailable in this Portal runtime.');
 if (!current()) return null;
 let bytes;
 try {
  const buffer = await file.arrayBuffer();
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) throw Error();
  bytes = new Uint8Array(buffer);
 } catch {throw Error('The replacement recovery tar could not be read in full.');}
 if (!current()) return null;
 let files;
 try {files = archiveMembers(bytes);} catch {throw Error(unsupportedArchive);}
 const manifest = recoveryManifest(files.get(manifestName));
 for (const name of toolNames) {
  const digest = await sha256(files.get(name));
  if (!current()) return null;
  if (digest !== manifest.files[name]) throw Error('A recovery tool digest differs from the embedded manifest.');
 }
 const archiveSha256 = await sha256(bytes);
 if (!current()) return null;
 return {archiveSha256,basePackageSha256:manifest.base_package_sha256,verifiedToolFiles:toolNames.length,
  archivePinMatches:archiveSha256 === expected.archive,basePinMatches:manifest.base_package_sha256 === expected.base};
}
