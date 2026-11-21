import {useEffect,useState} from 'react';
export function SourceAge({updatedAt,source='Atlas public index'}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[updatedAt]);
 const valid=Number.isFinite(updatedAt)&&updatedAt>0,age=valid?Math.max(0,now-updatedAt):null;
 return <p role="status">Source: {source} · {valid?<>read {new Date(updatedAt).toISOString()} · {age>=60000?'stale read — refresh before relying on this data':'recent read'}</>:'no successful read yet'}. Read age does not establish the index’s chain-height freshness.</p>;
}
