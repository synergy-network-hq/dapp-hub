export function observedSnrgNwei(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== 'string' || value.trim() !== value || !/^[0-9]{1,78}$/.test(value)) return null;
  return BigInt(value).toString();
}
