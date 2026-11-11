import {useNative,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
export function DappWidget({widgetKey:key}){
 const n=useNative(),data=n.governance.data;
 if(!n.permit('keystone','readNetwork'))return <p>Allow Keystone network access in Security.</p>;
 if(n.governance.error)return <ErrorMessage error={n.governance.error}/>;
 if(n.governance.loading)return <p role="status">Reading indexed governance…</p>;
 if(!Array.isArray(data?.proposals))return <p>Governance observations unavailable; no zero proposals or votes inferred.</p>;
 const active=data.proposals.filter(p=>p?.state==='active'),address=n.permit('keystone','readWallet')?n.wallet.connection?.address:null;
 if(key!=='proposals'&&!address)return <p>Connect an account and allow Keystone wallet reads to inspect its indexed voting observations.</p>;
 const unobserved=active.filter(p=>Array.isArray(p.votes)&&!p.votes.some(v=>v.from===address));
 return <><strong>{key==='proposals'?active.length:unobserved.length} {key==='proposals'?'indexed active':'without an observed indexed vote'}</strong><p>{data.proposals.length} proposals in this index window. Coverage, current governance status and complete vote history are not independently verified.</p><button onClick={()=>n.navigate('keystone')}>Review in Keystone</button></>;
}
