import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import {Receive} from '../src/WalletReceive.jsx';
import '@synergy-network/portal-native/styles.css';
import '../src/wallet.css';
const accounts=['syn'+'a'.repeat(38),'syn'+'b'.repeat(38)];
const generators={normal:QRCode.toDataURL,failure:async()=>{throw Error('Synthetic QR failure');},delayed:async(account,options)=>{await new Promise(resolve=>setTimeout(resolve,1500));return QRCode.toDataURL(account,options);}};
function Preview(){
 const [index,setIndex]=useState(0),[mode,setMode]=useState('normal');
 return <main className="wallet-migrated" style={{padding:24,maxWidth:1000,margin:'0 auto'}}><h1>Wallet Receive component fixture</h1><p role="note">Synthetic public address only; not a connected or owned account and never a payment destination. No phone session, permissions, native authority, network read or signing. Copy uses the browser's actual clipboard API and may be unavailable.</p><label>Fixture QR mode<select value={mode} onChange={event=>setMode(event.target.value)}><option value="normal">Real QR generation</option><option value="failure">Synthetic generation failure</option><option value="delayed">Delayed real generation</option></select></label><button onClick={()=>setIndex(value=>1-value)}>Switch synthetic address</button><Receive account={accounts[index]} generateQr={generators[mode]}/></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
