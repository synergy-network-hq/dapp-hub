import {atlasAccountKey,requireAtlasAccountKey} from './atlas-account.js';

// Account-scoped index pages; no ownership, completeness or finality authority.
const token=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/.test(value);
const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
const instant=value=>typeof value==='string'&&value.length<=64&&/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const cursorValue=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,1536}$/.test(value);
const encoder=new TextEncoder();

function historyPosition(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||!decimal(row.block_number)||!token(row.hash))return null;
 const index=row.tx_index;
 if(index!==null&&(!Number.isInteger(index)||index< -2147483648||index>2147483647))return null;
 // The owner query sorts nullable int32 transaction indices ahead of null, then applies PostgreSQL C collation.
 return {height:BigInt(row.block_number),index:index??-2147483649,hash:encoder.encode(row.hash)};
}

function isOlderPosition(row,previous){
 if(row.height!==previous.height)return row.height<previous.height;
 if(row.index!==previous.index)return row.index<previous.index;
 for(let i=0;i<Math.min(row.hash.length,previous.hash.length);i++){
  if(row.hash[i]!==previous.hash[i])return row.hash[i]<previous.hash[i];
 }
 return row.hash.length<previous.hash.length;
}

export const HISTORY_PAGE_LIMIT=25;
export function validateHistoryPage(value,account,{cursor=null,previous=null}={}){
 const key=atlasAccountKey(account);
 const fail=()=>{throw Error('Account history page is unsupported or changed scope. Restart history; no complete or empty account history is inferred.');};
 if(key===null||!value||value.version!==1||value.address!==key||value.source!=='atlas_transactions'||typeof value.network!=='string'||!value.network.length||value.network.length>128||value.limit!==HISTORY_PAGE_LIMIT||value.partial!==true||!instant(value.observedAt)||(value.indexedAt!==null&&!instant(value.indexedAt))||!Array.isArray(value.warnings)||value.warnings.length>20||value.warnings.some(w=>typeof w!=='string'||w.length>512)||!Array.isArray(value.items)||value.items.length>HISTORY_PAGE_LIMIT||typeof value.hasMore!=='boolean')fail();
 const snapshot=value.snapshot;
 if(snapshot!==null&&(!snapshot||!decimal(snapshot.blockNumber)||!token(snapshot.blockHash)))fail();
 if(snapshot===null&&(value.items.length||value.hasMore||value.nextCursor!==null))fail();
 if(value.hasMore?(!cursorValue(value.nextCursor)||value.nextCursor===cursor||!value.items.length):value.nextCursor!==null)fail();
 if(previous&&(previous.address!==key||value.network!==previous.network||snapshot?.blockNumber!==previous.snapshot?.blockNumber||snapshot?.blockHash!==previous.snapshot?.blockHash))fail();
 const previousItems=previous?.items;
 if(previous&&!Array.isArray(previousItems))fail();
 let last=previousItems?.length?historyPosition(previousItems[previousItems.length-1]):null;
 if(previousItems?.length&&!last)fail();
 const hashes=new Set();
 const head=snapshot===null?null:BigInt(snapshot.blockNumber);
 for(const row of value.items){
  const position=historyPosition(row);
  if(!position||head===null||position.height>head||(row.sender_address!==key&&row.receiver_address!==key)||
    ['amount_nwei','fee_nwei','nonce'].some(key=>row[key]!==null&&(typeof row[key]!=='string'||!/^\d{1,78}$/.test(row[key]))))fail();
  if(hashes.has(row.hash)||(last&&!isOlderPosition(position,last)))fail();
  hashes.add(row.hash);
  last=position;
 }
 return {...value,receivedAt:Date.now()};
}
export async function readAccountHistory(request,account,{cursor=null,previous=null,signal}={}){
 if(signal?.aborted)throw signal.reason;
 const key=requireAtlasAccountKey(account);
 if(cursor!==null&&(previous?.hasMore!==true||previous.address!==key||previous.nextCursor!==cursor||!cursorValue(cursor)))throw Error('Unsupported account-history cursor.');
 const query=new URLSearchParams({limit:String(HISTORY_PAGE_LIMIT)});if(cursor)query.set('cursor',cursor);
 const value=await request(`accounts/${encodeURIComponent(key)}/transactions?${query}`,{signal});
 if(signal?.aborted)throw signal.reason;
 return validateHistoryPage(value,account,{cursor,previous});
}
