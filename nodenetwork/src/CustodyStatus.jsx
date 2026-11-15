import {Card, Detail} from '@synergy-network/portal-native/dapp-sdk';

export function CustodyStatus({actions, observation, receipt, onOpenHistory}) {
 return <Card title="Pending validator custody">
  {!actions && <p>Host selection is deferred. An enrolled controller can separately inspect pending existing-network and formation custody.</p>}
  {actions}
  {receipt}
  {observation && <section aria-label="Pending custody observation">
   <h3>{observation.kind}</h3>
   {observation.pending ? <>
    <p>The controller reports verified possession for this pending identity. {observation.genesisSha256&&'It also reports verified signed Genesis authority. '}Consensus membership requires separate evidence.</p>
    <Detail data={{networkId:observation.networkId,chainId:observation.chainId,validatorAddress:observation.validatorAddress,
     genesisSha256:observation.genesisSha256,formationSha256:observation.formationSha256}}/>
   </> : <p>The selected controller reported no pending custody for this check.</p>}
  </section>}
  <p>Current installation, interrupted dispatches and custody retirement require their own review.</p>
  {onOpenHistory && <button onClick={onOpenHistory}>Review local request history</button>}
 </Card>;
}
