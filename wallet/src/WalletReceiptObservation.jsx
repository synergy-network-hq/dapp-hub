import {useState} from 'react';
import {atlas, Detail, Resource, useNative, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {atlasAccountKey} from './atlas-account.js';
import {atlasReceiptObservation, blockHeight} from './transaction-observation.js';

function ReceiptLookup({hash, account, height, permit}) {
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision) return null;
    signal.throwIfAborted();
    if (!permit('wallet', 'readWallet')) throw Error('Wallet receipt access is unavailable in this Portal context.');

    let result;
    try {
      result = await atlas(`txs/${encodeURIComponent(hash)}`, {signal});
    } catch {
      throw Error('The Atlas receipt check could not be completed. Try again.');
    }
    signal.throwIfAborted();
    if (!permit('wallet', 'readWallet')) throw Error('Wallet receipt access is unavailable in this Portal context.');
    return {...atlasReceiptObservation(result, hash, account, height), checkedAt: new Date().toISOString()};
  }, revision);

  if (!revision) return <button onClick={check}>Check receipt in Atlas</button>;
  return <section aria-label="Atlas receipt observation">
    <h4>Atlas-reported receipt</h4>
    <Resource value={{...observation, reload: check}}>{value => <>
      {value.kind === 'reported' ? <Detail data={{
        receiptStatus: value.receiptStatus === '0x1' ? '0x1 · Success reported' : '0x0 · Failure reported',
        synqExecutionStatus: value.executionStatus ?? 'Unavailable',
      }}/> : <p role="status">{value.kind === 'fallback'
        ? 'Atlas returned a fallback transaction outside the index.' : 'Atlas returned no receipt status for this transaction.'}</p>}
      <p>Atlas receipt checked <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>
      <button onClick={check}>Check Atlas receipt again</button>
    </>}</Resource>
    <p>Atlas reports these receipt fields. Independent receipt, finality and reorganization verification remain unavailable here.</p>
  </section>;
}

export function WalletReceiptObservation({hash, account, block}) {
  const n = useNative();
  const height = blockHeight(block);
  if (height === null || !atlasAccountKey(account) || !n?.permit('wallet', 'readWallet')) return null;
  return <ReceiptLookup key={JSON.stringify([hash, account, height, n.walletConsentSession])}
    hash={hash} account={account} height={height} permit={n.permit}/>;
}
