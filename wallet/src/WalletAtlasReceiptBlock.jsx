import {useState} from 'react';
import {Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readScopedWalletAtlas} from './atlas-scope.js';
import {blockHeight, reportedBlockMembership} from './transaction-observation.js';

const messages = {
  listed: 'Atlas reports the same block hash and lists this transaction.',
  notListed: 'Atlas reports the same block hash. Its list does not contain this transaction.',
  unavailable: 'Atlas returned no block at the receipt height.',
  unsupported: 'Atlas reports the same block hash. A complete transaction hash list is unavailable.',
  ambiguous: 'Atlas reports the same block hash. Its list contains this transaction more than once.',
  differentHash: 'Atlas and the RPC receipt report different block hashes at this height.',
};

function atlasBlockObservation(value, receipt, hash) {
  if (value === null) return {state: 'unavailable', hash: null};
  if (blockHeight(value?.number) !== receipt.height || typeof value?.hash !== 'string' ||
      value.hash.length !== 64 || !/^[a-f0-9]{64}$/i.test(value.hash)) {
    throw Error('Atlas returned a different or unsupported block identity.');
  }
  const rows = value.transactions;
  const sameHeight = Array.isArray(rows) && rows.length <= 10_000 &&
    rows.every(row => blockHeight(row?.block_number) === receipt.height);
  const observation = reportedBlockMembership({block_index: receipt.height, hash: value.hash,
    tx_count: value.txCount, transactions: sameHeight ? rows : null}, receipt.height, hash, receipt.blockHash);
  if ((observation.state === 'listed' || observation.state === 'notListed') &&
      new Set(rows.map(row => row.hash.toLowerCase())).size !== rows.length) {
    return {...observation, state: 'unsupported'};
  }
  return observation;
}

export function WalletAtlasReceiptBlock({receipt, hash, native, canRead}) {
  const supported = BigInt(receipt.height) <= 9223372036854775807n;
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision || !supported) return null;
    signal.throwIfAborted();
    if (!canRead()) throw Error('Wallet receipt block access is unavailable in this Portal context.');
    let value;
    try {
      value = await readScopedWalletAtlas(native, `blocks/${receipt.height}?includeTx=true`, {signal});
    } catch {
      throw Error('The Atlas receipt block check could not be completed. Try again.');
    }
    signal.throwIfAborted();
    if (!canRead()) throw Error('Wallet receipt block access is unavailable in this Portal context.');
    return {...atlasBlockObservation(value, receipt, hash), checkedAt: new Date().toISOString()};
  }, revision);

  if (!supported) return <p>The receipt block height exceeds the Atlas index range.</p>;
  if (!revision) return <button onClick={check}>Check receipt block in Atlas</button>;
  return <section aria-label="Atlas receipt block observation">
    <h5>Atlas receipt block</h5>
    <Resource value={{...observation, reload: check}}>{value => <>
      <p role="status">{messages[value.state]}</p>
      {value.hash && <p>Atlas block hash: {value.hash}</p>}
      <p>Atlas block checked <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>
      <button onClick={check}>Check Atlas receipt block again</button>
    </>}</Resource>
  </section>;
}
