import {sourceRecords} from './source-records.js';
import {useState} from 'react';
import {amount,text} from '@synergy-network/dapp-data-view';
import {comparableTransactionHash} from './transaction-observation.js';
import {atlasAccountKey} from './atlas-account.js';
const address=(tx,side)=>tx[side+'_address']??tx[side]??tx[side==='sender'?'from':'to'];
export function transactionDirection(tx,account){
  const indexed = atlasAccountKey(account);
  const matches = value => typeof value === 'string' && (value === account || value === indexed);
  const from = matches(address(tx, 'sender'));
  const to = matches(address(tx, 'receiver'));
  if (from && to) return 'Self';
  if (from) return 'Sent';
  if (to) return 'Received';
  return 'Unclassified';
}
export function indexedTransactionTime(tx){
 const raw=tx.timestamp_unix;
 if((typeof raw==='number'&&Number.isSafeInteger(raw)||typeof raw==='string'&&/^[0-9]{1,13}$/.test(raw))&&Number(raw)>=0){const ms=Number(raw)*1000;if(Number.isSafeInteger(ms)&&ms<=8640000000000000)return {ms,source:'Transaction timestamp reported by index'};}
 const block=tx.block_timestamp;
 if(typeof block==='string'&&/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(block)){const ms=Date.parse(block);if(Number.isFinite(ms))return {ms,source:'Block/index timestamp'};}
 return null;
}
function utcDay(value){if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return null;const ms=Date.parse(value+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:null;}
const transactionTypes = {
  syntxn: 'Regular transaction',
  synxxn: 'Cross-chain transaction',
  unclassified: 'Unclassified',
};

export function WalletActivity({data, account, onSelect, paged = false}) {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('All');
  const [status, setStatus] = useState('All');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const source = sourceRecords(data?.recentTransactions, 'Transaction history');
  if (!source.available) {
    return <p role="alert">Indexed transaction history is unavailable or unsupported. No empty history is inferred.</p>;
  }

  const items = source.items.map((transaction, index) => ({
    transaction,
    index,
    type: comparableTransactionHash(transaction.hash)?.kind ?? 'unclassified',
    direction: transactionDirection(transaction, account),
    status: typeof transaction.status === 'string' && transaction.status ? transaction.status : 'Unknown',
    time: indexedTransactionTime(transaction),
  }));
  const statuses = [...new Set(items.map(item => item.status))].filter(value => value !== 'All').sort();
  const fromMs = from ? utcDay(from) : null;
  const throughMs = through ? utcDay(through) : null;
  const invalidRange = (from && fromMs === null) || (through && throughMs === null) ||
    (fromMs !== null && throughMs !== null && fromMs > throughMs);
  const missingTime = items.filter(item => !item.time).length;
  const search = query.trim().toLowerCase();

  const filtered = invalidRange ? [] : items.filter(item => {
    if (direction !== 'All' && item.direction !== direction) return false;
    if (status !== 'All' && item.status !== status) return false;
    if (type && item.type !== type) return false;
    if (from || through) {
      if (!item.time) return false;
      if (fromMs !== null && item.time.ms < fromMs) return false;
      if (throughMs !== null && item.time.ms >= throughMs + 86400000) return false;
    }
    if (!search) return true;
    const tx = item.transaction;
    return [tx.hash, address(tx, 'sender'), address(tx, 'receiver')]
      .some(value => typeof value === 'string' && value.toLowerCase().includes(search));
  });

  return <>
    {source.notice && <p role="alert">{source.notice}</p>}
    <p>{paged
      ? 'Records from the current Atlas account page; filtering is page-local. Index coverage and authoritative finality are not established.'
      : 'Recent records from Atlas; this is not a complete account history. Indexed status does not establish authoritative finality. Older records are unavailable here.'}</p>
    <p>Transaction types come from the reported hash prefix. This source does not identify transfer assets.</p>
    <div className="integration-filters">
      <label>Search hash or address<input value={query} maxLength={160} onChange={event => setQuery(event.target.value)}/></label>
      <label>Direction<select value={direction} onChange={event => setDirection(event.target.value)}>
        {['All', 'Sent', 'Received', 'Self', 'Unclassified'].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>Transaction type<select value={type} onChange={event => setType(event.target.value)}>
        <option value="">All types</option>
        {Object.entries(transactionTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Indexed status<select value={status} onChange={event => setStatus(event.target.value)}>
        {status !== 'All' && !statuses.includes(status) && <option value={status}>{status} — not returned</option>}
        {['All', ...statuses].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>From date (UTC)<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label>Through date (UTC)<input type="date" value={through} onChange={event => setThrough(event.target.value)}/></label>
      {invalidRange && <p role="alert">Choose a valid UTC date range with the start on or before the end.</p>}
      {(from || through) && missingTime > 0 &&
        <p>{missingTime} returned records have no usable timestamp and are excluded by the date filter.</p>}
    </div>
    <p role="status">{filtered.length} of {items.length} returned records</p>
    {filtered.length ? <div className="integration-table" role="region" aria-label="Wallet transaction history" tabIndex={0}>
      <table>
        <thead><tr>
          <th>Hash</th><th>Direction</th><th>Transaction type</th><th>Indexed status</th>
          <th>Reported time (UTC)</th><th>SNRG</th>
        </tr></thead>
        <tbody>{filtered.map(item => {
          const {hash, amount_nwei: value, status: indexedStatus} = item.transaction;
          const hashText = typeof hash === 'string' ? hash : undefined;
          const timestamp = item.time ? new Date(item.time.ms).toISOString() : null;
          return <tr key={item.index}>
            <td className="hash"><button title={hashText} aria-label={hashText} disabled={hashText === undefined} onClick={() => onSelect(hashText)}>
              {hashText && hashText.length > 28 ? hashText.slice(0,15) + '…' + hashText.slice(-8) : text(hash)}
            </button></td>
            <td>{item.direction}</td>
            <td>{transactionTypes[item.type]}</td>
            <td><span className="wallet-transaction-state">{text(indexedStatus)}</span></td>
            <td>{timestamp ? <>
              <time dateTime={timestamp}>{timestamp.replace('T', ' ').replace('.000Z', ' UTC')}</time>
              <small>{item.time.source}</small>
            </> : 'Unavailable'}</td>
            <td>{amount(value)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p>{items.length ? 'No returned records match these filters.' :
      source.notice ? 'No usable transactions are available in this source view.' : 'No transactions were returned by the index.'}</p>}
  </>;
}
