import {formatNweiToSnrg} from './snrg.js';
export function amount(value){if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<0))return 'Unavailable';const raw=String(value??'');return /^\d{1,78}$/.test(raw)?formatNweiToSnrg(raw):'Unavailable';}
export function rows(value){return Array.isArray(value)?value.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).slice(0,100):[];}
export function text(value){if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))return 'Unavailable';if(!['string','number','boolean'].includes(typeof value))return 'Unavailable';const result=String(value);return result.length>2048?result.slice(0,2048)+'… (truncated)':result;}
