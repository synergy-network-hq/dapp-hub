import {Card, Detail, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';

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

function LayoutChecks({layout}) {
 if (!layoutChecks.every(([key]) => typeof layout?.[key] === 'boolean')) {
  return <p>The native inspection supplied no supported package layout result.</p>;
 }
 return <ul aria-label="Master package layout checks">{layoutChecks.map(([key,label,matched,unmatched]) => (
  <li key={key}>{label} · {layout[key] ? matched : unmatched}</li>
 ))}</ul>;
}

function InventoryEvidence({master}) {
 const result = master.inventory;
 if (result?.status === 'matched' && Number.isInteger(result.verifiedFiles)
     && result.verifiedFiles > 0 && result.verifiedFiles <= 4096 && result.verifiedFiles === master.fileCount
     && Number.isSafeInteger(result.verifiedBytes) && result.verifiedBytes >= 0 && result.verifiedBytes <= 256 * 1024 * 1024) {
  return <>
   <p role="status">Local files matched the manifest at inspection. Checked {result.verifiedFiles} declared files and {result.verifiedBytes} bytes.</p>
   <LayoutChecks layout={result.layout}/>
  </>;
 }
 if (result?.status === 'unavailable' && Object.hasOwn(inventoryReasons, result.reason)) {
  return <p role="status">Local file verification unavailable. {inventoryReasons[result.reason]}</p>;
 }
 return <p role="status">The native inspection supplied no supported local file verification result.</p>;
}

export function MasterReview({permitted, reviewing, master, error, onInspect}) {
 return <Card title="Node architecture master">
  <button disabled={!permitted || reviewing} onClick={onInspect}>{reviewing ? 'Inspecting…' : 'Inspect Synergy master folder'}</button>
  {permitted && <ErrorMessage error={error}/>}
  {permitted && master && <>
   <Detail data={{release:master.release, architecture:master.architecture, declaredFiles:master.fileCount, manifestSha256:master.manifestSha256}}/>
   <InventoryEvidence master={master}/>
  </>}
  <p>Verify the manifest digest against the independently approved release. Installation and updates require separate authorization.</p>
 </Card>;
}
