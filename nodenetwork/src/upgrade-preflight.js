export function upgradePreflightObservation(value, submitted) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
  || typeof value.release !== 'string' || value.release !== submitted?.release_id
  || value.packageVerified !== true || value.automaticRestart !== false) {
  throw Error('The selected controller returned unsupported or mismatched update preflight evidence.');
 }
 return {release: value.release, packageVerified: value.packageVerified, automaticRestart: value.automaticRestart};
}

const pin = value => typeof value === 'string' && value.length === 64 && !/[^a-f0-9]/.test(value);
const upgradeUncertain = 'Software upgrade outcome is uncertain. Review the selected installation and its pending upgrade evidence before another change.';

export function upgradeObservation(value, submitted) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5
  || value.schema !== 'nodenetwork-software-upgrade-v1' || !pin(value.manifest_sha256)
  || value.manifest_sha256 !== submitted?.manifest_sha256) {
  throw Error(upgradeUncertain);
 }
 const {outcome, manifest_sha256: manifest, previous_manifest_sha256: previous, vpn_restart_required: vpnRestartRequired} = value;
 const scoped = outcome === 'already_current' ? previous === null && vpnRestartRequired === null
  : ['completed', 'resumed'].includes(outcome) && pin(previous) && previous !== manifest && typeof vpnRestartRequired === 'boolean';
 if (!scoped) throw Error(upgradeUncertain);
 return {outcome, manifest, previous, vpnRestartRequired};
}
