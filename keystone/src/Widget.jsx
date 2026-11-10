import {useNative,atlas,snrg,useResource,ErrorMessage,short} from "@synergy-network/portal-native/dapp-sdk";
export function DappWidget({widgetKey:key}){
 const n=useNative(),account=n.account.data,proposals=n.governance.data?.proposals||[],address=n.wallet.connection?.address;let body=null;
  if(!n.permit('keystone','readNetwork'))body=<p>Allow Keystone network access in Security.</p>;
  else if(key==='proposals')body=<><strong>{proposals.filter(p=>p.state==='active').length} active</strong><p>{proposals.length} proposals in indexed history</p></>;
  else {const pending=proposals.filter(p=>p.state==='active'&&!p.votes.some(v=>v.from===address));body=<><strong>{address?pending.length:'—'} awaiting your vote</strong><p>{address?'Open Keystone to review before voting.':'Connect a wallet to see proposals requiring your vote.'}</p></>;}
  if(n.governance.error)body=<ErrorMessage error={n.governance.error}/>;
  else if(n.governance.data?.complete===false)body=<>{body}<p>{n.governance.data.coverage}</p></>;

 return body;
}
