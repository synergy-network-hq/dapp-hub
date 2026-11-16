import {createHash} from 'node:crypto';
import {commissioningFixture} from './commissioning-public-evidence.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function replacementRecoveryTar(entries) {
 const blocks = [];
 for (const {name,bytes,type = '0',mode = '0000600\0',link = '',prefix = ''} of entries) {
  const header = Buffer.alloc(512);
  header.write(name,0,'ascii');
  header.write(mode,100,'ascii');
  header.write(`${bytes.length.toString(8).padStart(11,'0')}\0`,124,'ascii');
  header.fill(32,148,156);
  header.write(type,156,'ascii');
  header.write(link,157,'ascii');
  header.write('ustar\x0000',257,'ascii');
  header.write(prefix,345,'ascii');
  const sum = header.reduce((count,byte)=>count+byte,0);
  header.write(`${sum.toString(8).padStart(6,'0')}\0 `,148,'ascii');
  const padding = (512 - bytes.length % 512) % 512;
  blocks.push(header,bytes,Buffer.alloc(padding));
 }
 return Buffer.concat([...blocks,Buffer.alloc(1024)]);
}

export function replacementRecoveryFixture() {
 const base = 'a'.repeat(64);
 const tools = ['apqe_layout.py','lifecycle.py','synergy_linux.py'].map(name=>({name,bytes:Buffer.from(`Synthetic tool ${name}`)}));
 const manifest = {format:'synergy-finish-replacement-v1',base_package_sha256:base,
  files:Object.fromEntries(tools.map(({name,bytes})=>[name,digest(bytes)]))};
 const entries = [...tools,{name:'recovery.json',bytes:Buffer.from(JSON.stringify(manifest))}];
 const bytes = replacementRecoveryTar(entries);
 return {bytes,base,archive:digest(bytes),manifest,entries};
}

export function replacementIntentFixture({alterCandidate=()=>{},alterIntent=()=>{}}={}) {
 const stage=commissioningFixture();
 const hashes={'bin/netbird':digest('fixture vpn binary'),'tools/netbird-client':digest('fixture vpn wrapper'),
  'evidence/host-integrations.json':digest('fixture registrations'),'evidence/vpn-synthetic.json':digest('fixture evidence'),
  'systemd/synergy-vpn.service':digest('fixture service')};
 const packageManifest={format:'synergy-universal-linux-v1',architecture:'x86_64',release_id:'fixture-new-package',
  files:{'bin/synergy-node':digest('new fixture runtime'),'bin/netbird':hashes['bin/netbird'],
   'tools/netbird-client':hashes['tools/netbird-client'],'systemd/synergy-vpn.service':hashes['systemd/synergy-vpn.service']}};
 alterCandidate(packageManifest);
 const packageBytes=JSON.stringify(packageManifest)+'\n';
 const draft={...stage.draft,release_id:packageManifest.release_id,manifest_sha256:digest(packageBytes)};
 const intent={root:'/opt/Synergy',token:`${draft.manifest_sha256}:${stage.expected}`,
  receipt:{root:'/opt/Synergy',format:'synergy-universal-linux-v1',role:'validator',network_id:'fixture-prior-network',
   chain_id:1266,node_name:'fixture-prior-node',package_sha256:digest('prior fixture manifest'),consensus_started:false,
   package_files:{'bin/synergy-node':digest('prior fixture runtime'),'bin/netbird':hashes['bin/netbird']}},vpn_sha256:hashes};
 alterIntent(intent);
 const intentBytes=JSON.stringify(intent)+'\n';
 return {draft,stage,pin:digest(intentBytes),intent,intentBytes,packageBytes};
}
