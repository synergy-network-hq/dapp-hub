import {blockHeight} from './transaction-observation.js';

const blockHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value)
  ? value.toLowerCase() : null;

export function indexedHistorySnapshot(value) {
  const height = blockHeight(value?.blockNumber);
  const hash = blockHash(value?.blockHash);
  if (height === null || BigInt(height) > 9223372036854775807n || hash === null) return null;
  return {height, hash};
}

export async function checkIndexedHistorySnapshot(readAtlas, snapshot, signal) {
  signal.throwIfAborted();
  let value;
  try {
    value = await readAtlas(`blocks/${snapshot.height}`, {signal});
  } catch {
    throw Error('The Atlas snapshot block could not be checked. Try again.');
  }
  signal.throwIfAborted();
  const hash = blockHash(value?.hash);
  if (blockHeight(value?.number) !== snapshot.height || hash === null) {
    throw Error('Atlas did not return the requested snapshot block identity.');
  }
  return {changed: hash !== snapshot.hash, hash, checkedAt: new Date().toISOString()};
}
