import {Card, Detail} from '@synergy-network/portal-native/dapp-sdk';
import {GenesisStageFiles} from './GenesisStageFiles.jsx';

export function IdentityPreflight({actions, observation, receipt, permitted}) {
 const binding = typeof observation?.bound === 'boolean';
 const staging = observation?.artifactPins;
 return <Card title="Validator identity preparation">
  <p>Existing networks require verified signed Genesis. A new formation requires an independently pinned formation context.</p>
  {!actions && <p>Host selection is deferred. An enrolled controller can check these inputs after installation.</p>}
  {actions}
  {receipt}
  {observation && <section aria-label="Validator identity preflight evidence">
   <h3>{observation.title}</h3>
   {staging && <p>The controller reports a prepared validator and approved Genesis input pins for local comparison.</p>}
   {binding && <>
    <p>The controller verified the staged signed Genesis and its admission of the reported validator address.</p>
    <p>{observation.bound ? 'Local custody is already bound to this Genesis.' : 'The controller reports that local custody is still unbound.'}</p>
    <p>{observation.stageReceiptVerified ? 'The controller verified a Genesis staging receipt.' : 'The controller reported no Genesis staging receipt.'}</p>
   </>}
   {!staging && !binding && <p>{observation.genesisSha256
    ? 'The controller verified the signed Genesis and its authority for the installed network.'
    : 'The controller matched the formation context to the operator pin and installation network.'}</p>}
   <Detail data={{
    networkId: observation.networkId, chainId: observation.chainId, genesisSha256: observation.genesisSha256,
    formationSha256: observation.formationSha256, formationId: observation.formationId, validatorAddress: observation.validatorAddress,
   }}/>
   {binding
    ? <p>Live active-set status, service readiness and consensus participation require separate checks.</p>
    : <p>Evidence describes preparation inputs. Custody creation, possession and consensus membership require separate checks.</p>}
  </section>}
  <GenesisStageFiles key={String(permitted)} permitted={permitted} policy={staging}/>
 </Card>;
}
