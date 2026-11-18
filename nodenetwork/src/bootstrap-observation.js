// Public acknowledgement only; native validates the authenticated transport,
// exact master, permission and dispatch journal before returning these fields.
export function bootstrapObservation(value, reviewed) {
 const unsupported=()=>{throw Error('Bootstrap acknowledgement differs from the reviewed package. Inspect the original target and request history before another change.');};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==10
  ||value.root!=='/opt/synergy'||value.stagedRelease!==reviewed.release_id||value.manifestSha256!==reviewed.manifest_sha256
  ||value.rootDeletionGuardActive!==true||value.controllerEnrolled!==true||value.softwareInstalled!==false||value.activationAuthorized!==false
  ||value.communityEnrollment!==false||value.operatorAuthorizationRequired!==true)return unsupported();
 const expected=['system-account:synergy-nodenetwork','/etc/ssh/sshd_config.d/synergy-nodenetwork.conf','/etc/sudoers.d/synergy-nodenetwork','/etc/systemd/system/synergy-installation-guard.service','/etc/systemd/system/multi-user.target.wants/synergy-installation-guard.service'];
 if(!Array.isArray(value.hostManagedRecords)||value.hostManagedRecords.length!==expected.length||!expected.every(record=>value.hostManagedRecords.includes(record)))return unsupported();
 return {root:value.root,release:value.stagedRelease,manifestSha256:value.manifestSha256};
}
