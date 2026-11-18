import {useNative,ErrorMessage,isCanonicalTestnetRpc} from "@synergy-network/portal-native/dapp-sdk";
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
export function DappWidget({widgetKey:key}){
 const n=useNative(),snapshot=n.snapshot,indexed=key==='validator-status';
 const source=indexed?'indexData':'rpcData';
 const data=Object.hasOwn(snapshot,source)?snapshot[source]:snapshot.data;
 const loading=(indexed?snapshot.indexLoading:snapshot.rpcLoading)??snapshot.loading;
 if(!n.permit('node','readNetwork'))return <p>Allow NodeNetwork public-network reads in Security.</p>;
 if(indexed&&!isCanonicalTestnetRpc(n.endpoint))return <p>Atlas validator observations require the canonical Synergy Testnet RPC.</p>;
 if(!indexed&&snapshot.error)return <ErrorMessage error={snapshot.error}/>;
 return <>{indexed?<><strong>{data?.activeValidators??'—'} reported active validators</strong><p>{data?.totalValidators??'—'} reported validator nodes</p></>:<><strong>Chain {n.endpoint.chainId}</strong><p>Latest RPC block {data?.latestBlock??'Unavailable'} · {data?.peerCount??'—'} reported peers</p></>}<SourceAge updatedAt={indexed?snapshot.indexUpdatedAt:snapshot.updatedAt} source={indexed?'Atlas public index':'Selected public RPC'}/>{loading&&<p role="status">Refreshing public observations…</p>}{indexed&&snapshot.indexError&&<p role="alert">Indexed observation unavailable or stale.</p>}<p>Public observations do not establish managed-host health, enrollment or validator participation.</p></>;
}
