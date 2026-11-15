import {unsignedObservation} from '@synergy-network/dapp-data-view/protocol-observations';

export const syncHistoryKey = 'synergy-nodenetwork:rpc-sync-history:v1';
export const syncHistoryLimit = 24;
const unsupported = 'Saved public sync history is unsupported. The original record is retained.';

const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const isSourceKey = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isToken = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value);
const isHeight = value => typeof value === 'string' && unsignedObservation(value) === value;

export async function syncHistorySource(profile) {
 if (!globalThis.crypto?.subtle) throw Error('This window cannot identify the local sync history for the selected RPC.');
 const bytes = new TextEncoder().encode(JSON.stringify([profile.id, profile.rpc, Number(profile.chainId)]));
 const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validSample(sample) {
 if (!exactFields(sample, ['source', 'chain', 'receivedAt', 'current', 'highest']) || !isSourceKey(sample.source)
  || !Number.isSafeInteger(sample.receivedAt) || sample.receivedAt < 0 || sample.receivedAt > 8640000000000000) return false;
 const {chain} = sample;
 return exactFields(chain, ['chainId', 'network', 'incarnation', 'genesis'])
  && Number.isSafeInteger(chain.chainId) && chain.chainId > 0 && isToken(chain.network) && isToken(chain.genesis)
  && isHeight(chain.incarnation) && isHeight(sample.current) && isHeight(sample.highest);
}

function sameChain(a, b) {
 return a.chainId === b.chainId && a.network === b.network && a.incarnation === b.incarnation && a.genesis === b.genesis;
}

export function readSyncHistory(storage) {
 let raw;
 try {
  raw = (storage ?? localStorage).getItem(syncHistoryKey);
 } catch {
  throw Error('Device storage is unavailable for public sync history.');
 }
 if (raw === null) return {version: 1, samples: []};
 try {
  if (raw.length > 98304) throw Error(unsupported);
  const saved = JSON.parse(raw);
  if (!exactFields(saved, ['version', 'samples']) || saved.version !== 1 || !Array.isArray(saved.samples)
   || saved.samples.length > syncHistoryLimit || !saved.samples.every(validSample)) {
   throw Error(unsupported);
  }
  const seen = new Set();
  for (const [index, sample] of saved.samples.entries()) {
   const {chain, receivedAt, source} = sample;
   const identity = JSON.stringify([source, chain.chainId, chain.network, chain.incarnation, chain.genesis, receivedAt]);
   if (seen.has(identity) || (index > 0 && receivedAt > saved.samples[index - 1].receivedAt)) throw Error(unsupported);
   seen.add(identity);
  }
  return saved;
 } catch {
  throw Error(unsupported);
 }
}

export function selectSyncHistory(history, source, reportedChain) {
 const samples = history.samples.filter(sample => sample.source === source);
 const chain = reportedChain ?? samples[0]?.chain;
 return chain ? samples.filter(sample => sameChain(sample.chain, chain)) : [];
}

export function saveSyncSample(source, observation, storage) {
 const {chain, sync, receivedAt} = observation;
 const sample = {source, chain, receivedAt, current: sync?.current, highest: sync?.highest};
 if (sync?.mode !== 'reported' || !validSample(sample)) throw Error('No supported public sync sample is available to save.');
 // Read the latest history before appending. Local storage has no atomic read-modify-write.
 const history = readSyncHistory(storage);
 const [latest] = selectSyncHistory(history, source, chain);
 if (latest?.receivedAt >= receivedAt) throw Error('This RPC context already has a saved sample at this time or later.');

 const samples = [sample, ...history.samples].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, syncHistoryLimit);
 if (!samples.includes(sample)) throw Error('This observation is older than the retained history. Refresh the RPC report.');
 const saved = {version: 1, samples};
 try {
  (storage ?? localStorage).setItem(syncHistoryKey, JSON.stringify(saved));
 } catch {
  throw Error('The public sync sample could not be saved. The previous history is retained.');
 }
 return saved;
}

export function syncHistoryRows(samples) {
 return samples.map((sample, index) => {
  const predecessor = samples[index + 1];
  const gap = BigInt(sample.highest) - BigInt(sample.current);
  const change = predecessor ? BigInt(sample.current) - BigInt(predecessor.current) : null;
  return {
   id: sample.receivedAt,
   received: new Date(sample.receivedAt).toISOString(),
   current: sample.current,
   highest: sample.highest,
   gap: gap >= 0n ? String(gap) : 'Reference below local block',
   change: change === null ? 'No earlier sample' : `${change > 0n ? '+' : ''}${change}`,
  };
 });
}
