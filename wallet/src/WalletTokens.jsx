import {useEffect, useState} from 'react';
import {text} from '@synergy-network/dapp-data-view';
import {sourceRecords} from './source-records.js';
import {reportedTokenDecimals, reportedTokenQuantity, tokenBalanceSource, tokenBalanceSources} from './token-balance-inventory.js';
import {WalletTokenProvenance} from './WalletTokenProvenance.jsx';

const contractAddress = item => item.contractAddress ?? item.contract_address ?? item.contract;
const tokenAddress = item => item.tokenAddress;

function TokenDetails({item, accountKey, onClose}) {
  const source = tokenBalanceSource(item);
  const quantity = reportedTokenQuantity(item);
  return <aside aria-label="Selected token">
    <h3>{text(item.name || item.symbol)}</h3>
    <dl>
      <dt>Symbol</dt><dd>{text(item.symbol)}</dd>
      <dt>Contract address</dt><dd>{source === 'sts' ? 'Native STS token' : text(contractAddress(item))}</dd>
      {tokenAddress(item) != null && <><dt>Token address</dt><dd>{text(tokenAddress(item))}</dd></>}
      {item.tokenId != null && <><dt>Token ID</dt><dd>{text(item.tokenId)}</dd></>}
      <dt>Reported standard</dt><dd>{text(item.tokenStandard)}</dd>
      <dt>Reported decimals</dt><dd>{reportedTokenDecimals(item.decimals) ?? 'Unavailable'}</dd>
      <dt>Reported quantity</dt><dd>{quantity.value}</dd>
      <dt>Quantity interpretation</dt><dd>{quantity.units}</dd>
      {source !== 'other' && <><dt>Reported atomic quantity</dt><dd>{quantity.raw ?? 'Unavailable'}</dd></>}
      <dt>Source</dt><dd>{tokenBalanceSources[source]}</dd>
      {source !== 'other' && <><dt>{source === 'sts' ? 'Token creation block' : 'Deployment block'}</dt><dd>{text(item.deployedBlock)}</dd></>}
      <dt>Provenance verification</dt><dd>Not independently verified</dd>
    </dl>
    {source === 'synq' && <p>This entry records the initial allocation. Current holdings require a balance observation.</p>}
    {accountKey && <WalletTokenProvenance item={item} accountKey={accountKey}/>}
    <button onClick={onClose}>Close token details</button>
  </aside>;
}

export function WalletTokens({inventory}) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selected, setSelected] = useState(null);
  useEffect(() => setSelected(null), [inventory]);

  const source = sourceRecords(inventory.items, 'Token balances');
  const query = search.trim().toLowerCase();
  const matches = source.items.filter(item => {
    if (sourceFilter && sourceFilter !== tokenBalanceSource(item)) return false;
    const fields = [item.symbol, item.name, contractAddress(item), tokenAddress(item), item.tokenId];
    return !query || fields.some(value => typeof value === 'string' && value.toLowerCase().includes(query));
  });
  const current = matches.includes(selected) ? selected : null;
  const uniqueContract = typeof current?.contractAddress === 'string' &&
    source.records.filter(item => item.contractAddress === current.contractAddress).length === 1;

  return <>
    {source.notice && <p role="alert">{source.notice}</p>}
    <p>Atlas supplies indexed STS balances and initial SynQ deployment quantities. Inventory may be incomplete. Provenance and spendability remain unverified.</p>
    {!inventory.accountReported && <p>This Atlas response format does not echo the account.</p>}
    <div className="integration-filters">
      <label>Search tokens<input value={search} maxLength={160} onChange={event => setSearch(event.target.value)}/></label>
      <label>Balance source<select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
        <option value="">All sources</option>
        {Object.entries(tokenBalanceSources).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {matches.length ? <div className="integration-table" role="region" aria-label="Wallet token balances" tabIndex={0}>
      <table>
        <thead><tr><th>Asset</th><th>Reported quantity</th><th>Asset address</th></tr></thead>
        <tbody>{matches.map((item, index) => {
          const quantity = reportedTokenQuantity(item);
          const kind = tokenBalanceSource(item);
          const address = kind === 'sts' ? tokenAddress(item) : contractAddress(item) ?? tokenAddress(item);
          return <tr key={index}>
            <td><button onClick={() => setSelected(item)}>{text(item.symbol || item.name)}</button><small>{tokenBalanceSources[kind]}</small></td>
            <td>{quantity.value}<small>{quantity.units}</small></td>
            <td>{text(address)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p>{source.items.length ? 'No returned tokens match these filters.' :
      source.notice ? 'No usable token records are available in this source view.' : 'The index returned no token records.'}</p>}
    {current && <TokenDetails item={current} accountKey={uniqueContract ? inventory.accountKey : null} onClose={() => setSelected(null)}/>}
  </>;
}
