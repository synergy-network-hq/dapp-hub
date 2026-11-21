import {Card, Detail} from '@synergy-network/portal-native/dapp-sdk';

export function CustodyStatus({actions, observation, prepared, receipt, onOpenHistory}) {
 return <Card title="Pending validator custody">
  {!actions && <p>Host selection is deferred. An enrolled controller can separately inspect pending existing-network and formation custody.</p>}
  {actions}
  {receipt}
  {observation && <section aria-label="Pending custody observation">
   <h3>{observation.kind}</h3>
   {observation.pending ? <>
    <p>{prepared?'The controller reports that it prepared this pending identity and verified possession.'
     :'The controller reports verified possession for this pending identity.'} {observation.genesisSha256&&'It also reports verified signed Genesis authority. '}Consensus membership requires separate evidence.</p>
    <Detail data={{networkId:observation.networkId,chainId:observation.chainId,validatorAddress:observation.validatorAddress,
     genesisSha256:observation.genesisSha256,formationSha256:observation.formationSha256}}/>
    {observation.existingNetworkScoped&&<p>{observation.identityRequestRecorded
     ?'The controller reports a verified durable identity preparation request receipt.'
     :'No durable identity preparation request receipt was reported. This evidence identifies the Genesis input only.'} The local dispatch fence remains in place.</p>}
   </> : <p>The selected controller reported no pending custody for this check.</p>}
  </section>}
  <p>Current installation, interrupted dispatches and custody retirement require their own review.</p>
  {onOpenHistory && <button onClick={onOpenHistory}>Review local request history</button>}
 </Card>;
}
