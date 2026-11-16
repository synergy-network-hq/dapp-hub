import {useNative,rpc,useResource,ErrorMessage,short} from '@synergy-network/portal-native/dapp-sdk';
import {amount,text} from '@synergy-network/dapp-data-view';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {sourceRecords} from './source-records.js';
import {readAtlasAddress} from './atlas-account.js';
import {atlasEndpointRequired,canReadWalletAtlas,readScopedWalletAtlas} from './atlas-scope.js';
import {checkWalletAccountEndpoint,requireWalletReadScope,useWalletReadScope} from './wallet-account-read.js';
export function DappWidget({widgetKey:key}){
 const n=useNative(),connection=n.wallet.connection,permitted=n.permit('wallet','readWallet'),ready=canReadWalletAtlas(n);
 const scope=JSON.stringify([connection?.walletId,connection?.address,connection?.chainId,n.endpointId,n.endpoint.rpc,n.endpoint.chainId,
  n.endpoint.networkKey||n.endpoint.id,n.endpoint.genesisHash,n.walletConsentSession,ready]);
 const allowed=useWalletReadScope(scope,()=>canReadWalletAtlas(n));
 const value=useResource(async signal=>{
  if(!allowed())return null;
  await checkWalletAccountEndpoint(rpc,n.endpoint,signal,allowed);
  requireWalletReadScope(signal,allowed);
  const data=await readAtlasAddress((path,options)=>readScopedWalletAtlas(n,path,options),connection.address,{signal});
  requireWalletReadScope(signal,allowed);
  return {data,receivedAt:Date.now()};
 },scope);
 if(!permitted)return <p>Allow Wallet account access in Security.</p>;
 if(!connection)return <p>Connect Synergy Wallet to see your account.</p>;
 if(!ready)return <p>{atlasEndpointRequired}</p>;
 if(value.loading)return <p role="status">Reading Wallet observations…</p>;
 if(value.error)return <ErrorMessage error={value.error}/>;
 const data=value.data?.data,history=sourceRecords(data?.recentTransactions,'Transaction history');
 return <>{key==='balance'?<><strong>{amount(data?.walletBalanceNwei)} SNRG reported by index</strong><p>{short(connection.address)}</p><p>A reported zero may mean balance data was unavailable.</p><button onClick={()=>n.navigate('wallet')}>Compare Wallet balance observations</button></>:<>{history.notice&&<p role="alert">{history.notice}</p>}{history.items.slice(0,3).map((row,index)=><p key={index}>{short(text(row.hash))} · {text(row.status)}</p>)}{!history.items.length&&<p>{history.notice?'No usable transaction records in this response.':'No transactions returned by the index.'}</p>}{history.items.length>3&&<p>Showing 3 of {history.items.length} displayed index records. Open Wallet for the returned history view.</p>}</>}<SourceAge updatedAt={value.data?.receivedAt}/><button onClick={value.reload}>Refresh widget observations</button><p>Indexed observations do not prove spendability, complete history or authoritative finality.</p></>;
}
