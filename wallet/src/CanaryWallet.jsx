import {isValidSynergyAddress} from './wallet-address.js';
import {useState} from 'react';
import {CANARY_PROFILE,canaryRead,canaryProcessingStatus,canaryAccountStatus,Card,Detail,Resource,useResource,openWallet,useAction,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';

function AccountObservation({address}){
 const observation=useResource(async signal=>canaryAccountStatus(await canaryRead('synergy_getAccount',{address,at_height:null},{signal}),address),address);
 return <Resource value={observation}>{value=><Detail data={{address:value.address,finalizedBalanceNwei:value.balanceNwei}}/>}</Resource>;
}

export function CanaryWallet(){
 const [address,setAddress]=useState(''),[requested,setRequested]=useState(null),[sequence,setSequence]=useState(0),action=useAction();
 const probe=useResource(async signal=>canaryProcessingStatus(await canaryRead('synergy_getProcessingContextV1',{}, {signal})),'wallet-canary-processing');
 const valid=address.trim().startsWith('syna1')&&isValidSynergyAddress(address.trim());
 const available=!!probe.data&&!probe.error&&!probe.loading;
 return <Card title="PoSy Canary · public account lookup">
  <p>Chain {CANARY_PROFILE.chainId}. Read a public ordinary account on the pinned Canary network. This does not pair a wallet or establish control of the address.</p>
  <Resource value={probe}>{value=><Detail data={value}/>}</Resource>
  <div className="native-actions"><button disabled={probe.loading} onClick={()=>{setRequested(null);probe.reload();}}>Check Canary RPC</button><button onClick={()=>action.run(openWallet)}>Open Synergy Wallet</button></div>
  <ErrorMessage error={action.error}/>
  <form onSubmit={e=>{e.preventDefault();if(valid&&available){setRequested(address.trim());setSequence(s=>s+1);}}}>
   <label>Public Canary ordinary address<input value={address} maxLength={41} placeholder="syna1…" onChange={e=>{setAddress(e.target.value);setRequested(null);}}/></label>
   <button disabled={!valid||!available}>Read finalized balance</button>
  </form>
  {available&&requested&&<AccountObservation key={sequence} address={requested}/>}
  <p>Canary pairing and transfers in Portal require qualified APQE phone authorization bound to this Genesis. Use the standalone Synergy Wallet for its supported Canary flows.</p>
 </Card>;
}
