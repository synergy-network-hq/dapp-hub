export const SNRG_DECIMALS = 9;
export const NWEI_PER_SNRG = 1_000_000_000n;

function normalizeDecimalInput(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) {
    throw new Error('Amount is required.');
  }
  if (!/^\+?(?:\d+|\d*\.\d+)$/.test(text)) {
    throw new Error('Amount must be a plain SNRG number.');
  }
  return text.startsWith('+') ? text.slice(1) : text;
}

function parseUnsignedInteger(value, label) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  return BigInt(text);
}

export function parseSnrgToNwei(value) {
  const text = normalizeDecimalInput(value);
  const [wholeRaw, fractionRaw = ''] = text.split('.');
  const whole = wholeRaw || '0';
  if (fractionRaw.length > SNRG_DECIMALS) {
    throw new Error(`SNRG supports up to ${SNRG_DECIMALS} decimal places.`);
  }

  const fraction = fractionRaw.padEnd(SNRG_DECIMALS, '0');
  const nwei = parseUnsignedInteger(whole, 'SNRG amount') * NWEI_PER_SNRG
    + parseUnsignedInteger(fraction || '0', 'SNRG fractional amount');

  if (nwei <= 0n) {
    throw new Error('Amount must be greater than zero.');
  }

  return nwei.toString();
}

export function formatNweiToSnrg(value, { minFractionDigits = 0, maxFractionDigits = SNRG_DECIMALS } = {}) {
  let nwei;
  try {
    nwei = parseUnsignedInteger(value, 'nWei amount');
  } catch {
    return String(value ?? '0');
  }

  const whole = nwei / NWEI_PER_SNRG;
  const fraction = nwei % NWEI_PER_SNRG;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let fractionText = fraction.toString().padStart(SNRG_DECIMALS, '0');
  fractionText = fractionText.slice(0, Math.max(0, maxFractionDigits));
  fractionText = fractionText.replace(/0+$/g, '');

  if (fractionText.length < minFractionDigits) {
    fractionText = fractionText.padEnd(minFractionDigits, '0');
  }

  return fractionText ? `${wholeText}.${fractionText}` : wholeText;
}

export function nweiToSnrgNumber(value) {
  let nwei;
  try {
    nwei = parseUnsignedInteger(value, 'nWei amount');
  } catch {
    return Number(value) || 0;
  }
  return Number(nwei) / Number(NWEI_PER_SNRG);
}
