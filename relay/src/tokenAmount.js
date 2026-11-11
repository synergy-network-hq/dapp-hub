const DECIMAL_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*)?$|^0?\.[0-9]+$/;

export function decimalToRawAmount(input, decimals) {
  if(!Number.isInteger(decimals)||decimals<0||decimals>36||typeof input!=="string"||input.length>120)return null;
  const value = input.trim();
  if (!DECIMAL_RE.test(value)) return null;
  const [wholePart, fractionPart = ""] = value.split(".");
  if (fractionPart.length > decimals) return null;
  const whole = wholePart || "0";
  const fraction = fractionPart.padEnd(decimals, "0");
  const raw = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  return raw.length<=78?(raw || "0"):null;
}

export function rawAmountToDecimal(rawInput, decimals, maxFractionDigits = 6) {
  if(!Number.isInteger(decimals)||decimals<0||decimals>36||typeof rawInput!=="string"||rawInput.length>78)return "Unavailable";
  const raw = String(rawInput ?? "").replace(/^0+(?=\d)/, "");
  if (!/^[0-9]+$/.test(raw)) return "Unavailable";
  const padded = raw.padStart(decimals + 1, "0");
  const whole = (decimals?padded.slice(0, -decimals):raw) || "0";
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  const clipped = fraction.slice(0, maxFractionDigits);
  return clipped ? `${whole}.${clipped}` : whole;
}

export function rawAmountIsPositive(rawInput) {
  try {
    return BigInt(String(rawInput || "0")) > 0n;
  } catch {
    return false;
  }
}

export function decimalInputIsValid(input, decimals) {
  const raw = decimalToRawAmount(input, decimals);
  return raw !== null && rawAmountIsPositive(raw);
}
