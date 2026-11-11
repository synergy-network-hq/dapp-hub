import {chainIdNumber} from '@synergy-network/portal-native/dapp-sdk';
import {Card,Resource,useResource,rpc} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import background from '../assets/card-backgrounds/graphic1.png';
function nwei(value){if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<0))return null;const raw=String(value??'');return /^[0-9]{1,78}$/.test(raw)?BigInt(raw).toString():null;}
export function WalletBalances({account,endpoint,index,indexReceivedAt}){
 const balance=useResource(async signal=>{
  if(Number(endpoint.chainId)!==1266)throw Error('Select Synergy Testnet chain 1266.');
  if(chainIdNumber(await rpc('synergy_getChainId',[],{endpoint:endpoint.rpc,signal}))!==1266)throw Error('RPC identity does not match chain 1266.');
  const value=nwei(await rpc('synergy_getBalance',[account],{endpoint:endpoint.rpc,signal}));
  if(value===null)throw Error('RPC balance shape is unsupported; no zero is inferred.');
  return {value,receivedAt:Date.now()};
 },`${account}:${endpoint.id}:${endpoint.rpc}:${endpoint.chainId}`);
 const indexed=nwei(index?.walletBalanceNwei),current=balance.loading||balance.error?null:balance.data;
 return <Card title="SNRG balance observations"><div className="wallet-balance-card" style={{backgroundImage:`linear-gradient(90deg,rgba(0,0,0,.7),rgba(0,0,0,.3)),url(${background})`}}><h3>RPC-reported SNRG</h3><Resource value={balance}>{value=><><strong>{amount(value.value)}</strong><SourceAge updatedAt={value.receivedAt}/></>}</Resource></div><p>Atlas-reported SNRG: {indexed===null?'Unavailable':amount(indexed)}</p><SourceAge updatedAt={indexReceivedAt}/>{indexed!==null&&<p>Atlas may report zero when upstream balance data is unavailable. A reported zero does not by itself establish an observed balance.</p>}{current&&indexed!==null&&<p role="status">{current.value===indexed?'Reported numeric values match. This does not verify that both underlying reads succeeded.':'RPC and Atlas-reported amounts differ. Atlas may lag or have unavailable upstream data.'}</p>}<p>Sources: selected Synergy Core RPC and Atlas address index. These reads do not verify spendability, chain incarnation, authoritative finality, fees or token provenance.</p><button disabled={balance.loading} onClick={balance.reload}>Refresh RPC balance</button></Card>;
}
