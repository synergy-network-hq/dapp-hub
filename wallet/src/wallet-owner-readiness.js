import {useLayoutEffect, useRef, useState} from 'react';
import {rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis, rpcReceiptReadiness as testnetReadiness} from './rpc-receipt-observation.js';
import {isProtectedWalletAddress} from './wallet-address.js';

async function readProtectedWalletReadiness(account, endpoint, signal, checkScope) {
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

export function useWalletOwnerSnapshot({account, endpoint, canRead, read, parse, limit, unavailable}) {
  const [request, setRequest] = useState(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const observation = useResource(async signal => {
    if (!request) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canRead()) throw Error('The Wallet owner context changed.');
    }
    const readiness = await readProtectedWalletReadiness(account, endpoint, signal, checkScope);
    checkScope();
    let response;
    try {
      response = await read({endpoint: endpoint.rpc, signal, owner: account, limit});
    } catch {
      checkScope();
      throw Error(unavailable);
    }
    checkScope();
    return parse(response, account, readiness);
  }, request);

  return {observation, requested: request > 0, check: () => setRequest(value => value + 1),
    supportedAccount: isProtectedWalletAddress(account)};
}
