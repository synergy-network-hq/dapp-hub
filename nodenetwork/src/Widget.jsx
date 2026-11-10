import {useNative,ErrorMessage} from "@synergy-network/portal-native/dapp-sdk";
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
export function DappWidget({widgetKey:key}){
 const n=useNative(),data=n.snapshot.data,indexed=key==='validator-status';
 if(n.snapshot.error)return <ErrorMessage error={n.snapshot.error}/>;
 return <>{indexed?<><strong>{data?.activeValidators??'—'} reported active validators</strong><p>{data?.totalValidators??'—'} reported validator nodes</p></>:<><strong>Chain {n.endpoint.chainId}</strong><p>Latest RPC block {data?.latestBlock??'Unavailable'} · {data?.peerCount??'—'} reported peers</p></>}<SourceAge updatedAt={indexed?n.snapshot.indexUpdatedAt:n.snapshot.updatedAt} source={indexed?'Atlas public index':'Selected public RPC'}/>{n.snapshot.loading&&<p role="status">Refreshing public observations…</p>}{indexed&&n.snapshot.indexError&&<p role="alert">Indexed observation unavailable or stale.</p>}<p>Public observations do not establish managed-host health, enrollment or validator participation.</p></>;
}
