import {sourceRecords} from './source-records.js';
import {useEffect,useState} from 'react';
import {text} from '@synergy-network/dapp-data-view';
const contract=item=>item.contractAddress??item.contract_address??item.contract;
function reportedBalance(item){
 if(item.formattedBalance!=null)return {value:text(item.formattedBalance),units:'Index-formatted quantity (formattedBalance); denomination unverified'};
 if(item.balance!=null)return {value:text(item.balance),units:'Index quantity (balance); units unspecified'};
 if(item.balanceNwei!=null){const raw=item.balanceNwei,valid=typeof raw==='string'&&/^[0-9]{1,78}$/.test(raw)||typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0;return {value:valid?text(raw):'Unavailable',units:'Raw index quantity (balanceNwei); not converted to token units or SNRG'};}
 return {value:'Unavailable',units:'No supported balance field supplied'};
}
export function WalletTokens({data}){
 const [search,setSearch]=useState(''),[selected,setSelected]=useState(null);
 useEffect(()=>setSelected(null),[data]);
 const source=sourceRecords(Array.isArray(data)?data:[data?.items,data?.tokens,data?.balances].find(Array.isArray),'Token balances'),items=source.items;
 const current=items.includes(selected)?selected:null;
 const matches=items.filter(item=>[item.symbol,item.name,contract(item)].some(v=>typeof v==='string'&&v.toLowerCase().includes(search.trim().toLowerCase()))||!search.trim());
 return <>{source.notice&&<p role="alert">{source.notice}</p>}<p>Source: Atlas token-balance index. Values and asset metadata are reported by the index; Portal has not independently verified token provenance or spendability.</p><label>Search tokens<input value={search} maxLength={160} onChange={e=>setSearch(e.target.value)}/></label>{matches.length?<div className="integration-table" role="region" aria-label="Wallet token balances" tabIndex={0}><table><thead><tr><th>Asset</th><th>Reported balance</th><th>Contract</th></tr></thead><tbody>{matches.map((item,i)=><tr key={i}><td><button onClick={()=>setSelected(item)}>{text(item.symbol||item.name)}</button></td><td>{reportedBalance(item).value}<small style={{display:'block'}}>{reportedBalance(item).units}</small></td><td>{text(contract(item))}</td></tr>)}</tbody></table></div>:<p>{items.length?'No returned tokens match this search.':source.notice?'No usable token records are available in this source view.':'The index returned no token balances.'}</p>}{current&&<aside aria-label="Selected token"><h3>{text(current.name||current.symbol)}</h3><dl><dt>Symbol</dt><dd>{text(current.symbol)}</dd><dt>Contract</dt><dd>{text(contract(current))}</dd><dt>Reported decimals</dt><dd>{Number.isSafeInteger(current.decimals)&&current.decimals>=0&&current.decimals<=255?current.decimals:'Unavailable'}</dd><dt>Reported balance</dt><dd>{reportedBalance(current).value}</dd><dt>Quantity interpretation</dt><dd>{reportedBalance(current).units}</dd><dt>Provenance verification</dt><dd>Not independently verified</dd></dl><p>Missing decimals are not assumed to be SNRG decimals. No external token metadata, scripts or media are loaded.</p><button onClick={()=>setSelected(null)}>Close token details</button></aside>}</>;
}
