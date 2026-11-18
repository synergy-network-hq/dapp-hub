export function genesisDigest(value) {
 return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value)
  ? value.toLowerCase() : null;
}

export function confirmReportedGenesis(value, expected) {
 const reported = genesisDigest(value);
 if (!reported) throw Error('The selected RPC returned an unsupported Genesis hash.');
 if (reported !== expected) throw Error('The selected RPC Genesis hash does not match the configured pin.');
 return reported;
}
