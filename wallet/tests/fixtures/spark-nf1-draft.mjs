// The published Wallet inspector's v20 macOS-arm64 payload vector, wrapped in
// the exact Spark fe1d099 prepareNftMint export order and serializer.
export const mintSender = 'synw1ylcxlewqxgnz76tkqycp8julzgp9jg0ppacu';
export const mintCollection = 'synn11vlvh33fjfqzek8kagaltcsfsqxmw7wyke88y57';
export const mintTimestamp = 1794761001;
export const mintPayload = 'synergy-sts-v1:{"version":1,"chain_id":1266,"network":"synergy-testnet-v3","tx":{"op":"mint_nft","data":{"collection_id":"synn11vlvh33fjfqzek8kagaltcsfsqxmw7wyke88y57","to":"synw1ylcxlewqxgnz76tkqycp8julzgp9jg0ppacu","metadata_uri":null,"metadata_hash":null,"metadata_mutable":false,"transferable":null,"requires_issuer_approval":null,"expires_at":null,"minted_at":1794761001}}}';
export const mintFileSha256 = '70292ed86ae10b7f70b2f031367ad493d9d1d0d73710fb53b26fed3c086c18e5';

export function mintDraftText(payload = mintPayload, changes = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'spark-sts-nft-mint-draft',
    chainId: 1266,
    network: 'synergy-testnet-v3',
    sender: mintSender,
    payload_hex: Buffer.from(payload).toString('hex'),
    status: 'unsigned',
    transactionHash: null,
    ...changes,
  }, null, 2) + '\n';
}
