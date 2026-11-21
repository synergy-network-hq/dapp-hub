import assert from 'node:assert/strict';
import test from 'node:test';
import {bootstrapObservation} from '../src/bootstrap-observation.js';
const reviewed={release_id:'reviewed-engineering',manifest_sha256:'a'.repeat(64)};
const record={root:'/opt/synergy',stagedRelease:reviewed.release_id,manifestSha256:reviewed.manifest_sha256,controllerEnrolled:true,softwareInstalled:false,activationAuthorized:false,communityEnrollment:false,operatorAuthorizationRequired:true,rootDeletionGuardActive:true,hostManagedRecords:['system-account:synergy-nodenetwork','/etc/ssh/sshd_config.d/synergy-nodenetwork.conf','/etc/sudoers.d/synergy-nodenetwork','/etc/systemd/system/synergy-installation-guard.service','/etc/systemd/system/multi-user.target.wants/synergy-installation-guard.service']};
test('current guarded bare bootstrap acknowledges enrollment only for exact reviewed package and all five registrations',()=>{
 assert.deepEqual(bootstrapObservation(record,reviewed),{root:'/opt/synergy',release:reviewed.release_id,manifestSha256:reviewed.manifest_sha256});
 for(const change of [{root:'/opt/Synergy'},{stagedRelease:'other'},{manifestSha256:'b'.repeat(64)},{rootDeletionGuardActive:false},{softwareInstalled:true},{activationAuthorized:true},{operatorAuthorizationRequired:false},{hostManagedRecords:record.hostManagedRecords.slice(0,3)},{hostManagedRecords:[...record.hostManagedRecords.slice(0,4),record.hostManagedRecords[0]]},{extra:true}])assert.throws(()=>bootstrapObservation({...record,...change},reviewed),/differs from/);
 const old={...record};delete old.rootDeletionGuardActive;assert.throws(()=>bootstrapObservation(old,reviewed),/differs from/);
});
