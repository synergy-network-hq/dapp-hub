import {sameValidatorIdentity} from './node-identity-text.js';
import {unsignedObservation} from '@synergy-network/dapp-data-view/protocol-observations';

export const validatorBlockWindows = [
 {id: 'all', label: 'All returned blocks', milliseconds: null},
 {id: '24h', label: '24 hours before receipt', milliseconds: 86_400_000},
 {id: '7d', label: '7 days before receipt', milliseconds: 604_800_000},
];

function reportedTimestamp(value) {
 // Atlas serializes the TIMESTAMPTZ columns as UTC timestamps.
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
  throw Error('Unsupported Atlas timestamp.');
 }
 const timestamp = new Date(value).toISOString();
 if (value !== timestamp && value !== timestamp.replace('.000Z', 'Z')) throw Error('Unsupported Atlas timestamp.');
 return timestamp;
}

export function validatorBlockRows(value, address) {
 // The Atlas validator-detail query returns at most 50 address-bound records.
 if (!Array.isArray(value) || value.length > 50) return null;
 const identities = new Set();
 const heights = new Set();
 try {
  return value.map(row => {
   if (typeof row?.validator_address !== 'string' || !sameValidatorIdentity(row.validator_address, address)
    || typeof row.hash !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.hash)) {
    throw Error('Unsupported Atlas block attribution.');
   }
   const number = unsignedObservation(row.number);
   const hash = row.hash;
   const comparableHash = address.includes('.') ? hash : hash.toLowerCase();
   if (identities.has(comparableHash) || heights.has(number)) throw Error('Ambiguous Atlas block identity.');
   identities.add(comparableHash);
   heights.add(number);
   return {
    number,
    hash,
    blockTimestamp: reportedTimestamp(row.timestamp),
    indexedAt: row.indexed_at == null ? null : reportedTimestamp(row.indexed_at),
    transactions: row.tx_count == null ? null : unsignedObservation(row.tx_count),
   };
  });
 } catch {
  return null;
 }
}

export function filterValidatorBlocks(blocks, windowId, receivedAt) {
 const window = validatorBlockWindows.find(item => item.id === windowId);
 if (!window) throw Error('Unsupported block observation interval.');
 if (window.milliseconds === null) return blocks;
 const start = receivedAt - window.milliseconds;
 return blocks.filter(block => {
  const time = Date.parse(block.blockTimestamp);
  return time >= start && time <= receivedAt;
 });
}

export function reviewValidatorBlocks(observation, windowId) {
 if (!Array.isArray(observation.indexedBlocks)) throw Error('No supported indexed block observation.');
 const rows = filterValidatorBlocks(observation.indexedBlocks, windowId, observation.receivedAt);
 if (!rows.length) throw Error('Choose an interval with returned block observations.');
 return {
  schema: 'nodenetwork-indexed-validator-blocks-v1',
  source: 'Atlas public validator detail',
  validatorAddress: observation.address,
  receivedAt: new Date(observation.receivedAt).toISOString(),
  interval: windowId,
  blocks: rows.map(block => ({...block})),
 };
}
