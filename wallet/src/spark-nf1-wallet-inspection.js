import {readSparkNf1DraftReview} from './spark-nf1-draft.js';

// synergy-wallet 134cfa2, tools/chain1266-sts/{src/main.rs,gui/MintWallet.swift}.
export const MAX_NATIVE_INSPECTION_BYTES = 128 * 1024;
const maximumGasPriceNwei = '40';
const maximumBalanceReserveNwei = '100000000';
const unsupported = 'Choose a supported native Wallet inspection report.';
const numberMarker = '\u0000';

function parseInspection(source) {
  // Validate JSON syntax and then preserve the literal digits before binary64
  // rounding. Track decoded member names so escapes cannot hide duplicates.
  JSON.parse(source);
  const objectKeys = [];
  const tokens = /("(?:[^"\\]|\\[\s\S])*")([ \t\r\n]*:)?|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[{}\[\]]/g;
  const exact = source.replace(tokens, (token, quoted, separator) => {
    if (quoted !== undefined) {
      const text = JSON.parse(quoted);
      if (text.includes(numberMarker)) throw Error(unsupported);
      if (separator) {
        const keys = objectKeys.at(-1);
        if (keys.has(text)) throw Error(unsupported);
        keys.add(text);
      }
      return token;
    }
    if (token === '{') {
      if (objectKeys.length >= 8) throw Error(unsupported);
      objectKeys.push(new Set());
      return token;
    }
    if (token === '}') {
      objectKeys.pop();
      return token;
    }
    if (token === '[' || token === ']') throw Error(unsupported);
    return JSON.stringify(numberMarker + token);
  });
  return JSON.parse(exact);
}

function sameInspection(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (actual === null || typeof actual !== 'object') return false;
  const entries = Object.entries(expected);
  return Object.keys(actual).length === entries.length &&
    entries.every(([key, value]) => Object.hasOwn(actual, key) && sameInspection(actual[key], value));
}

export function compareSparkNf1WalletInspection(bytes, draftBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw Error(unsupported);
  if (bytes.length > MAX_NATIVE_INSPECTION_BYTES) throw Error('The inspection report exceeds 128 KiB.');
  const {draft, payloadJson} = readSparkNf1DraftReview(draftBytes);
  let report;
  try {
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
    report = parseInspection(text);
  } catch {
    throw Error(unsupported);
  }
  if (typeof report?.draft_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(report.draft_sha256)) throw Error(unsupported);
  if (report.draft_sha256 !== draft.sha256) throw Error('The inspection report describes a different unsigned draft.');
  const purchasePriceNwei = draft.action === 'buy' ? draft.priceNwei : '0';
  const expected = {
    draft_sha256: draft.sha256,
    review: {
      sender: draft.sender,
      maximum_carrier_gas_price_nwei: numberMarker + maximumGasPriceNwei,
      maximum_balance_reserve_nwei: maximumBalanceReserveNwei,
      purchase_price_nwei: purchasePriceNwei,
      payload: parseInspection(payloadJson),
    },
  };
  if (!sameInspection(report, expected)) throw Error('The inspection report differs from the draft payload or the native Wallet review limits.');
  return {maximumGasPriceNwei, maximumBalanceReserveNwei, purchasePriceNwei};
}
