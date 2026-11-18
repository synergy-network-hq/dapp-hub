// Spark fe1d099 test/nft-sales.test.js exact operation vectors and the
// marketplace/market-sales.js downloaded file encoding.
import {Buffer} from 'node:buffer';

export const saleNft = 'synn11na83utlt390nreuafc70h69yu077p8fumh0c5g';
export const saleSeller = 'synw1ptau5vh8eqx8yvjfukpq2yas6fxvay0z7new';
export const saleBuyer = 'synw1zp7cxme7xm838663yrd43lxtxlw0ck90z4am';
export const saleListing = 'a'.repeat(64);
export const salePriceNwei = '340282366920938463463374607431768211455';
export const saleExpiry = 5451230;
const prefix = 'synergy-sts-v1:{"version":1,"chain_id":1266,"network":"synergy-testnet-v3","tx":';
export const salePayloads = {
  list: `${prefix}{"op":"list_nft_for_snrg","data":{"nft_id":"${saleNft}","price_nwei":${salePriceNwei},"expires_at_height":${saleExpiry}}}}`,
  cancel: `${prefix}{"op":"cancel_nft_sale","data":{"nft_id":"${saleNft}","listing_id":"${saleListing}"}}}`,
  buy: `${prefix}{"op":"buy_nft_for_snrg","data":{"nft_id":"${saleNft}","listing_id":"${saleListing}","expected_seller":"${saleSeller}","price_nwei":${salePriceNwei}}}}`,
};

// Synthetic public-byte carriers, with fake signatures and keys. IDs were
// independently generated using Atlas 36b7ef9 txHash.mjs, Wallet 134cfa2
// carrier framing, nonce u64::MAX-1 and gas price 9007199254740993.
export const saleReceiptGoldens = {
  list: {sender: saleSeller, payloadSha256: '6cbd370adb3d8ee5ed69557609def32d7c0254a37774e17bf3f54564f17b303c',
    hash: 'syntxn-df3916a0f52295ddb69c2a50f7e1668d0bb47109918b4f7d339c901dcc610397'},
  cancel: {sender: saleSeller, payloadSha256: '44479654663e1e099943b374c06f09cc20a06a9133ba510104034d499012c578',
    hash: 'syntxn-8cdaae5fb10ccf135b4450d3d01fc956738104eccdba32bfa87ae71bbdde05cd'},
  buy: {sender: saleBuyer, payloadSha256: 'a9f1bbc4c3b8f09ea33b7d7949e7b2b93ca29efcfb11115e64e543ad8596523c',
    hash: 'syntxn-8da396fc44c1fc841a4b3033509dd2f523a71b2a0b50668ae46cb4c8bdb721f4'},
};

export function saleDraftText(action, payload = salePayloads[action], changes = {}) {
  return JSON.stringify({schemaVersion: 1, kind: 'spark-sts-nft-sale-draft', chainId: 1266, network: 'synergy-testnet-v3',
    sender: action === 'buy' ? saleBuyer : saleSeller, payload_hex: Buffer.from(payload).toString('hex'),
    status: 'unsigned', transactionHash: null, ...changes}, null, 2) + '\n';
}
