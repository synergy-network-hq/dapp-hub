import {useLayoutEffect, useMemo, useRef} from 'react';
import {chainIdNumber} from '@synergy-network/portal-native/dapp-sdk';
import {rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {checkConfiguredReceiptGenesis} from './rpc-receipt-observation.js';

export function useWalletReadScope(key, canRead) {
  const current = useRef(null);
  const scope = useMemo(() => ({}), [key]);
  useLayoutEffect(() => {
    current.current = scope;
    return () => {current.current = null;};
  }, [scope]);
  return () => current.current === scope && canRead();
}

export function requireWalletReadScope(signal, canRead) {
  signal.throwIfAborted();
  if (!canRead()) throw Error('Wallet account access changed in this Portal context.');
}

export async function checkWalletAccountEndpoint(request, endpoint, signal, canRead) {
  requireWalletReadScope(signal, canRead);
  if (Number(endpoint.chainId) !== 1266) throw Error('Select Synergy Testnet chain 1266.');
  const options = {endpoint: endpoint.rpc, signal};
  let reported;
  try {
    reported = chainIdNumber(await request('synergy_getChainId', [], options));
  } catch {
    requireWalletReadScope(signal, canRead);
    throw Error('The selected RPC chain check failed. Try again.');
  }
  requireWalletReadScope(signal, canRead);
  if (reported !== 1266) throw Error('RPC chain identity does not match Wallet chain 1266.');
  if (endpoint.genesisHash == null) return null;

  let readiness;
  try {
    readiness = rpcReadinessObservation(await request('synergy_getReadiness', [], options), reported);
  } catch {
    requireWalletReadScope(signal, canRead);
    throw Error('The selected RPC account genesis check could not be completed. Try again.');
  }
  requireWalletReadScope(signal, canRead);
  checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
  return readiness.chain;
}
