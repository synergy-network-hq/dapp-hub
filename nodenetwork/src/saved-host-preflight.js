// Node Control Panel 608f2529, REQUIRED_HOST_PREFLIGHT_CHECK_IDS.
const networkReview = 'Compare the reported network identifiers with the approved network profile.';
const releaseReview = 'Check the reported value against the approved release manifest or build provenance.';
const requiredChecks = [
 ['genesis_hash', 'Genesis hash', networkReview],
 ['chain_id', 'Chain ID', networkReview],
 ['network', 'Network', networkReview],
 ['release_id', 'Release ID', releaseReview],
 ['release_tag', 'Release tag', releaseReview],
 ['binary_sha256', 'Binary SHA-256', releaseReview],
 ['core_revision', 'Core revision', releaseReview],
 ['synq_revision', 'SynQ revision', releaseReview],
 ['aegis_revision', 'Aegis revision', releaseReview],
 ['validator_config', 'Validator configuration', 'Ask the node operator to check the approved validator configuration version.'],
 ['key_binding', 'Public key binding', 'Ask the node operator to verify the public key binding using the approved custody workflow.'],
 ['validator_registry', 'Validator registry', 'Ask the node operator to verify the validator registry entry for this network.'],
 ['protected_pipeline_config', 'ProtectedPipeline configuration', 'Compare the configuration against the approved protocol and release.'],
 ['etdag_roots', 'ETDAG roots', 'Ask the node operator to verify the ETDAG roots through the approved diagnostics.'],
 ['vpn_reachability', 'VPN reachability', 'Ask the node operator for an authenticated VPN reachability check.'],
 ['peer_readiness', 'Peer readiness', 'Ask the node operator for an authenticated peer readiness check.'],
 ['storage', 'Storage', 'Ask the node operator to verify capacity and required storage paths.'],
 ['clock_sync', 'Clock synchronization', 'Ask the node operator to verify clock synchronization.'],
];
const requiredIds = new Set(requiredChecks.map(([id]) => id));
const stateLabels = {PASS:'Reported pass', FAIL:'Reported fail', UNKNOWN:'Reported unknown', missing:'Missing', ambiguous:'Ambiguous'};

export function projectSavedHostPreflight(checks) {
 const byId = new Map();
 let additionalCount = 0;
 for (const {id, status} of checks ?? []) {
  if (requiredIds.has(id)) byId.set(id, byId.has(id) ? 'ambiguous' : status);
  else additionalCount++;
 }
 let passCount = 0;
 const rows = requiredChecks.map(([id, check, followUp]) => {
  const state = byId.get(id) ?? 'missing';
  if (state === 'PASS') passCount++;
  return {
   id, check, status: stateLabels[state],
   next: state === 'PASS' ? null : state === 'FAIL' ? followUp : 'Review a newer observation with one conclusive result for this check.',
  };
 });
 return {rows, passCount, additionalCount};
}
