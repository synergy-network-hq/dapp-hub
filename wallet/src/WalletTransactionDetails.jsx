import {useState} from 'react';
import {Copy, Detail, Resource, chainIdNumber, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount, text} from '@synergy-network/dapp-data-view';
import {indexedTransactionTime, transactionDirection} from './WalletActivity.jsx';
import {sourceRecords} from './source-records.js';
import {comparableTransactionHash, compareIndexedBlock, transactionObservation} from './transaction-observation.js';

const observations = {
  notFound: 'Selected RPC returned no transaction',
  pending: 'Pending in the selected RPC pool',
  inBlock: 'Reported in a block by the selected RPC',
};

function TransactionLookup({hash, account, endpoint, readRpc, indexedBlock}) {
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(previous => previous + 1);
  const result = useResource(async signal => {
    signal.throwIfAborted();
    let identity, payload;
    try {
      identity = await readRpc('synergy_getChainId', [], {endpoint: endpoint.rpc, signal});
    } catch {
      throw Error('The selected RPC chain check failed. Try again.');
    }
    if (chainIdNumber(identity) !== 1266) throw Error('The selected RPC reported a different chain ID.');
    signal.throwIfAborted();
    try {
      payload = await readRpc('synergy_getTransactionByHash', [hash], {endpoint: endpoint.rpc, signal});
    } catch {
      throw Error('The selected RPC transaction check failed. Try again.');
    }
    signal.throwIfAborted();
    return {...transactionObservation(payload, hash, account), receivedAt: Date.now()};
  }, JSON.stringify([account, hash, endpoint.id, endpoint.rpc, endpoint.chainId, endpoint.networkKey, revision]));

  return <section aria-label="Selected RPC transaction observation">
    <h4>Selected RPC observation</h4>
    <Resource value={{...result, reload: refresh}}>{value => {
      const difference = compareIndexedBlock(indexedBlock, value);
      const checkedAt = new Date(value.receivedAt).toISOString();
      return <>
        <p role="status">{observations[value.state]}</p>
        {value.block !== null && <p>Reported block: {value.block}</p>}
        {difference && <p>{difference}</p>}
        <p>Last checked: <time dateTime={checkedAt}>{checkedAt}</time></p>
        <button onClick={refresh}>Check RPC again</button>
      </>;
    }}</Resource>
    <p>The RPC observation can change. Finality and reorganization status remain unavailable.</p>
  </section>;
}

function IndexedDetails({row, account, endpoint, readRpc}) {
  const [checking, setChecking] = useState(false);
  const time = indexedTransactionTime(row);
  const block = row.block_number ?? row.blockNumber;
  const hashSupported = !!comparableTransactionHash(row.hash);
  const canCheck = hashSupported && typeof account === 'string' && !!account &&
    transactionDirection(row, account) !== 'Unclassified' && typeof readRpc === 'function' &&
    !!endpoint?.rpc && Number(endpoint.chainId) === 1266;

  return <>
    <Detail data={{
      hash: text(row.hash),
      indexedStatus: text(row.status),
      sender: text(row.sender_address ?? row.sender ?? row.from),
      receiver: text(row.receiver_address ?? row.receiver ?? row.to),
      reportedSNRG: amount(row.amount_nwei),
      reportedFeeSNRG: amount(row.fee_nwei),
      reportedNonce: typeof row.nonce === 'string' && /^\d{1,78}$/.test(row.nonce) ? row.nonce : 'Unavailable',
      reportedBlock: text(block),
      reportedTimeUTC: time ? new Date(time.ms).toISOString() : 'Unavailable',
      timeSource: time?.source || 'Unavailable',
    }}/>
    {hashSupported && <Copy value={row.hash} label="Copy transaction hash"/>}
    <p>This is the current Atlas record. Finality requires independent chain evidence.</p>
    {canCheck && (checking
      ? <TransactionLookup hash={row.hash} account={account} endpoint={endpoint} readRpc={readRpc} indexedBlock={block}/>
      : <button onClick={() => setChecking(true)}>Check status on selected RPC</button>)}
  </>;
}

export function WalletTransactionDetails({data, hash, account, endpoint, readRpc}) {
  const matches = sourceRecords(data?.recentTransactions, 'Transaction history').records.filter(row => row.hash === hash);
  const row = matches.length === 1 ? matches[0] : null;

  return <aside aria-label="Indexed transaction details">
    <h3>Indexed transaction details</h3>
    {row
      ? <IndexedDetails key={JSON.stringify([hash, account, endpoint?.id, endpoint?.rpc, endpoint?.chainId, endpoint?.networkKey])} row={row} account={account} endpoint={endpoint} readRpc={readRpc}/>
      : <p role="status">The selected record is absent or ambiguous in the current source response. Previous details are not shown.</p>}
  </aside>;
}
