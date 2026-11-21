import {createHash} from 'node:crypto';

export const manifestPin = raw => createHash('sha256').update(raw).digest('hex');

export function installationReceiptFixture() {
 const format = 'synergy-universal-linux-v1';
 const packageFiles = {'bin/synergy-node':'a'.repeat(64),'assets/fixture-only-private.json':'b'.repeat(64)};
 const manifest = JSON.stringify({format,architecture:'x86_64',release_id:'fixture-release',files:packageFiles},null,2)+'\n';
 const draft = {release_id:'fixture-release',manifest_sha256:manifestPin(manifest),network_id:'fixture-network',
  chain_id:'1266',node_name:'fixture-private-node'};
 const receipt = {format,root:'/opt/Synergy',role:'validator',network_id:draft.network_id,chain_id:1266,node_name:draft.node_name,
  package_sha256:draft.manifest_sha256,package_files:{...packageFiles},host_integrations:[],consensus_started:false};
 return {manifest,draft,receipt};
}
