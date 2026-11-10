import {isValidSynergyAddress} from './wallet-address.js';
export const CONTACT_KEY='synergy-wallet-contacts:synergy-testnet-v3:1266:v1';
export function readContacts(storage){
 const raw=storage.getItem(CONTACT_KEY);if(raw===null)return [];
 let value;try{value=JSON.parse(raw);}catch{throw new Error('Contacts could not be read. The saved data has been retained.');}
 if(!Array.isArray(value)||value.length>200||value.some(item=>!item||typeof item.id!=='string'||!item.id||item.id.length>100||typeof item.name!=='string'||!item.name.trim()||item.name.length>80||!isValidSynergyAddress(item.address))||new Set(value.map(item=>item.address)).size!==value.length||new Set(value.map(item=>item.id)).size!==value.length)throw new Error('Contacts are incompatible. The saved data has been retained.');
 return value;
}
function matchesReviewed(current,reviewed){return !!current&&!!reviewed&&current.id===reviewed.id&&current.name===reviewed.name&&current.address===reviewed.address;}
export function saveContact(storage,{id,name,address,original}){
 const current=readContacts(storage),label=String(name||'').trim(),recipient=String(address||'').trim();
 if(!label||label.length>80)throw new Error('Enter a contact name of at most 80 characters.');
 if(!isValidSynergyAddress(recipient))throw new Error('Enter a valid lowercase Synergy address with its checksum.');
 if(current.some(item=>item.address===recipient&&item.id!==id))throw new Error('This address is already in your contacts.');
 if(id&&!matchesReviewed(current.find(item=>item.id===id),original))throw new Error('The contact changed or was removed. Refresh the address book and reopen it before saving. Your draft has been retained.');
 if(!id&&current.length>=200)throw new Error('This address book supports up to 200 contacts.');
 const next={id:id||crypto.randomUUID(),name:label,address:recipient};
 const items=id?current.map(item=>item.id===id?next:item):[...current,next];
 storage.setItem(CONTACT_KEY,JSON.stringify(items));return items;
}
export function removeContact(storage,reviewed){
 const current=readContacts(storage);
 if(!matchesReviewed(current.find(item=>item.id===reviewed?.id),reviewed))throw new Error('The contact changed or was removed. Close this review, refresh the address book and review it again.');
 const items=current.filter(item=>item.id!==reviewed.id);storage.setItem(CONTACT_KEY,JSON.stringify(items));return items;
}
