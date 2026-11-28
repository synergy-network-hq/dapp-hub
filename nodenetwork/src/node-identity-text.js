// Text parsing only; APQE verifies network, derivation and authority.
export function validatorIdentityText(value, {allowHistorical = true} = {}) {
 if (typeof value !== 'string' || value.length > 128) throw Error('Enter a SYNV validator address.');
 if (value.includes('.')) {
  if (!/^synv1\.2\.[A-Za-z0-9_-]{64}$/.test(value)) throw Error('Enter the exact full-width SYNV class I identity.');
  return value;
 }
 if (!allowHistorical) throw Error('A current full-width SYNV class I identity is required.');
 const historical = value.trim().toLowerCase();
 if (!/^synv[a-z0-9]{34,92}$/.test(historical)) throw Error('Enter a SYNV validator address with 38–96 letters and digits.');
 return historical;
}
export function sameValidatorIdentity(reported, expected) {
 try {
  const canonical = validatorIdentityText(expected);
  return validatorIdentityText(reported, {allowHistorical: !canonical.includes('.')}) === canonical;
 } catch { return false; }
}
