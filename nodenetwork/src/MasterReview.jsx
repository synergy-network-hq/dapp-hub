import {Card, Detail, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {masterDraftComparison,matchedMasterInventory} from './install-preflight.js';
import {releaseReferenceChecks} from './nodeNetwork.js';

const inventoryReasons = {
 changed: 'The folder changed during inspection. Inspect a stable copy of the package.',
 digest_mismatch: 'A file’s SHA-256 differs from the manifest. Obtain a fresh copy of the package.',
 invalid_inventory: 'The manifest has unsupported inventory paths or SHA-256 values.',
 inventory_mismatch: 'Files in the folder differ from the declared inventory. Check for missing or added files.',
 limits: 'The folder exceeds the local inventory or size limit.',
 platform: 'Local file verification is unavailable on this platform.',
 unreadable: 'A directory or file could not be read. Check that the package is accessible.',
 unsafe_member: 'The folder contains an unsafe path, link or special file.',
};

const layoutChecks = [
 ['roles', 'Role catalog and directories', '20 distinct roles and supported implementations', 'Check the role catalog and directories'],
 ['runtimeAreas', 'Runtime and custody areas', 'All 10 required directories are empty', 'A required directory is missing or contains entries'],
 ['linuxHeaders', 'Linux x86-64 binary headers', 'All 4 required ELF headers match', 'A required ELF header is missing or differs'],
];

const apqeReasons = {
 declaration_missing: 'The manifest has no supported APQE provider declaration.',
 declaration_invalid: 'The manifest does not describe the supported portable candidate profile.',
 report_digest: 'The provider report digest differs from the manifest’s file inventory.',
 report_unavailable: 'The provider report exceeds the local review limit.',
 report_invalid: 'The build report does not describe the eight required portable candidate libraries.',
 libraries_mismatch: 'The report’s library names or digests differ from the verified package inventory.',
};

function LayoutChecks({layout}) {
 if (!layoutChecks.every(([key]) => typeof layout?.[key] === 'boolean')) {
  return <p>The native inspection supplied no supported package layout result.</p>;
 }
 return <ul aria-label="Master package layout checks">{layoutChecks.map(([key,label,matched,unmatched]) => (
  <li key={key}>{label} · {layout[key] ? matched : unmatched}</li>
 ))}</ul>;
}

function ApqeCandidateReview({result}) {
 if (result?.status === 'matched' && result.libraryCount === 8) {
  return <p>The APQE portable candidate report and all eight library digests agree with this package.</p>;
 }
 if (result?.status === 'unavailable' && Object.hasOwn(apqeReasons,result.reason)) {
  return <p>APQE candidate check unavailable. {apqeReasons[result.reason]}</p>;
 }
 return <p>The native inspection supplied no supported APQE candidate check.</p>;
}

function InventoryEvidence({master}) {
 const result = master.inventory;
 if (matchedMasterInventory(master)) {
  return <>
   <p role="status">Local files matched the manifest at inspection. Checked {result.verifiedFiles} declared files and {result.verifiedBytes} bytes.</p>
   <LayoutChecks layout={result.layout}/>
   <ApqeCandidateReview result={result.apqeProvider}/>
  </>;
 }
 if (result?.status === 'unavailable' && Object.hasOwn(inventoryReasons, result.reason)) {
  return <p role="status">Local file verification unavailable. {inventoryReasons[result.reason]}</p>;
 }
 return <p role="status">The native inspection supplied no supported local file verification result.</p>;
}

function BuiltinBootstrapReference({master}) {
 const supported=releaseReferenceChecks({release_id:master.release,manifest_sha256:master.manifestSha256}).every(field=>field.valid)
  &&typeof master.allowedEngineeringRuntime==='boolean'&&master.releaseTrustVerified===false&&master.installAuthorized===false;
 if(!supported)return <p role="status">Independent engineering bootstrap reference comparison is unavailable.</p>;
 return <p role="status">{master.allowedEngineeringRuntime
  ?'The exact master digest matches an independently compiled engineering bootstrap reference. Host authorization and installation require separate native approval.'
  :'The master does not match this native build’s independently compiled engineering bootstrap references.'}</p>;
}

export function MasterReview({permitted, reviewing, master, error, onInspect, updateDraft}) {
 return <Card title="Node architecture master">
  <button disabled={!permitted || reviewing} onClick={onInspect}>{reviewing ? 'Inspecting…' : 'Inspect Synergy master folder'}</button>
  {permitted && <ErrorMessage error={error}/>}
  {permitted && master && <>
   <Detail data={{release:master.release, architecture:master.architecture, declaredFiles:master.fileCount, manifestSha256:master.manifestSha256}}/>
   <BuiltinBootstrapReference master={master}/>
   <InventoryEvidence master={master}/>
   {updateDraft && <p role="status">{masterDraftComparison(master,updateDraft).detail}</p>}
  </>}
  <p>Verify the manifest digest against the independently approved release. Installation and updates require separate authorization.</p>
 </Card>;
}
