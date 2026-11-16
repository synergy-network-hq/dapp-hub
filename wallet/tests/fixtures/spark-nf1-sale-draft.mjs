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

export function saleDraftText(action, payload = salePayloads[action], changes = {}) {
  return JSON.stringify({schemaVersion: 1, kind: 'spark-sts-nft-sale-draft', chainId: 1266, network: 'synergy-testnet-v3',
    sender: action === 'buy' ? saleBuyer : saleSeller, payload_hex: Buffer.from(payload).toString('hex'),
    status: 'unsigned', transactionHash: null, ...changes}, null, 2) + '\n';
}
