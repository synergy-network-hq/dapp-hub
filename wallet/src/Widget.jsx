import {chainIdNumber} from '@synergy-network/portal-native/dapp-sdk';
import {useNative,atlas,rpc,useResource,ErrorMessage,short} from '@synergy-network/portal-native/dapp-sdk';
import {amount,text} from '@synergy-network/dapp-data-view';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {sourceRecords} from './source-records.js';
import {matchesPairedIndexProfile} from './paired-index-profile.js';
export function DappWidget({widgetKey:key}){
 const n=useNative(),connection=n.wallet.connection,permitted=n.permit('wallet','readWallet'),ready=permitted&&matchesPairedIndexProfile(connection,n.endpoint);
 const value=useResource(async signal=>{
  if(!ready)throw Error('Connect a chain 1266 account and allow Wallet reads.');
  if(chainIdNumber(await rpc('synergy_getChainId',[],{endpoint:n.endpoint.rpc,signal}))!==1266)throw Error('RPC chain identity does not match Wallet chain 1266.');
  const data=await atlas(`address/${encodeURIComponent(connection.address)}`,{signal});if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Account response is unavailable or unsupported; no empty history or zero balance is inferred.');return {data,receivedAt:Date.now()};
 },JSON.stringify([connection?.address,connection?.chainId,n.endpointId,n.endpoint.rpc,n.endpoint.chainId,ready]));
 if(!permitted)return <p>Allow Wallet account access in Security.</p>;
 if(!connection)return <p>Connect Synergy Wallet to see your account.</p>;
 if(!ready)return <p>Paired Wallet observations require the canonical Synergy Testnet v3 endpoint.</p>;
 if(value.loading)return <p role="status">Reading Wallet observations…</p>;
 if(value.error)return <ErrorMessage error={value.error}/>;
 const data=value.data?.data,history=sourceRecords(data?.recentTransactions,'Transaction history');
 return <>{key==='balance'?<><strong>{amount(data?.walletBalanceNwei)} SNRG reported by index</strong><p>{short(connection.address)}</p><p>A reported zero may mean balance data was unavailable.</p><button onClick={()=>n.navigate('wallet')}>Compare Wallet balance observations</button></>:<>{history.notice&&<p role="alert">{history.notice}</p>}{history.items.slice(0,3).map((row,index)=><p key={index}>{short(text(row.hash))} · {text(row.status)}</p>)}{!history.items.length&&<p>{history.notice?'No usable transaction records in this response.':'No transactions returned by the index.'}</p>}{history.items.length>3&&<p>Showing 3 of {history.items.length} displayed index records. Open Wallet for the returned history view.</p>}</>}<SourceAge updatedAt={value.data?.receivedAt}/><button onClick={value.reload}>Refresh widget observations</button><p>Indexed observations do not prove spendability, complete history or authoritative finality.</p></>;
}
