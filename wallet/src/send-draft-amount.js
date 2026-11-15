const decimals = 9;
const maxNwei = (1n << 64n) - 1n;

export function parseSnrgDraftAmount(value) {
  if (typeof value !== 'string' || value.length > 64) {
    throw Error('Enter an SNRG amount within the supported range.');
  }
  const text = value.trim();
  if (!text) throw Error('Enter an SNRG amount.');
  if (!/^(?:\d+|\d*\.\d+)$/.test(text)) throw Error('Enter a plain decimal amount without grouping.');

  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw Error('SNRG supports up to nine decimal places.');
  const nwei = BigInt((whole || '0') + fraction.padEnd(decimals, '0'));
  if (nwei === 0n) throw Error('The amount must be greater than zero.');
  if (nwei > maxNwei) throw Error('The amount exceeds the supported nWei range.');
  return nwei.toString();
}
