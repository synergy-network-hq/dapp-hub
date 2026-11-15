import {useState} from 'react';
import {Detail, Resource, useNative, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {atlasAccountKey} from './atlas-account.js';
import {canReadWalletAtlas} from './atlas-scope.js';
import {checkConfiguredReceiptGenesis, rpcReceiptObservation, rpcReceiptReadiness, rpcReceiptSelection} from './rpc-receipt-observation.js';
import {blockLookupHeight, reportedBlockMembership} from './transaction-observation.js';

const blockMessages = {
  listed: 'The reported receipt block lists this transaction.',
  notListed: 'The matching reported block does not list this transaction.',
  unavailable: 'The selected RPC returned no block at the receipt height.',
  unsupported: 'The block hash matches the receipt. A supported transaction hash list is unavailable.',
  ambiguous: 'The block hash matches the receipt. The block listed this transaction more than once.',
  differentHash: 'The selected RPC returned a different block hash at the receipt height.',
};

function receiptRpc(readRpc, canRead, signal) {
  function checkScope() {
    signal.throwIfAborted();
    if (!canRead()) throw Error('Wallet receipt access is unavailable in this Portal context.');
  }
  return async (method, params, options) => {
    checkScope();
    const value = await readRpc(method, params, options);
    checkScope();
    return value;
  };
}

function ReceiptBlockLookup({receipt, hash, endpoint, readRpc, canRead}) {
  const height = blockLookupHeight(receipt.height);
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision || height === null) return null;
    const request = receiptRpc(readRpc, canRead, signal);
    let readiness;
    try {
      readiness = await readProtocolObservation(request, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    } catch {
      throw Error('The selected RPC chain context could not be rechecked. Try again.');
    }
    const current = readiness.chain;
    checkConfiguredReceiptGenesis(current, endpoint.genesisHash);
    const expected = receipt.chain;
    if (current.chainId !== expected.chainId || current.network !== expected.network ||
        current.incarnation !== expected.incarnation || current.genesis !== expected.genesis) {
      throw Error('The RPC chain context changed. Refresh the receipt before checking its block.');
    }
    let value;
    try {
      value = await request('synergy_getBlockByNumber', [height], {endpoint: endpoint.rpc, signal});
    } catch {
      throw Error('The selected RPC receipt block check could not be completed. Try again.');
    }
    return {...reportedBlockMembership(value, height, hash, receipt.blockHash), checkedAt: new Date().toISOString()};
  }, revision);

  if (height === null) return <p>The receipt block height cannot be sent as an exact RPC integer.</p>;
  if (!revision) return <button onClick={check}>Check receipt block on selected RPC</button>;
  return <section aria-label="Receipt block observation">
    <h5>Receipt block check</h5>
    <Resource value={{...observation, reload: check}}>{value => <>
      <p role="status">{blockMessages[value.state]}</p>
      {value.hash && <p>Checked block hash: {value.hash}</p>}
      <p>Receipt block checked <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>
      <button onClick={check}>Check receipt block again</button>
    </>}</Resource>
  </section>;
}

function RpcReceiptLookup({selection, endpoint, readRpc, canRead}) {
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision) return null;
    const request = receiptRpc(readRpc, canRead, signal);
    let readiness;
    try {
      readiness = await readProtocolObservation(request, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    } catch {
      throw Error('The selected RPC chain context could not be checked. Try again.');
    }
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    let value;
    try {
      value = await request('synergy_getTransactionReceipt', [selection.hash], {endpoint: endpoint.rpc, signal});
    } catch {
      throw Error('The selected RPC receipt check could not be completed. Try again.');
    }
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
        <ReceiptBlockLookup key={revision} hash={selection.hash} {...{receipt, endpoint, readRpc, canRead}}/>
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
  const scope = JSON.stringify([selection, endpoint.id, endpoint.rpc, endpoint.networkKey, endpoint.chainId,
    endpoint.genesisHash, n.walletConsentSession]);
  return <RpcReceiptLookup key={scope} {...{selection, endpoint, readRpc, canRead}}/>;
}
