import {rpc} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis, rpcReceiptReadiness as testnetReadiness} from './rpc-receipt-observation.js';
import {isProtectedWalletAddress} from './wallet-address.js';

export async function readProtectedWalletReadiness(account, endpoint, signal, checkScope) {
  checkScope();
  if (!isProtectedWalletAddress(account) || Number(endpoint.chainId) !== 1266) {
    throw Error('A protected Wallet account on chain 1266 is required.');
  }

  const readiness = await readProtocolObservation(async (method, params, options) => {
    checkScope();
    const value = await rpc(method, params, options);
    checkScope();
    return value;
  }, 'synergy_getReadiness', endpoint, signal, testnetReadiness);
  checkConfiguredGenesis(readiness.chain, endpoint.genesisHash);
  const incarnation = Number(readiness.chain.incarnation);
  if (!Number.isSafeInteger(incarnation) || incarnation <= 0) {
    throw Error('The selected RPC did not report a supported Testnet incarnation.');
  }
  return readiness;
}
