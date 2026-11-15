import {Card, Detail} from '@synergy-network/portal-native/dapp-sdk';

export function IdentityPreflight({actions, observation, receipt}) {
 return <Card title="Validator identity preparation">
  <p>Existing networks require verified signed Genesis. A new formation requires an independently pinned formation context.</p>
  {!actions && <p>Host selection is deferred. An enrolled controller can check these inputs after installation.</p>}
  {actions}
  {receipt}
  {observation && <section aria-label="Validator identity preflight evidence">
   <h3>{observation.title}</h3>
   <p>{observation.genesisSha256
    ? 'The controller verified the signed Genesis and its authority for the installed network.'
    : 'The controller matched the formation context to the operator pin and installation network.'}</p>
   <Detail data={{
    networkId: observation.networkId, chainId: observation.chainId, genesisSha256: observation.genesisSha256,
    formationSha256: observation.formationSha256, formationId: observation.formationId,
   }}/>
   <p>Evidence describes preparation inputs. Custody creation, possession and consensus membership require separate checks.</p>
  </section>}
 </Card>;
}
