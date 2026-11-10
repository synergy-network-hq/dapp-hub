import {useMemo,useState} from 'react';
import {amount,rows,text} from '@synergy-network/dapp-data-view';
const address=(tx,side)=>tx[side+'_address']??tx[side]??tx[side==='sender'?'from':'to'];
export function transactionDirection(tx,account){
 const from=address(tx,'sender'),to=address(tx,'receiver');
 if(from===account&&to===account)return 'Self';
 if(from===account)return 'Sent';
 if(to===account)return 'Received';
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
export function WalletActivity({data,account,onSelect}){
 const [query,setQuery]=useState(''),[direction,setDirection]=useState('All'),[status,setStatus]=useState('All'),[from,setFrom]=useState(''),[through,setThrough]=useState('');
 const items=rows(data.recentTransactions);
 const statuses=useMemo(()=>[...new Set(items.map(tx=>typeof tx.status==='string'?tx.status:'Unknown'))].sort(),[data]);
 const fromMs=from?utcDay(from):null,throughMs=through?utcDay(through):null,invalidRange=!!(from&&fromMs===null||through&&throughMs===null||fromMs!==null&&throughMs!==null&&fromMs>throughMs);
 const missingTime=items.filter(tx=>!indexedTransactionTime(tx)).length;
 const filtered=items.filter(tx=>!invalidRange&&(!from&&!through||(()=>{const time=indexedTransactionTime(tx);return time&&(fromMs===null||time.ms>=fromMs)&&(throughMs===null||time.ms<throughMs+86400000);})())&&(direction==='All'||transactionDirection(tx,account)===direction)&&(status==='All'||(tx.status||'Unknown')===status)&&(!query.trim()||[tx.hash,address(tx,'sender'),address(tx,'receiver')].some(value=>typeof value==='string'&&value.toLowerCase().includes(query.trim().toLowerCase()))));
 return <><p>Recent records from Atlas; this is not a complete account history. Indexed status does not establish authoritative finality. Older records are unavailable here.</p><div className="integration-filters"><label>Search hash or address<input value={query} maxLength={160} onChange={e=>setQuery(e.target.value)}/></label><label>Direction<select value={direction} onChange={e=>setDirection(e.target.value)}>{['All','Sent','Received','Self','Unclassified'].map(v=><option key={v}>{v}</option>)}</select></label><label>Indexed status<select value={status} onChange={e=>setStatus(e.target.value)}>{status!=='All'&&!statuses.includes(status)&&<option value={status}>{status} — not returned</option>}{['All',...statuses.filter(v=>v!=='All')].map(v=><option key={v}>{v}</option>)}</select></label><label>From date (UTC)<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through date (UTC)<input type="date" value={through} onChange={e=>setThrough(e.target.value)}/></label>{invalidRange&&<p role="alert">Choose a valid UTC date range with the start on or before the end.</p>}{(from||through)&&missingTime>0&&<p>{missingTime} returned records have no usable timestamp and are excluded by the date filter.</p>}</div><p role="status">{filtered.length} of {items.length} returned records</p>{filtered.length?<div className="integration-table" role="region" aria-label="Wallet transaction history" tabIndex={0}><table><thead><tr><th>Hash</th><th>Direction</th><th>Indexed status</th><th>Reported time (UTC)</th><th>SNRG</th></tr></thead><tbody>{filtered.map((tx,i)=><tr key={i}><td className="hash"><button title={typeof tx.hash==='string'?tx.hash:undefined} aria-label={typeof tx.hash==='string'?tx.hash:undefined} disabled={typeof tx.hash!=='string'} onClick={()=>onSelect(tx.hash)}>{typeof tx.hash==='string'&&tx.hash.length>28?tx.hash.slice(0,15)+'…'+tx.hash.slice(-8):text(tx.hash)}</button></td><td>{transactionDirection(tx,account)}</td><td><span className="wallet-transaction-state">{text(tx.status)}</span></td><td>{indexedTransactionTime(tx)?<><time dateTime={new Date(indexedTransactionTime(tx).ms).toISOString()}>{new Date(indexedTransactionTime(tx).ms).toISOString().replace('T',' ').replace('.000Z',' UTC')}</time><small>{indexedTransactionTime(tx).source}</small></>:"Unavailable"}</td><td>{amount(tx.amount_nwei)}</td></tr>)}</tbody></table></div>:<p>{items.length?'No returned records match these filters.':'No transactions were returned by the index.'}</p>}</>;
}
