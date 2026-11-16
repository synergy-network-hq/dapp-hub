import {createHash} from 'node:crypto';

export const draftPolicyFixture = {release_id:'candidate-release',manifest_sha256:'a'.repeat(64),
 network_id:'fixture-network',chain_id:'1266',node_name:'fixture-validator'};

export function policyFixture(qualified = false) {
 const engine = ['controller.py','synergy_linux.py','lifecycle.py','conformance.py','apqe_layout.py','vpn.py','canary_rpc_relay.py'];
 const releases = {[draftPolicyFixture.release_id]:{manifest_sha256:draftPolicyFixture.manifest_sha256,inventory_authenticated:true,
  networks:{[draftPolicyFixture.network_id]:1266}}};
 const bootstrap = {format:'synergy-nodenetwork-host-policy-v1',root:'/opt/Synergy',community_enrollment:false,
  qualified_operations:[],engine_files:Object.fromEntries(engine.map(name=>[name,'b'.repeat(64)])),releases};
 return qualified ? {...bootstrap,qualification_scope:'disposable-test-only',qualified_operations:['install','uninstall','register','stop']}
  : {...bootstrap,host_account:{label:'Fixture private account label'},
   host_files:Object.fromEntries(['authorized_keys','sshd.conf','sudoers'].map(name=>[name,'c'.repeat(64)]))};
}

export const policyPin = bytes => createHash('sha256').update(bytes).digest('hex');
