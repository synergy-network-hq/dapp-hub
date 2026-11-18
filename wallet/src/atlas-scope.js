import {atlas, isCanonicalTestnetRpc} from '@synergy-network/portal-native/dapp-sdk';

export const atlasEndpointRequired = 'Atlas Wallet observations require the canonical Synergy Testnet v3 RPC endpoint.';

export function canReadWalletAtlas(native, endpoint = native?.endpoint) {
  return !native?.recoverySuspended && native?.wallet?.connection?.chainId === 'synergy:1266' &&
    endpoint?.id === native.endpoint?.id && isCanonicalTestnetRpc(endpoint) && isCanonicalTestnetRpc(native.endpoint) &&
    native.permit('wallet', 'readWallet');
}

export async function readScopedWalletAtlas(native, path, options) {
  function checkScope() {
    options?.signal?.throwIfAborted();
    if (!canReadWalletAtlas(native)) throw Error('Atlas access is unavailable in this Wallet context.');
  }
  checkScope();
  const result = await atlas(path, options);
  checkScope();
  return result;
}
