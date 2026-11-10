import {useNative,atlas,snrg,useResource,ErrorMessage,short} from "@synergy-network/portal-native/dapp-sdk";
export function DappWidget({widgetKey:key}){
 const n=useNative(),account=n.account.data,proposals=n.governance.data?.proposals||[],address=n.wallet.connection?.address;let body=null;
  const data=n.snapshot.data;
  body=key==='validator-status'?<><strong>{data?.activeValidators??'—'} active validators</strong><p>{data?.totalValidators??'—'} total validator nodes</p></>:<><strong>Chain {n.endpoint.chainId}</strong><p>Latest block {data?.latestBlock||'Unavailable'} · {data?.peerCount??'—'} peers</p></>;
  if(n.snapshot.error)body=<ErrorMessage error={n.snapshot.error}/>;
 return body;
}
