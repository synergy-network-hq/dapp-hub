// Display limits do not turn malformed or partial responses into complete inventories.
export function sourceRecords(raw,label){
 if(!Array.isArray(raw))return {items:[],records:[],available:false,notice:`${label} response is unavailable or unsupported; no empty inventory is inferred.`};
 const records=raw.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)),omitted=raw.length-records.length,limited=records.length>100;
 return {items:records.slice(0,100),records,available:true,notice:omitted||limited?`${omitted} malformed records omitted${limited?'; display limited to 100 usable records':''}. This is an incomplete source view.`:''};
}
