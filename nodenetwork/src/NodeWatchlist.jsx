import {useState} from 'react';
import {Card, ErrorMessage, Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {text} from '@synergy-network/dapp-data-view';
import {validatorSource} from './validator-source.js';
import {validatorLookupAddress} from './validator-lookup.js';
import {ValidatorBlockReview} from './ValidatorBlockReview.jsx';
import {ValidatorRewardSettlements} from './ValidatorRewardSettlements.jsx';
import {ValidatorActiveList} from './ValidatorActiveList.jsx';

const key = 'portal-node-watchlist-1266-v1';
const valid = id => typeof id === 'string' && id.length > 0 && id.length <= 160 && !/[\x00-\x1f\x7f]/.test(id);
const identity = row => typeof row.address === 'string' && row.address ? row.address : row.id;

export function readNodeWatchlist() {
 const raw = localStorage.getItem(key);
 if (raw !== null && raw.length > 65536) throw Error('Saved validator watchlist exceeds the supported size; original storage retained.');
 let ids;
 try {ids = raw === null ? [] : JSON.parse(raw);}
 catch {throw Error('Saved validator watchlist is unreadable; original storage retained.');}
 if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => !valid(id)) || new Set(ids).size !== ids.length) {
  throw Error('Saved validator watchlist is invalid; original storage retained.');
 }
 return ids;
}

function initialWatchlist() {
 try {return {ids: readNodeWatchlist(), error: '', readable: true};}
 catch (error) {return {ids: [], error: String(error?.message || error), readable: false};}
}

export function NodeWatchlist({data, updatedAt, readValidator, readActiveListing}) {
 const [watchlist, setWatchlist] = useState(initialWatchlist);
 const {ids, error, readable} = watchlist;
 const [selected, setSelected] = useState('');
 const [notice, setNotice] = useState('');
 const [address, setAddress] = useState('');
 const [lookupAddress, setLookupAddress] = useState(null);
 const [lookupError, setLookupError] = useState('');
 const lookup = useResource(signal => lookupAddress ? readValidator(lookupAddress, signal) : null, lookupAddress ?? '');
 const lookupResult = lookup.data?.address === lookupAddress ? lookup.data : null;
 const source = validatorSource(data);
 const {items} = source;
 const counts = new Map();
 for (const row of items) {
  const id = identity(row);
  if (valid(id)) counts.set(id, (counts.get(id) || 0) + 1);
 }
 const choices = items.filter(row => counts.get(identity(row)) === 1);

 function refresh() {
  setNotice('');
  try {
   setWatchlist({ids: readNodeWatchlist(), readable: true, error: ''});
   setSelected('');
   setNotice('Watchlist refreshed from this device.');
  } catch (failure) {
   setWatchlist(current => ({...current, readable: false, error: String(failure?.message || failure)}));
  }
 }

 function edit({add, remove}) {
  setNotice('');
  try {
   if (!readable) throw Error('Refresh the retained watchlist after reviewed recovery before editing.');
   const latest = readNodeWatchlist();
   const alreadyWatched = add && latest.some(id => id === add
    || (add === lookupResult?.address && id.trim().toLowerCase() === add));
   if (alreadyWatched) {
    setWatchlist({ids: latest, readable: true, error: ''});
    setNotice('This validator is already watched.');
    return;
   }
   if (add && latest.length >= 50) throw Error('Watchlist is limited to 50 public identities.');
   const next = add ? [...latest, add] : latest.filter(id => id !== remove);
   localStorage.setItem(key, JSON.stringify(next));
   setWatchlist({ids: next, readable: true, error: ''});
   setSelected('');
   setNotice(add ? 'Validator added to this device’s watchlist.' : 'Validator removed from this device’s watchlist.');
  } catch (failure) {
   setWatchlist(current => ({...current, error: String(failure?.message || failure)}));
  }
 }

 function lookupValidator(value) {
  setLookupError('');
  try {
   const checked = validatorLookupAddress(value);
   setAddress(checked);
   if (lookupAddress === checked) lookup.reload();
   else setLookupAddress(checked);
  } catch (failure) {
   setLookupAddress(null);
   setLookupError(failure.message);
  }
 }

 return <Card title="Watched validators">
  <p>Monitor-only · Synergy Testnet v3, chain 1266. Public watches remain on this device and describe Atlas observations.</p>
  <SourceAge updatedAt={updatedAt}/>
  {data && source.notice && <p role="alert">{source.notice}</p>}
  <ErrorMessage error={error}/>
  <button onClick={refresh}>Refresh saved watchlist</button>
  {notice && <p role="status">{notice}</p>}
  <label>Validator to watch
   <select disabled={!readable || !choices.length} value={selected} onChange={event => setSelected(event.target.value)}>
    <option value="">Choose a returned identity</option>
    {selected && !choices.some(row => identity(row) === selected) && <option value={selected}>{selected} — not returned</option>}
    {choices.map(row => <option key={identity(row)} value={identity(row)}>{text(row.name || identity(row))}</option>)}
   </select>
  </label>
  <button disabled={!readable || !selected || counts.get(selected) !== 1} onClick={() => {
   if (counts.get(selected) === 1) edit({add: selected});
  }}>Watch selected validator</button>

  <form onSubmit={event => {event.preventDefault(); lookupValidator(address);}}>
   <label>Import monitor by SYNV address
    <input maxLength={128} autoComplete="off" value={address} onChange={event => {
     setAddress(event.target.value);
     setLookupAddress(null);
     setLookupError('');
    }}/>
   </label>
   <button disabled={!address.trim()}>Look up validator</button>
  </form>
  <ErrorMessage error={lookupError}/>
  {lookupAddress && <Resource value={lookup}>{result => <section>
   <h3>{result.name || result.address}</h3>
   <p style={{overflowWrap: 'anywhere'}}>{result.address} · {result.status}</p>
   <SourceAge updatedAt={result.receivedAt} source="Atlas public validator detail"/>
   <button disabled={!readable || !result.hasProfile || result.address !== lookupAddress}
    onClick={() => {
     if (lookupResult?.hasProfile && !lookup.loading) edit({add: lookupResult.address});
    }}>Watch looked-up validator</button>
   <ValidatorBlockReview key={`${result.address}:${result.receivedAt}`} observation={result}/>
   <ValidatorRewardSettlements key={`${result.address}:${result.receivedAt}:rewards`} settlements={result.indexedRewards ?? null}/>
  </section>}</Resource>}
  {lookupAddress && readActiveListing && <ValidatorActiveList key={lookupAddress} address={lookupAddress} readListing={readActiveListing}/>}

  {!ids.length && !error && <p>No watched validators.</p>}
  {ids.map(id => {
   const matches = items.filter(row => identity(row) === id);
   const record = matches.length === 1 ? matches[0] : null;
   const detail = lookupResult?.address === id.trim().toLowerCase() ? lookupResult : null;
   const status = detail?.status || (!source.available ? 'Current list unavailable.'
    : record ? `Reported status: ${text(record.status)}`
     : matches.length ? 'Current identity is ambiguous.'
      : source.notice ? 'Not present in this incomplete source view.' : 'Not returned by the current list.');
   return <section key={id}>
    <h4 style={{overflowWrap: 'anywhere'}}>{id}</h4>
    <p>{status}</p>
    {/^synv[a-z0-9]{34,92}$/i.test(id.trim()) && <button onClick={() => lookupValidator(id)} aria-label={`Look up ${id}`}>Look up</button>}
    <button disabled={!readable} onClick={() => edit({remove: id})} aria-label={`Stop watching ${id}`}>Stop watching</button>
   </section>;
  })}
 </Card>;
}
