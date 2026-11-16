import {Card,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {releaseReferenceChecks,upgradeParameters} from './nodeNetwork.js';
import {readUpgradeConfigurationManifest,readUpgradeConfigurationSchema,reviewUpgradeConfiguration} from './upgrade-configuration.js';
import {useObservationFile} from './useObservationFile.js';

const findings = {
 matched:'The selected configuration passes the candidate schema checks.',
 type:'The candidate schema expects a different value type.',
 constant:'A required constant differs from the candidate schema.',
 missing:'The selected configuration is missing a required field.',
 extra:'The selected configuration contains a field outside the candidate schema.',
};

function ConfigurationFile({schema,canRead}) {
 const {result,error,reading,select} = useObservationFile((file,current)=>
  reviewUpgradeConfiguration(file,schema,()=>current() && canRead()));
 return <>
  <label>Saved raw node configuration JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Checking the saved configuration…</p>}
  <ErrorMessage error={error}/>
  {result && <section aria-label="Candidate configuration findings">
   <p role="status">{findings[result.status]}</p>
  </section>}
 </>;
}

function SchemaFile({manifest,canRead}) {
 const {result,error,reading,revision,select} = useObservationFile((file,current)=>
  readUpgradeConfigurationSchema(file,manifest,()=>current() && canRead()));
 return <>
  <label>Candidate NodeConfiguration schema JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {reading && <p role="status">Checking the selected schema…</p>}
  <ErrorMessage error={error}/>
  {result && <>
   <p role="status">The schema digest matches the candidate manifest.</p>
   <ConfigurationFile key={revision} schema={result} canRead={canRead}/>
  </>}
 </>;
}

function ManifestFile({references,canRead}) {
 const {result,error,reading,revision,clear,select} = useObservationFile((file,current)=>
  readUpgradeConfigurationManifest(file,references,()=>current() && canRead()));
 return <>
  <label>Candidate manifest for schema review <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(result || error || reading) && <button onClick={clear}>Clear configuration review</button>}
  {reading && <p role="status">Checking the candidate manifest…</p>}
  <ErrorMessage error={error}/>
  {result && <>
   <p role="status">The manifest matches the update draft and declares the NodeConfiguration schema.</p>
   <SchemaFile key={revision} manifest={result} canRead={canRead}/>
  </>}
 </>;
}

export function UpgradeConfiguration({form,permitted,canRead = () => permitted}) {
 const references = releaseReferenceChecks(form).every(check=>check.valid) ? upgradeParameters(form) : null;
 return <Card title="Candidate configuration compatibility">
  <p>Choose the candidate manifest, its NodeConfiguration schema and a saved raw node.json. The review checks the configuration against the manifest-bound schema on this device.</p>
  {!permitted ? <p>Allow NodeNetwork inspection in Security &amp; permissions to review local configuration compatibility.</p>
   : references ? <ManifestFile key={JSON.stringify(references)} references={references} canRead={canRead}/>
   : <p>Enter a release ID and candidate manifest SHA-256 above to start the review.</p>}
  <p>Host path resolution, current installed state and upgrade authorization require separate verification.</p>
 </Card>;
}
