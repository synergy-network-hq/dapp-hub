import assert from 'node:assert/strict';
import test from 'node:test';
import {installationObservation, installPreflightChecklist, installPreflightObservation} from '../src/install-preflight.js';
import {installParameters} from '../src/nodeNetwork.js';

const form = {
 release_id: 'fixture',
 manifest_sha256: 'a'.repeat(64),
 network_id: 'fixture-net',
 chain_id: '1266',
 node_name: 'fixture-node',
};
const target = {kind: 'remote', host: 'fixture.invalid', root: '/opt/Synergy'};
const capability = {operation: 'install_preflight', kind:'read', available: true};
const capabilities = {data: {summary:{controllerVersion:1,controllerReportedInstalled:false},operations: [capability]}};
const master = {release: form.release_id, manifestSha256: form.manifest_sha256};
const report = {packageVerified:true, release:form.release_id, root:target.root, networkSelectionApproved:true,
 genesisAuthorityVerified:false, activationAuthorized:false};
const received = {parameters: installParameters(form), state: 'received', receivedAt: 0, observation:report};
const status = (checklist, check) => checklist.rows.find(row => row.check === check).status;

test('draft and master comparison remain useful while host selection is deferred', () => {
 const checklist = installPreflightChecklist({form, master, permitted: true, capabilities, attempt: received});
 assert.equal(checklist.canRun, false);
 assert.equal(status(checklist, 'Required request fields'), 'Format accepted');
 assert.equal(status(checklist, 'Inspected master comparison'), 'References match');
 assert.equal(status(checklist, 'Target preflight access'), 'Host selection deferred');
 assert.equal(status(checklist, 'Installation preflight receipt'), 'Not run');
});

test('a successful controller response stays tied to the exact submitted draft', () => {
 const inputs = {form, target, permitted: true, capabilities, attempt: received};
 const current = installPreflightChecklist(inputs);
 assert.equal(current.canRun, true);
 assert.deepEqual(current.reviewedParameters,received.parameters);
 assert.equal(status(current, 'Installation preflight receipt'), 'Checks reported');
 assert.equal(status(current, 'Staged package inventory'), 'Reported verified');
 assert.equal(status(current, 'Host network policy'), 'Reported approved');
 assert.equal(status(current, 'Genesis authority'), 'Unverified');
 assert.equal(status(current, 'Activation authorization'), 'Not authorized');
 assert.equal(status(current, 'Required host checks'), 'Unverified');
 const changed = installPreflightChecklist({...inputs, form: {...form, node_name: 'another-node'}});
 assert.equal(status(changed, 'Installation preflight receipt'), 'Draft changed');
 assert.equal(changed.reviewedParameters,null);
 assert.equal(installPreflightChecklist({...inputs,attemptCurrent:false}).reviewedParameters,null);
 assert.ok(!changed.rows.some(row=>row.check==='Staged package inventory'));
 const invalid = installPreflightChecklist({...inputs, form: {...form, chain_id: '01266'}});
 assert.equal(invalid.canRun, false);
 assert.equal(status(invalid, 'Installation preflight receipt'), 'Draft changed');
});

test('permission loss and duplicate capability rows prevent running preflight', () => {
 const inputs = {form, target, permitted: true, capabilities, master, attempt: received};
 const revoked = installPreflightChecklist({...inputs, permitted: false});
 assert.equal(revoked.canRun, false);
 assert.equal(status(revoked, 'Inspected master comparison'), 'Not inspected');
 assert.equal(status(revoked, 'Installation preflight receipt'), 'Not run');
 const duplicate = installPreflightChecklist({...inputs, capabilities: {data: {...capabilities.data,operations: [capability, capability]}}});
 assert.equal(duplicate.canRun, false);
 assert.equal(duplicate.reviewedParameters,null);
 const mismatched = installPreflightChecklist({...inputs, master: {...master, manifestSha256: 'b'.repeat(64)}});
 assert.equal(status(mismatched, 'Inspected master comparison'), 'References differ');
});

test('accepts only scoped installation evidence with bounded inventory counts and no service or activation authority', () => {
 const valid={schema:'nodenetwork-installed-validator-v1',root:target.root,role:'validator',release_id:form.release_id,
  manifest_sha256:form.manifest_sha256,network_id:form.network_id,chain_id:form.chain_id,node_name:form.node_name,
  declared_members:12,host_integrations_registered:false,consensus_started:false};
 assert.equal(installationObservation(valid,received.parameters,target),valid);
 for (const changed of [
  {...valid,package_files:{'/private/example':'a'.repeat(64)}},{...valid,chain_id:1266},{...valid,release_id:'different'},
  {...valid,node_name:'different'},{...valid,declared_members:0},{...valid,declared_members:4097},
  {...valid,host_integrations_registered:true},{...valid,consensus_started:true},
 ]) assert.throws(()=>installationObservation(changed,received.parameters,target),/outcome is uncertain/);
});

test('accepts only the request-bound owner status and withholds package rows for unsupported successful envelopes', () => {
 assert.equal(installPreflightObservation(report, received.parameters, target), report);
 const inputs = {form, target, permitted:true, capabilities};
 for (const observation of [undefined, {}, {...report, release:'other-package'}, {...report,root:'/opt/synergy'},
  {...report,networkSelectionApproved:false},{...report,activationAuthorized:true},{...report,genesisAuthorityVerified:true},
  {...report,unexpected:'unreviewed fixture'},
 ]) {
  assert.throws(()=>installPreflightObservation(observation,received.parameters,target),/unsupported or mismatched/);
  const checklist=installPreflightChecklist({...inputs,attempt:{...received,observation}});
  assert.equal(status(checklist,'Installation preflight receipt'),'Unsupported report');
  assert.ok(!checklist.rows.some(row=>row.check==='Host network policy'));
 }
 for (const data of [{...capabilities.data,summary:{controllerVersion:2}},
  {...capabilities.data,operations:[{...capability,kind:'mutation'}]},
 ]) assert.equal(installPreflightChecklist({...inputs,capabilities:{data}}).canRun,false);
});
