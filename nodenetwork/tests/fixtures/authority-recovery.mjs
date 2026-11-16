import {createHash} from 'node:crypto';

export const authorityRecoveryHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const authorityRecoveryDraft={network_id:'fixture-canary',chain_id:'99999',node_name:'fixture-node',
 release_id:'fixture-candidate',manifest_sha256:authorityRecoveryHash('synthetic package manifest')};
const format='synergy-authority-recovery-activation-v1';
const authority='network/authority.json';
const certificate='network/authority-recovery-certificate.json';
const admission='network/rpc-gateway-admission.json';
const encode=value=>JSON.stringify(value)+'\n';

export function authorityRecoveryFixture({role='validator',relay=false,priorCertificate=false,alterPlan=()=>{},alterCertificate=()=>{}}={}) {
 const draft={...authorityRecoveryDraft};
 const previousAuthority=encode({payload:{epoch:12,record:'synthetic previous authority'}});
 const successorAuthority=encode({payload:{epoch:13,record:'synthetic successor authority'}});
 const certificateRecord={previous_authority_binding:[...Buffer.from(previousAuthority)],
  successor_authority_binding:[...Buffer.from(successorAuthority)],signatures:['synthetic fixture only']};
 alterCertificate(certificateRecord);
 const certificateBytes=encode(certificateRecord);
 const names=['config/node.json','installation.json',authority,'network/transport-registry.json',certificate];
 if(role==='validator')names.push('config/start-authorized.json');
 if(role==='rpc_gateway'||relay)names.push(admission);
 const original=Object.fromEntries(names.map(name=>[name,authorityRecoveryHash(`old ${name}`)]));
 original[certificate]=priorCertificate?authorityRecoveryHash('prior certificate'):null;
 original[authority]=authorityRecoveryHash(previousAuthority);
 const proposed=Object.fromEntries(names.map(name=>[name,authorityRecoveryHash(`next ${name}`)]));
 proposed[certificate]=authorityRecoveryHash(certificateBytes);
 proposed[authority]=authorityRecoveryHash(successorAuthority);
 const plan={format,root:'/opt/Synergy',role,package_sha256:draft.manifest_sha256,chain_id:99999,network_id:draft.network_id,
  immutable_network:Object.fromEntries(['genesis.json','authority-root.pub','network-manifest.json','transport-root.pub'].map(name=>[name,authorityRecoveryHash(name)])),
  before:original,after:proposed};
 alterPlan(plan);
 const planBytes=encode(plan);
 const planPin=authorityRecoveryHash(planBytes);
 const completion={format,root:plan.root,plan_sha256:planPin,certificate_sha256:plan.after[certificate],authority_sha256:plan.after[authority],
  package_sha256:plan.package_sha256,native_preflight_passed:true};
 return {draft,plan,planBytes,planPin,completion,completionBytes:encode(completion),certificateBytes,successorAuthority};
}
