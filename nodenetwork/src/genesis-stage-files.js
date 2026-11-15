export const genesisStageFiles = [
 {name: 'genesis.json', pin: 'genesis_sha256', maxBytes: 4 * 1024 * 1024, utf8: true},
 {name: 'authority.json', pin: 'authority_sha256', maxBytes: 1024 * 1024, utf8: true},
 {name: 'authority-root.pub', pin: 'authority_root_sha256', maxBytes: 8 * 1024, utf8: false},
];

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
 const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
