export const maxU64 = 18446744073709551615n;
export const maxU128 = 340282366920938463463374607431768211455n;

export function exactRpcAmount(value, max) {
  const digits = Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  return typeof digits === 'string' && digits.trim() === digits && /^(0|[1-9][0-9]{0,38})$/.test(digits) &&
    BigInt(digits) <= max ? digits : null;
}
