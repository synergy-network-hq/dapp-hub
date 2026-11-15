import {WalletFeeMarket} from './WalletFeeMarket.jsx';
import {chainIdNumber} from '@synergy-network/portal-native/dapp-sdk';
import {WalletConnections} from './WalletConnections.jsx';
import {WalletHistory} from './WalletHistory.jsx';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {WalletBalances} from './WalletBalances.jsx';
import {useState} from 'react';
import {useNative,atlas,rpc,openWallet,Card,Resource,useResource,useAction,ErrorMessage,Detail,Copy} from '@synergy-network/portal-native/dapp-sdk';
import {WalletTokens} from './WalletTokens.jsx';
import {tokenBalanceInventory} from './token-balance-inventory.js';
import {Receive} from './WalletReceive.jsx';
import {WalletContacts} from './WalletContacts.jsx';
import './wallet.css';
export function WalletApp(){
 const n=useNative(),c=n.wallet.connection,[tab,setTab]=useState('Assets'),[revision,setRevision]=useState(0),action=useAction();
 const permitted=n.permit('wallet','readWallet'),ready=permitted&&c?.chainId==='synergy:1266'&&Number(n.endpoint.chainId)===1266;
 const tokens=useResource(async signal=>{
  if(!ready)throw Error('Connect a chain 1266 account and allow Wallet reads.');
  const options={endpoint:n.endpoint.rpc,signal};
  if(chainIdNumber(await rpc('synergy_getChainId',[],options))!==1266)throw Error('RPC chain identity does not match Wallet chain 1266.');
  signal.throwIfAborted();
  const value=await atlas(`wallets/${encodeURIComponent(c.address)}/token-balances`,{signal});
  signal.throwIfAborted();
  return {inventory:tokenBalanceInventory(value,c.address),receivedAt:Date.now()};
 },JSON.stringify([c?.address,n.endpointId,n.endpoint.rpc,n.endpoint.networkKey,ready]));
 const account=useResource(async signal=>{if(!ready)throw Error('Wallet reads unavailable.');if(chainIdNumber(await rpc('synergy_getChainId',[],{endpoint:n.endpoint.rpc,signal}))!==1266)throw Error('RPC chain identity does not match Wallet chain 1266.');const value=await atlas(`address/${encodeURIComponent(c.address)}`,{signal});if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Account response is unavailable or unsupported; no empty account history or zero balance is inferred.');return {...value,portalReceivedAt:Date.now()};},`${c?.address}:${n.endpointId}:${n.endpoint.rpc}:${ready}`);
 const data=ready&&!account.loading&&!account.error?account.data:null;
 const selectionScope=`${c?.address}:${n.endpointId}:${n.endpoint.rpc}:${ready}`;
 return <div className="wallet-migrated"><div className="native-actions"><p>Synergy Wallet · {c?.walletName||'Not connected'}</p><button onClick={()=>action.run(openWallet)}>Open Synergy Wallet app</button><button onClick={()=>n.navigate('wallet-connection')}>Manage connection</button><button disabled={!ready||account.loading||tokens.loading} onClick={()=>{account.reload();tokens.reload();setRevision(value=>value+1);}}>Refresh Wallet observations</button></div><ErrorMessage error={action.error}/>{!c?<Card title="Connect once across Portal"><p>Pair Synergy Wallet using Connect Wallet in the header.</p></Card>:!ready?<Card title="Wallet reads unavailable"><p>Allow Wallet reads in Security & permissions and select the connected Synergy Testnet account on chain 1266.</p></Card>:<div key={`${c.address}:${n.endpointId}`}><Card title="Account"><Copy value={c.address} label="Copy address"/><Detail data={{address:c.address,chain:c.chainId}}/><ErrorMessage error={account.error}/></Card><WalletBalances key={`${selectionScope}:${revision}`} account={c.address} endpoint={n.endpoint} index={data} indexReceivedAt={data?.portalReceivedAt}/><div className="native-tabs">{['Assets','Collectibles','Activity','Receive','Send','Address book','Connections'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>{tab==='Assets'?<Card title="Live assets"><Resource value={tokens}>{result=><><SourceAge updatedAt={result.receivedAt}/><WalletTokens inventory={result.inventory}/></>}</Resource></Card>:tab==='Collectibles'?<Card title="Collectible availability"><p>No supported collectible ownership or metadata service is connected for this account and network. Inventory is unavailable; this does not mean the account owns zero collectibles.</p><p>Unverified external media and metadata are not loaded.</p></Card>:tab==='Activity'?<Card title="Indexed transactions"><WalletHistory key={`${selectionScope}:${n.endpoint.networkKey||n.endpoint.id}:${revision}`} account={c.address} endpoint={n.endpoint} recent={data} recentAt={data?.portalReceivedAt}/></Card>:tab==='Receive'?<Receive account={c.address}/>:tab==='Address book'?<><WalletContacts key={selectionScope}/>{!!n.profile.contacts?.length&&<Card title="Legacy contacts"><p>Existing profile contacts are retained. Review and add them to this network-specific address book when needed.</p><Detail data={{contacts:n.profile.contacts}}/></Card>}</>:tab==='Connections'?<WalletConnections/>:<Card title="Send requires a supported transaction contract"><p>Transfers remain unavailable until the network’s authoritative ETDAG transaction preparation and mobile signing contracts are integrated. No nonce, fees, signature algorithm or transaction envelope is guessed.</p><WalletFeeMarket endpoint={n.endpoint}/><button onClick={()=>action.run(openWallet)}>Open Synergy Wallet app</button></Card>}</div>}</div>;
}
