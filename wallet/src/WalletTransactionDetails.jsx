import {useState} from 'react';
import {Copy, Detail, ErrorMessage, Resource, chainIdNumber, openExternal, useAction, useNative,
  useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount, text} from '@synergy-network/dapp-data-view';
import {indexedTransactionTime, transactionDirection} from './WalletActivity.jsx';
import {sourceRecords} from './source-records.js';
import {blockLookupHeight, comparableTransactionHash, compareIndexedBlock, reportedBlockMembership,
  transactionObservation} from './transaction-observation.js';

const observations = {
  notFound: 'Selected RPC returned no transaction',
  pending: 'Pending in the selected RPC pool',
  inBlock: 'Reported in a block by the selected RPC',
};

const blockMessages = {
  listed: 'Transaction listed in the selected RPC block.',
  notListed: 'The selected RPC block did not list this transaction.',
  unavailable: 'The selected RPC did not return the reported block.',
  unsupported: 'This block response does not provide a supported transaction hash list.',
  ambiguous: 'The selected RPC block listed the transaction more than once.',
};

function BlockLookup({height, hash, endpoint, readRpc}) {
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(previous => previous + 1);
  const result = useResource(async signal => {
    signal.throwIfAborted();
    const options = {endpoint: endpoint.rpc, signal};
    let identity;
    try {
      identity = await readRpc('synergy_getChainId', [], options);
    } catch {
      throw Error('The selected RPC chain check failed. Try again.');
    }
    if (chainIdNumber(identity) !== 1266) throw Error('The selected RPC reported a different chain ID.');
    signal.throwIfAborted();
    let value;
    try {
      value = await readRpc('synergy_getBlockByNumber', [height], options);
    } catch {
      throw Error('The selected RPC block check failed. Try again.');
    }
    signal.throwIfAborted();
    return {...reportedBlockMembership(value, height, hash), checkedAt: new Date().toISOString()};
  }, JSON.stringify([height, hash, endpoint.id, endpoint.rpc, endpoint.networkKey, revision]));
  return <section aria-label="Selected RPC block observation">
    <h5>Reported block check</h5>
    <Resource value={{...result, reload: refresh}}>{value => <>
      <p role="status">{blockMessages[value.state]}</p>
      {value.hash && <p>RPC block hash: {value.hash}</p>}
      <p>Block checked: <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>
      <button onClick={refresh}>Check block again</button>
    </>}</Resource>
  </section>;
}

function ReportedBlock({block, hash, endpoint, readRpc}) {
  const [checking, setChecking] = useState(false);
  const height = blockLookupHeight(block);
  if (height === null) return <p>The reported block height cannot be sent as an exact RPC integer.</p>;
  return checking
    ? <BlockLookup {...{height, hash, endpoint, readRpc}}/>
    : <button onClick={() => setChecking(true)}>Check reported block on RPC</button>;
}

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
        {value.state === 'inBlock' && <ReportedBlock key={revision} block={value.block} {...{hash, endpoint, readRpc}}/>}
      </>;
    }}</Resource>
    <p>The RPC observation can change. Finality and reorganization status remain unavailable.</p>
  </section>;
}

function AtlasExplorerAction({hash}) {
  const n = useNative();
  const action = useAction();
  if (!n?.permit('wallet', 'readWallet')) return null;
  if (!n.permit('wallet', 'externalLinks')) return <p>Allow Wallet external links in Security &amp; permissions to open Atlas.</p>;

  function openTransaction() {
    return action.run(async () => {
      if (!n.permit('wallet', 'readWallet') || !n.permit('wallet', 'externalLinks')) {
        throw Error('Wallet external links are unavailable in this Portal context.');
      }
      try {
        await openExternal(`https://atlas.synergy-network.io/transactions/${encodeURIComponent(hash)}`);
      } catch {
        throw Error('Portal could not open the Atlas transaction. Try again.');
      }
    });
  }

  return <>
    <button disabled={action.busy} onClick={openTransaction}>Open in Atlas explorer</button>
    <ErrorMessage error={action.error}/>
  </>;
}

function IndexedDetails({row, account, endpoint, readRpc}) {
  const [checking, setChecking] = useState(false);
  const time = indexedTransactionTime(row);
  const block = row.block_number ?? row.blockNumber;
  const hashSupported = !!comparableTransactionHash(row.hash);
  const supportedTransaction = hashSupported && typeof account === 'string' && !!account &&
    transactionDirection(row, account) !== 'Unclassified' && Number(endpoint?.chainId) === 1266;
  const canCheck = supportedTransaction && typeof readRpc === 'function' && !!endpoint.rpc;

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
    {supportedTransaction && <AtlasExplorerAction hash={row.hash}/>}
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
