// Owner-generated synthetic vectors from Spark fe1d099 src/sts.js and src/main.js.
import {Buffer} from 'node:buffer';

export const launchCreator = 'synw1zp7cxme7xm838663yrd43lxtxlw0ck90z4am';
export const launchName = 'Spark Proof 717';
export const launchSymbol = 'SPK717';
export const launchMetadataHash = '5916c2a5247fa0bf470faf00baa999ad34e2e7b5fffcd2aede3e8f38f5081486';
export const launchMetadataUri = 'ipfs://bafyspark/metadata.json';
export const launchImageUri = 'ar://testasset';
export const launchImageHash = 'c'.repeat(64);
export const launchCliSupply = '1000000000000';
export const launchWideSupply = '340282366920938463463374607431768211455';
export const launchWideNonce = '18446744073709551615';
export const launchGoldens = {
  cli: {size: 4128, expectedTokenId: 'synb11rqs8twqvm7fn29d8s94djn4zzwwfnswrargxn3',
    sha256: '37934db493a0447e3bb428b5e5cc09472300efb30a8202de5a1aaed53acabb05',
    payloadSha256: '1204e76a16c5249992f5c07cf408fdd23648ad63a672519a3068ffb7deacb6e5'},
  wide: {size: 4146, expectedTokenId: 'synb11u0slku3deuhvtqx38ajlc70x9wc9cw7npfsewa',
    sha256: '0ea6d5bd2a9780ccb77e9e4539999ed131e6cae7e3876aab049fc2945b609e54',
    payloadSha256: '6c289b793b027cf5b04a81b82ea1229d66c50e4072a2fb8fa9b77d58db73d1b1',
    identityMetadataHash: 'df26db5b55538d4dcc9d5a1cc7413ced344e05d834e016d27d94bf12bd83189b'},
  references: {size: 4644, expectedTokenId: 'synb11rqs8twqvm7fn29d8s94djn4zzwwfnswrargxn3',
    sha256: '586974f41d019028a672a474cad3fae95bf4902ceaa336961f5cf60951325b36',
    payloadSha256: '63c961ffd16629bcabdb6fe349d3a0ff51cf59f282c7706f4fee96f76162cd14'},
};

export function launchDraftText(vector = 'cli', modifyPayload = payload => payload, changes = {}) {
  const wide = vector === 'wide', references = vector === 'references';
  const creator_nonce = wide ? launchWideNonce : '717001';
  const supply = wide ? launchWideSupply : launchCliSupply;
  const data = {class: 'b1', creator: launchCreator, creator_nonce, name: launchName, symbol: launchSymbol,
    decimals: 9, initial_supply: supply, max_supply: supply, mint_authority: null, metadata_authority: null,
    metadata_uri: references ? launchMetadataUri : null, metadata_hash: wide ? null : launchMetadataHash,
    metadata_mutable: false, image_uri: references ? launchImageUri : null, image_hash: references ? launchImageHash : null,
    flags: {can_freeze: false, can_pause: false, can_clawback: false, can_denylist: false, can_allowlist: false,
      can_update_metadata: false, requires_transfer_approval: false}, policies: [], created_at: 1784310000};
  const network = 'synergy-testnet-v3';
  const payloadJson = modifyPayload(JSON.stringify({version: 1, chain_id: 1266, network, tx: {op: 'create_fungible', data}})
    .replace(/"(creator_nonce|initial_supply|max_supply)":"([0-9]+)"/g, '"$1":$2'));
  const payloadHex = Buffer.from('synergy-sts-v1:' + payloadJson).toString('hex');
  return JSON.stringify({schemaVersion: 1, kind: 'spark-sts-launch-draft', chainId: 1266, network,
    creatorAddress: launchCreator, expectedTokenId: launchGoldens[vector].expectedTokenId,
    payloadJson, payloadHex, payload_hex: payloadHex, status: 'unsigned', transactionHash: null, ...changes}, null, 2) + '\n';
}
