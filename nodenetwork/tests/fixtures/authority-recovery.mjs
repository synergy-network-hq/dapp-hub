import {createHash} from 'node:crypto';

export const authorityRecoveryHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const authorityRecoveryDraft={network_id:'fixture-canary',chain_id:'99999',node_name:'fixture-node',
 release_id:'fixture-candidate',manifest_sha256:authorityRecoveryHash('synthetic package manifest')};
const format='synergy-authority-recovery-activation-v1';
const authority='network/authority.json';
const certificate='network/authority-recovery-certificate.json';
const admission='network/rpc-gateway-admission.json';
const registry='network/transport-registry.json';
const startupPaths={configuration:'config/node.json',receipt:'installation.json',policy:'config/start-authorized.json'};
const encode=value=>JSON.stringify(value)+'\n';

export function authorityRecoveryFixture({role='validator',relay=false,priorCertificate=false,alterPlan=()=>{},alterCertificate=()=>{},alterStartup=()=>{}}={}) {
 const draft={...authorityRecoveryDraft};
 const previousAuthority=encode({payload:{epoch:12,record:'synthetic previous authority'}});
 const successorAuthority=encode({payload:{epoch:13,record:'synthetic successor authority'}});
 const certificateRecord={previous_authority_binding:[...Buffer.from(previousAuthority)],
  successor_authority_binding:[...Buffer.from(successorAuthority)],signatures:['synthetic fixture only']};
 alterCertificate(certificateRecord);
 const certificateBytes=encode(certificateRecord);
 const names=[startupPaths.configuration,startupPaths.receipt,authority,registry,certificate];
 if(role==='validator')names.push(startupPaths.policy);
 if(role==='rpc_gateway'||relay)names.push(admission);
 const original=Object.fromEntries(names.map(name=>[name,authorityRecoveryHash(`old ${name}`)]));
 original[certificate]=priorCertificate?authorityRecoveryHash('prior certificate'):null;
 original[authority]=authorityRecoveryHash(previousAuthority);
 const proposed=Object.fromEntries(names.map(name=>[name,authorityRecoveryHash(`next ${name}`)]));
 proposed[certificate]=authorityRecoveryHash(certificateBytes);
 proposed[authority]=authorityRecoveryHash(successorAuthority);
 const root='/opt/Synergy';
 const identity={chain_id:99999,network_id:draft.network_id};
 const immutableNetwork=Object.fromEntries(['genesis.json','authority-root.pub','network-manifest.json','transport-root.pub']
  .map(name=>[name,authorityRecoveryHash(name)]));
 const before={configuration:{...identity,genesis_path:`${root}/network/genesis.json`,manifest_path:`${root}/network/network-manifest.json`,
  consensus:{authority_binding:`${root}/${authority}`,authority_trust_key_path:`${root}/network/authority-root.pub`},
  apqe_transport:{registry_path:`${root}/${registry}`},operatorNote:'synthetic sensitive fixture data'},
  receipt:{...identity,format:'synergy-universal-linux-v1',root,role,package_sha256:draft.manifest_sha256},
  policy:{...identity,public_file_sha256:{...immutableNetwork,'authority.json':original[authority],'transport-registry.json':original[registry]}}};
 if(priorCertificate) {
  before.configuration.consensus.authority_recovery_certificate_path=`${root}/${certificate}`;
  before.receipt.authority_recovery_certificate_sha256=original[certificate];
  before.policy.authority_recovery_certificate_sha256=original[certificate];
 }
 const after=structuredClone(before);
 after.configuration.consensus.authority_recovery_certificate_path=`${root}/${certificate}`;
 after.receipt.authority_recovery_certificate_sha256=proposed[certificate];
 after.policy.authority_recovery_certificate_sha256=proposed[certificate];
 after.policy.public_file_sha256['authority.json']=proposed[authority];
 after.policy.public_file_sha256['transport-registry.json']=proposed[registry];
 alterStartup(after);
 const startup={before:{},after:{}};
 for(const [kind,path] of Object.entries(startupPaths)) {
  if(!names.includes(path))continue;
  startup.before[kind]=encode(before[kind]);
  startup.after[kind]=encode(after[kind]);
  original[path]=authorityRecoveryHash(startup.before[kind]);
  proposed[path]=authorityRecoveryHash(startup.after[kind]);
 }
 const plan={format,root,role,package_sha256:draft.manifest_sha256,...identity,
  immutable_network:immutableNetwork,before:original,after:proposed};
 alterPlan(plan);
 const planBytes=encode(plan);
 const planPin=authorityRecoveryHash(planBytes);
 const completion={format,root:plan.root,plan_sha256:planPin,certificate_sha256:plan.after[certificate],authority_sha256:plan.after[authority],
  package_sha256:plan.package_sha256,native_preflight_passed:true};
 return {draft,plan,planBytes,planPin,completion,completionBytes:encode(completion),certificateBytes,successorAuthority,startup};
}
