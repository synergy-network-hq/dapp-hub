import {useEffect,useRef,useState} from 'react';
import {atlas,rpc,chainIdNumber,useResource,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {readAccountHistory} from './account-history.js';
import {WalletActivity} from './WalletActivity.jsx';
import {WalletTransactionDetails} from './WalletTransactionDetails.jsx';
export function WalletHistory({account,endpoint,recent,recentAt,readRpc=rpc,readAtlas=atlas}){
 const [epoch,setEpoch]=useState(0),[pages,setPages]=useState([]),[position,setPosition]=useState(0),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef({generation:0,controller:null,pending:false});
 async function load(cursor,previous,signal){if(chainIdNumber(await readRpc('synergy_getChainId',[],{endpoint:endpoint.rpc,signal}))!==1266)throw Error('RPC chain identity does not match Wallet history chain1266.');return readAccountHistory(readAtlas,account,{cursor,previous,signal});}
 const first=useResource(signal=>load(null,null,signal),`account-history:${epoch}`);
 useEffect(()=>{if(first.data){setPages([{...first.data,ordinal:1}]);setPosition(0);setSelected(null);}},[first.data]);
 useEffect(()=>()=>{request.current.generation++;request.current.controller?.abort();},[]);
 const current=pages[position]||(first.data?{...first.data,ordinal:1}:null);
 function restart(){request.current.generation++;request.current.controller?.abort();request.current.pending=false;setBusy(false);setError('');setPages([]);setPosition(0);setSelected(null);setEpoch(value=>value+1);}
 async function next(){
  if(!current||request.current.pending)return;
  if(position+1<pages.length){setPosition(position+1);setSelected(null);return;}
  if(!current.hasMore)return;
  const generation=++request.current.generation,controller=new AbortController();request.current.controller=controller;request.current.pending=true;setBusy(true);setError('');
  try{const page=await load(current.nextCursor,current,controller.signal);if(controller.signal.aborted||generation!==request.current.generation)return;
   const retained=pages.length?pages:[current],hashes=new Set(retained.flatMap(p=>p.items.map(row=>row.hash)));
   if(page.items.some(row=>hashes.has(row.hash)))throw Error('Indexed pages overlap or changed during reading. Restart history before combining these observations.');
   const updated=[...retained,{...page,ordinal:current.ordinal+1}].slice(-20);setPages(updated);setPosition(updated.length-1);setSelected(null);
  }catch(failure){if(!controller.signal.aborted&&generation===request.current.generation)setError(String(failure?.message||failure));}
  finally{if(generation===request.current.generation){request.current.pending=false;setBusy(false);}}
 }
 if(first.loading)return <><p role="status">Reading account-scoped history…</p><button onClick={restart}>Restart history read</button></>;
 if(first.error)return <><ErrorMessage error={first.error}/><p>Paginated account history is unavailable. The recent records below remain a separate limited source view.</p><button onClick={restart}>Retry paginated history</button><SourceAge updatedAt={recentAt}/><WalletActivity data={recent} account={account} onSelect={setSelected}/>{selected&&<WalletTransactionDetails data={recent} hash={selected}/>}</>;
 if(!current)return <p role="status">Preparing account history page…</p>;
 const data={recentTransactions:current.items};
 return <><SourceAge updatedAt={current.receivedAt} source="Atlas account-history page read"/><p>Page {current.ordinal} · reported network {current.network}. Filters apply to this page. Up to20 pages remain in local memory; restart to return to the newest records. The snapshot bounds indexing, not chain finality or complete account coverage.</p>{current.warnings.map((warning,i)=><p key={i}>{warning}</p>)}<div className="native-actions"><button disabled={busy||position===0} onClick={()=>{setPosition(position-1);setSelected(null);}}>Previous retained page</button><button disabled={busy||(!current.hasMore&&position+1>=pages.length)} onClick={next}>Next page</button><button onClick={restart}>Restart history</button></div>{busy&&<p role="status">Reading the next page…</p>}<ErrorMessage error={error}/><WalletActivity key={current.ordinal} data={data} account={account} paged onSelect={setSelected}/>{selected&&<WalletTransactionDetails data={data} hash={selected}/>}</>;
}
