import {validatorSource} from './validator-source.js';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {useState} from 'react';
import {Card as PanelCard} from '@synergy-network/portal-native/dapp-sdk';
import {text} from '@synergy-network/dapp-data-view';
const key='portal-node-watchlist-1266-v1';
const valid=id=>typeof id==='string'&&id.length>0&&id.length<=160&&!/[\x00-\x1f\x7f]/.test(id);
const identity=row=>typeof row.address==='string'&&row.address?row.address:row.id;
export function readNodeWatchlist(){
 const raw=localStorage.getItem(key);let ids;try{ids=raw===null?[]:JSON.parse(raw);}catch{throw Error('Saved validator watchlist is unreadable; original storage retained.');}
 if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!valid(id))||new Set(ids).size!==ids.length)throw Error('Saved validator watchlist is invalid; original storage retained.');
 return ids;
}
export function NodeWatchlist({data=null,updatedAt=null}){
 const [initial]=useState(()=>{try{return {ids:readNodeWatchlist(),error:''};}catch(error){return {ids:[],error:String(error?.message||error)};}}),[ids,setIds]=useState(initial.ids),[selected,setSelected]=useState(''),[error,setError]=useState(initial.error);
 const source=validatorSource(data),items=source.items,counts=new Map();for(const row of items){const id=identity(row);if(valid(id))counts.set(id,(counts.get(id)||0)+1);}
 const choices=items.filter(row=>counts.get(identity(row))===1);
 function change(remove){setError('');try{if(initial.error)throw Error(initial.error);const latest=readNodeWatchlist();let next;if(remove){next=latest.filter(id=>id!==remove);}else{if(!valid(selected)||counts.get(selected)!==1)throw Error('Choose an unambiguous validator from the current response.');if(latest.includes(selected))return;if(latest.length>=50)throw Error('Watchlist is limited to 50 public identities.');next=[...latest,selected];}localStorage.setItem(key,JSON.stringify(next));setIds(next);setSelected('');}catch(error){setError(String(error?.message||error));}}
 return <PanelCard title="Watched validators" detail="Monitor-only · Synergy Testnet v3, chain 1266"><SourceAge updatedAt={updatedAt}/>{data&&source.notice&&<p role="alert">{source.notice}</p>}<p>Public identities stay on this device. Watching a record does not verify ownership, enroll a host or grant operator access. Status is reported index evidence, not proof of consensus participation.</p>{error&&<p role="alert">{error}</p>}<label>Validator to watch<select disabled={!!initial.error||!choices.length} value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Choose a returned identity</option>{selected&&!choices.some(row=>identity(row)===selected)&&<option value={selected}>{selected} — not returned</option>}{choices.map(row=><option key={identity(row)} value={identity(row)}>{text(row.name||identity(row))}</option>)}</select></label><button disabled={!!initial.error||!selected||counts.get(selected)!==1} onClick={()=>change(null)}>Watch selected validator</button>{!ids.length&&!error&&<p>No watched validators.</p>}{ids.map(id=>{const matches=items.filter(row=>identity(row)===id),record=matches.length===1?matches[0]:null;return <section key={id}><h4 style={{overflowWrap:'anywhere'}}>{id}</h4><p>{!source.available?'Current source unavailable.':record?`Reported status: ${text(record.status)}`:matches.length?'Current identity is ambiguous.':source.notice?'Not present in this incomplete source view.':'Not returned by the current source.'}</p><button disabled={!!initial.error} onClick={()=>change(id)} aria-label={`Stop watching ${id}`}>Stop watching</button></section>;})}</PanelCard>;
}
