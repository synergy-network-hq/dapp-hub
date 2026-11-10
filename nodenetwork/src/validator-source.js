import {rows} from '@synergy-network/dapp-data-view';
export function validatorSource(data){
 const raw=data?.items;
 if(!Array.isArray(raw))return {items:[],notice:'Validator response shape is unavailable; no complete inventory can be shown.',available:false};
 const valid=raw.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
 const skipped=raw.length-valid.length,limited=valid.length>100;
 return {items:rows(raw),available:true,notice:skipped||limited?`${skipped} malformed records omitted${limited?'; display limited to 100 usable records':''}. This is an incomplete source view.`:''};
}
