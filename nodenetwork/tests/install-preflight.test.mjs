import assert from 'node:assert/strict';
import test from 'node:test';
import {installPreflightChecklist} from '../src/install-preflight.js';
import {installParameters} from '../src/nodeNetwork.js';

const form = {
 release_id: 'fixture',
 manifest_sha256: 'a'.repeat(64),
 network_id: 'fixture-net',
 chain_id: '1266',
 node_name: 'fixture-node',
};
const target = {kind: 'remote', host: 'fixture.invalid', root: '/opt/Synergy'};
const capability = {operation: 'install_preflight', available: true};
const capabilities = {data: {operations: [capability]}};
const master = {release: form.release_id, manifestSha256: form.manifest_sha256};
const received = {parameters: installParameters(form), state: 'received', receivedAt: 0};
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
 assert.equal(status(current, 'Installation preflight receipt'), 'Response received');
 assert.equal(status(current, 'Required host checks'), 'Unverified');
 const changed = installPreflightChecklist({...inputs, form: {...form, node_name: 'another-node'}});
 assert.equal(status(changed, 'Installation preflight receipt'), 'Draft changed');
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
 const duplicate = installPreflightChecklist({...inputs, capabilities: {data: {operations: [capability, capability]}}});
 assert.equal(duplicate.canRun, false);
 const mismatched = installPreflightChecklist({...inputs, master: {...master, manifestSha256: 'b'.repeat(64)}});
 assert.equal(status(mismatched, 'Inspected master comparison'), 'References differ');
});
