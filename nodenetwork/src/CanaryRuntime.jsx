import {Card,Detail,Resource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';

export function CanaryRuntime({observation,permitted}) {
 return <Card title="Public Canary runtime observation">
  <p>Current signed Canary lineage, separate from Chain 1266. This read does not select or qualify a managed host, signer, VPN or validator.</p>
  <Resource value={{...observation,reload:permitted?observation.reload:null}}>{data=>{
   const value=data.canaryRuntime;
   return value?<><SourceAge source="Current Canary public RPC read" updatedAt={value.receivedAt}/>
    <Detail data={{reportedChain:value.chainId,reportedNetwork:value.networkId,reportedGenesis:value.genesisHash,
     reportedProcess:value.processId,reportedEpoch:value.epoch??'Unavailable',reportedFinalizedHeight:value.finalizedHeight,
     reportedEpochContext:value.epochContextRoot??'Unavailable',reportedCommitment:value.commitment??'Unavailable'}}/>
    <p>These are gateway-reported observations. No independent certificate or state proof has been verified by this read, and no enrollment or eligibility is established.</p></>:<p>Current Canary runtime observation unavailable.</p>;
  }}</Resource>
  <button disabled={!permitted||observation.loading} onClick={observation.reload}>Refresh current Canary observation</button>
 </Card>;
}
