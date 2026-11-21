import {createHash} from 'node:crypto';

export const vpnFixturePeerId = 'fixture-peer-opaque-identifier';
export const vpnBindingRecord = {
 peer_id:vpnFixturePeerId,
 wireguard_public_key:'fixture-wireguard-public-key',
 ip:'100.80.0.12',
 hostname:'fixture-managed-host',
 peer_name:'fixture-netbird-peer',
 server_binding_verified:true,
 binding_method:'fresh peer ID + one-off enrollment evidence + unique peer name + native IP',
 one_off_usage_evidence:'management key counter',
 management_public_key_exposed:false,
};
export const vpnRetirementRecord = {peer_id:vpnFixturePeerId,retired:true,absence_verified:true};

export function vpnRecordFile(raw) {
 const bytes=typeof raw==='string' ? new TextEncoder().encode(raw) : Uint8Array.from(raw);
 return {
  bytes,
  size:bytes.byteLength,
  pin:createHash('sha256').update(bytes).digest('hex'),
  arrayBuffer:async()=>Uint8Array.from(bytes).buffer,
 };
}
