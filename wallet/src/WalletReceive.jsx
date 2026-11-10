import {useEffect,useRef,useState} from 'react';
import QRCode from 'qrcode';
import {Card as Section} from '@synergy-network/portal-native/dapp-sdk';
export function Receive({account,generateQr=QRCode.toDataURL}){
 const [qr,setQr]=useState(null),[qrError,setQrError]=useState(null),[status,setStatus]=useState(null),[copying,setCopying]=useState(false),scope=useRef({account,generation:0});
 if(scope.current.account!==account)scope.current={account,generation:scope.current.generation+1};
 useEffect(()=>{let active=true;setQr(null);setQrError(null);setStatus(null);Promise.resolve().then(()=>generateQr(account,{width:220,margin:2})).then(value=>{if(active)setQr({account,url:value});}).catch(()=>{if(active)setQrError({account,message:'QR generation unavailable. Use the public address below.'});});return()=>{active=false;};},[account,generateQr]);
 const image=qr?.account===account?qr.url:null,error=qrError?.account===account?qrError.message:null;
 async function copy(){const generation=scope.current.generation;setCopying(true);try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(account);if(scope.current.generation===generation)setStatus({account,message:'Address copied.'});}catch{if(scope.current.generation===generation)setStatus({account,message:'Copy unavailable. Select the public address above to copy it.'});}finally{setCopying(false);}}
 return <Section title="Receive SNRG"><p>Synergy Testnet v3 · chain 1266. Check the sender is using this network.</p><div className="wallet-receive-layout"><div>{image?<img className="receive-qr" src={image} alt="Public account receive QR"/>:error?<p role="alert">{error}</p>:<div className="receive-qr-placeholder" role="status">Generating address QR…</div>}</div><div><h3>Public receive address</h3><p className="account-address" tabIndex={0}>{account}</p><p>Confirm the full address and network with the sender. This QR contains only your public address.</p><button disabled={copying} onClick={copy}>{copying?'Copying address…':'Copy public address'}</button><p role="status">{status?.account===account?status.message:''}</p></div></div></Section>;
}
