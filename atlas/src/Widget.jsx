import {useNative,atlas,snrg,useResource,ErrorMessage,short} from "@synergy-network/portal-native/dapp-sdk";
export function DappWidget({widgetKey:key}){
 const n=useNative(),account=n.account.data,proposals=n.governance.data?.proposals||[],address=n.wallet.connection?.address;let body=null;
 const path=key==='transactions'?'txs?page=1&limit=3':key==='validators'?'validators?page=1&limit=3':null;const resource=useResource(signal=>path&&n.permit('atlas','readNetwork')?atlas(path,{signal}):null,`${path}:${n.permit('atlas','readNetwork')}`);
  if(!n.permit('atlas','readNetwork'))body=<p>Allow Atlas network access in Security.</p>;
  else if(key==='latest-block')body=<><strong>{n.snapshot.data?.latestBlock||'Loading…'}</strong><p>Chain {n.endpoint.chainId} · {n.snapshot.data?.indexedAt||'Checking index'}</p><ErrorMessage error={n.snapshot.error}/></>;
  else if(resource.error)body=<ErrorMessage error={resource.error}/>;
  else if(resource.loading)body=<p>Loading Atlas records…</p>;
  else body=<>{(resource.data?.items||[]).map(row=><p key={row.hash||row.address}>{key==='transactions'?short(row.hash):short(row.address)} · {key==='transactions'?(row.status||'indexed'):(row.status||'indexed')}</p>)}{!resource.data?.items?.length&&<p>No indexed records.</p>}</>;

 return body;
}
