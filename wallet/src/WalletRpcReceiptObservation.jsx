import {useState} from 'react';
import {Detail, Resource, useNative, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {atlasAccountKey} from './atlas-account.js';
import {canReadWalletAtlas} from './atlas-scope.js';
import {rpcReceiptObservation, rpcReceiptReadiness, rpcReceiptSelection} from './rpc-receipt-observation.js';

function RpcReceiptLookup({selection, endpoint, readRpc, canRead}) {
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!canRead()) throw Error('Wallet receipt access is unavailable in this Portal context.');
    }
    function scopedRpc(method, params, options) {
      checkScope();
      return readRpc(method, params, options);
    }

    let readiness;
    try {
      readiness = await readProtocolObservation(scopedRpc, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    } catch {
      throw Error('The selected RPC chain context could not be checked. Try again.');
    }
    checkScope();
    let value;
    try {
      value = await scopedRpc('synergy_getTransactionReceipt', [selection.hash], {endpoint: endpoint.rpc, signal});
    } catch {
      throw Error('The selected RPC receipt check could not be completed. Try again.');
    }
    checkScope();
    return {receipt: rpcReceiptObservation(value, selection, readiness), checkedAt: new Date().toISOString()};
  }, revision);

  if (!revision) return <button onClick={check}>Check receipt on selected RPC</button>;
  return <section aria-label="Selected RPC receipt observation">
    <h4>Selected RPC receipt</h4>
    <Resource value={{...observation, reload: check}}>{({receipt, checkedAt}) => <>
      {receipt ? <>
        <Detail data={{
          receiptStatus: receipt.status === '0x1' ? '0x1 · Success reported' : '0x0 · Failure reported',
          rpcReceiptBlock: receipt.height,
          rpcReceiptBlockHash: receipt.blockHash,
          reportedRpcTip: receipt.tip ?? 'Unavailable',
        }}/>
        {receipt.tip !== null && BigInt(receipt.height) > BigInt(receipt.tip) &&
          <p role="status">The RPC returned a receipt above its reported chain tip.</p>}
      </> : <p role="status">The selected RPC returned no receipt for this transaction.</p>}
      <p>RPC receipt checked <time dateTime={checkedAt}>{checkedAt}</time></p>
      <button onClick={check}>Check RPC receipt again</button>
    </>}</Resource>
    <p>The selected RPC can return retained receipts. Chain inclusion, finality and settlement remain unverified.</p>
  </section>;
}

export function WalletRpcReceiptObservation({row, account, endpoint, readRpc}) {
  const n = useNative();
  const selection = rpcReceiptSelection(row, account);
  const accountKey = atlasAccountKey(account);
  const canRead = () => canReadWalletAtlas(n, endpoint) && atlasAccountKey(n.wallet.connection.address) === accountKey;
  if (!selection || !canRead()) return null;
  const scope = JSON.stringify([selection, endpoint.id, endpoint.rpc, endpoint.networkKey, n.walletConsentSession]);
  return <RpcReceiptLookup key={scope} {...{selection, endpoint, readRpc, canRead}}/>;
}
