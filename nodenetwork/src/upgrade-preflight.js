export function upgradePreflightObservation(value, submitted) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
  || typeof value.release !== 'string' || value.release !== submitted?.release_id
  || value.packageVerified !== true || value.automaticRestart !== false) {
  throw Error('The selected controller returned unsupported or mismatched update preflight evidence.');
 }
 return {release: value.release, packageVerified: value.packageVerified, automaticRestart: value.automaticRestart};
}
