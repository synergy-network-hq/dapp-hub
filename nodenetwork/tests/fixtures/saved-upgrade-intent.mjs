import {createHash} from 'node:crypto';

const pin = raw => createHash('sha256').update(raw).digest('hex');
const format = 'synergy-universal-linux-v1';
const root = '/opt/Synergy';

export function savedUpgradeFixture({registered = true,relay = false} = {}) {
 const priorFiles = {'bin/synergy-node':'a'.repeat(64),'tools/private-old-fixture.py':'b'.repeat(64),'lib/unchanged.so':'c'.repeat(64)};
 const nextFiles = {'bin/synergy-node':'d'.repeat(64),'tools/private-new-fixture.py':'e'.repeat(64),'lib/unchanged.so':'c'.repeat(64)};
 const oldManifest = JSON.stringify({format,architecture:'x86_64',release_id:'prior-release',files:priorFiles},null,2)+'\n';
 const candidate = JSON.stringify({format,architecture:'x86_64',release_id:'candidate-release',files:nextFiles},null,2)+'\n';
 const references = {release_id:'candidate-release',manifest_sha256:pin(candidate)};
 const names = ['synergy-node.service','synergy-vpn.service',...(relay?['synergy-canary-rpc-relay.service']:[])];
 const definitions = Object.fromEntries(names.map(name=>[name,`Fixture-only unit content for ${name}\n`]));
 const integration = contents => ({root,paths:names.map(name=>`/etc/systemd/system/${name}`),
  sha256:Object.fromEntries(names.map(name=>[`/etc/systemd/system/${name}`,pin(contents[name])]))});
 const intent = {format:'synergy-software-upgrade-v1',root,old_receipt:{root,format,package_sha256:pin(oldManifest),
  package_files:priorFiles,node_name:'private fixture name'},old_manifest_json:oldManifest,new_package_sha256:references.manifest_sha256,
  new_files:nextFiles,registered,stage:'commissioned',
  old_integration:registered?integration(Object.fromEntries(names.map(name=>[name,'prior private fixture unit']))):null,
  new_units:registered?definitions:{},new_wrapper:registered?'private fixture wrapper\n':null,
  ...(registered?{new_integration:integration(definitions)}:{})};
 return {intent,candidate,references};
}

export function savedUpgradeCompletionFixture(resumed = true) {
 const {intent,references} = savedUpgradeFixture();
 const pins = {priorPin:intent.old_receipt.package_sha256,candidatePin:references.manifest_sha256};
 return {pins,receipt:{format:'synergy-software-upgrade-completed-v1',root,old_package_sha256:pins.priorPin,
  new_package_sha256:pins.candidatePin,resumed,consensus_started:false,automatic_restart:false}};
}
