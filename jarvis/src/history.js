const validPrefix=prefix=>typeof prefix==='string'&&prefix.length<=100&&/^[a-zA-Z0-9_-][a-zA-Z0-9:_-]*:$/.test(prefix);
export function historyGeneration(storage,prefix){const value=storage.getItem(prefix+'history-generation');if(value===null)return 'legacy';const parsed=JSON.parse(value);if(typeof parsed!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(parsed))throw Error('Conversation generation is unreadable.');return parsed;}
export function reviewHistory(storage,prefix){
 if(!validPrefix(prefix))throw Error('Conversation storage scope is invalid.');
 if(storage.length>10000)throw Error('Conversation storage exceeds the inspection limit; no history was changed.');
 const messages=[];
 for(let index=0;index<storage.length;index++){
  const key=storage.key(index);if(!key?.startsWith(prefix)||key===prefix+'active-chat'||key===prefix+'history-generation')continue;
  const raw=storage.getItem(key);let value;try{value=JSON.parse(raw);}catch{throw Error('A conversation record is unreadable; original data retained.');}
  if(!value||typeof value.id!=='string'||key!==prefix+value.id||typeof value.user!=='string'||typeof value.text!=='string'||!Number.isFinite(value.time)||(value.historyGeneration!==undefined&&typeof value.historyGeneration!=='string'))throw Error('A conversation record is unsupported; original data retained.');
  messages.push({key,raw,value});
 }
 return messages;
}
export function clearHistory(storage,prefix){
 reviewHistory(storage,prefix); // Validate before invalidating pending replies or deleting anything.
 const generation=crypto.randomUUID();
 storage.setItem(prefix+'history-generation',JSON.stringify(generation));
 window.dispatchEvent(new CustomEvent('jarvis-messages-changed',{detail:prefix}));
 let removed=0;
 try{
  for(const item of reviewHistory(storage,prefix)){
   if(item.value.historyGeneration===generation)continue;
   if(storage.getItem(item.key)!==item.raw)throw Error('Conversation storage changed during clearing.');
   storage.removeItem(item.key);if(storage.getItem(item.key)!==null)throw Error('Conversation record could not be removed.');removed++;
  }
  storage.setItem(prefix+'active-chat',JSON.stringify(crypto.randomUUID()));
 }catch{throw Error(`History clearing stopped after ${removed} records. Pending replies were cancelled; retry to remove remaining records.`);}
 finally{window.dispatchEvent(new CustomEvent('jarvis-messages-changed',{detail:prefix}));}
 return removed;
}
