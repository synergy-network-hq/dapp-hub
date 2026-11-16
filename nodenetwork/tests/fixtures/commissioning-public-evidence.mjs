import {createHash} from 'node:crypto';

export const commissioningPin = raw=>createHash('sha256').update(raw).digest('hex');
export const commissioningDraftFixture = {network_id:'fixture-engineering',chain_id:'99999',node_name:'fixture-node'};
const encode = value=>JSON.stringify(value)+'\n';

export function commissioningFixture({
 draft=commissioningDraftFixture,roster=['fixture-validator-alpha','fixture-validator-beta'],
 alterAuthority=()=>{},alterPolicy=()=>{},alterManifest=()=>{},
} = {}) {
 const {network_id,node_name,chain_id} = draft;
 const authority={payload:{version:1,chain_id:Number(chain_id),network_id,
  validators:[...roster.map(validator_id=>({record:{validator_id,status:'active'}})),
   {record:{validator_id:'fixture-validator-shadow',status:'shadow'}}]},signer_key_id:'synthetic-fixture-signer',signature:[0,1]};
 alterAuthority(authority);
 const publicFiles={
  'genesis.json':'{}\n','authority.json':encode(authority),'authority-root.pub':new Uint8Array([0,255,10]),
  'network-manifest.json':'{}\n','transport-registry.json':'{}\n','transport-root.pub':new Uint8Array([1,254,0]),
 };
 const publicPins = Object.fromEntries(Object.entries(publicFiles).map(([name,raw])=>[name,commissioningPin(raw)]));
 const policy={network_id,chain_id:Number(chain_id),all_validators_ready:true,all_pairs_vpn_verified:true,
  validator_addresses:[...roster],profile:'engineering_canary_pq_vsession_v1',production_approved:false,public_file_sha256:{...publicPins}};
 alterPolicy(policy);
 const startup=encode(policy);
 const manifest={format:'synergy-apqe-commissioning-v1',root:'/opt/Synergy',network_id,chain_id:Number(chain_id),node_name,
  files:{'config/node.json':'0'.repeat(64),'config/start-authorized.json':commissioningPin(startup),
   ...Object.fromEntries(Object.entries(publicPins).map(([name,digest])=>[`network/${name}`,digest])),
   ...Object.fromEntries(['validator.pub.json','enrollment.json','custody.json','unlock'].map(name=>[`keys/apqe/${name}`,'1'.repeat(64)])),
  }};
 alterManifest(manifest);
 const commissioning=encode(manifest);
 return {draft,commissioning,startup,publicFiles,expected:commissioningPin(commissioning)};
}
