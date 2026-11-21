export async function localSha256(bytes) {
 if (!globalThis.crypto?.subtle) throw Error('Local SHA-256 is unavailable in this Portal runtime.');
 const digest = await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
