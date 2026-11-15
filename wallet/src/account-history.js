import {atlasAccountKey,requireAtlasAccountKey} from './atlas-account.js';

// Account-scoped index pages; no ownership, completeness or finality authority.
const token=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/.test(value);
const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value);
const instant=value=>typeof value==='string'&&value.length<=64&&/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const cursorValue=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,1536}$/.test(value);
export const HISTORY_PAGE_LIMIT=25;
export function validateHistoryPage(value,account,{cursor=null,previous=null}={}){
 const key=atlasAccountKey(account);
 const fail=()=>{throw Error('Account history page is unsupported or changed scope. Restart history; no complete or empty account history is inferred.');};
 if(key===null||!value||value.version!==1||value.address!==key||value.source!=='atlas_transactions'||typeof value.network!=='string'||!value.network.length||value.network.length>128||value.limit!==HISTORY_PAGE_LIMIT||value.partial!==true||!instant(value.observedAt)||(value.indexedAt!==null&&!instant(value.indexedAt))||!Array.isArray(value.warnings)||value.warnings.length>20||value.warnings.some(w=>typeof w!=='string'||w.length>512)||!Array.isArray(value.items)||value.items.length>HISTORY_PAGE_LIMIT||typeof value.hasMore!=='boolean')fail();
 const snapshot=value.snapshot;
 if(snapshot!==null&&(!snapshot||!decimal(snapshot.blockNumber)||!token(snapshot.blockHash)))fail();
 if(snapshot===null&&(value.items.length||value.hasMore||value.nextCursor!==null))fail();
 if(value.hasMore?(!cursorValue(value.nextCursor)||value.nextCursor===cursor||!value.items.length):value.nextCursor!==null)fail();
 if(value.items.some(row=>!row||typeof row!=='object'||Array.isArray(row)||!token(row.hash)||!decimal(row.block_number)||!snapshot||BigInt(row.block_number)>BigInt(snapshot.blockNumber)||(row.sender_address!==key&&row.receiver_address!==key)||['amount_nwei','fee_nwei','nonce'].some(key=>row[key]!==null&&(typeof row[key]!=='string'||!/^\d{1,78}$/.test(row[key])))))fail();
 if(new Set(value.items.map(row=>row.hash)).size!==value.items.length)fail();
 if(previous&&(previous.address!==key||value.network!==previous.network||snapshot?.blockNumber!==previous.snapshot?.blockNumber||snapshot?.blockHash!==previous.snapshot?.blockHash))fail();
 const previousItems=previous?.items;
 if(previous&&!Array.isArray(previousItems))fail();
 const previousHeight=previousItems?.[previousItems.length-1]?.block_number;
 if(previousItems?.length&&!decimal(previousHeight))fail();
 let lastHeight=previousHeight===undefined?null:BigInt(previousHeight);
 for(const row of value.items){
  const height=BigInt(row.block_number);
  if(lastHeight!==null&&height>lastHeight)fail();
  lastHeight=height;
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
