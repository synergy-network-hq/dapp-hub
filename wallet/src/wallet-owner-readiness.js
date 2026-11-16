import {useLayoutEffect, useRef, useState} from 'react';
import {rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis, rpcReceiptReadiness as testnetReadiness} from './rpc-receipt-observation.js';
import {isLegacyStsWalletAddress, isNftWalletOwner, isProtectedWalletAddress, STS_TESTNET_GENESIS} from './wallet-address.js';

async function readWalletOwnerReadiness(endpoint, signal, checkScope) {
  checkScope();
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

export async function readProtectedWalletReadiness(account, endpoint, signal, checkScope) {
  if (!isProtectedWalletAddress(account) || Number(endpoint.chainId) !== 1266) {
    throw Error('A protected Wallet account on chain 1266 is required.');
  }
  return readWalletOwnerReadiness(endpoint, signal, checkScope);
}

export async function readNftWalletReadiness(account, endpoint, signal, checkScope) {
  if (!isNftWalletOwner(account) || Number(endpoint.chainId) !== 1266) {
    throw Error('A supported Wallet account on chain 1266 is required.');
  }
  const readiness = await readWalletOwnerReadiness(endpoint, signal, checkScope);
  if (isLegacyStsWalletAddress(account) && readiness.chain.genesis.toLowerCase() !== STS_TESTNET_GENESIS) {
    throw Error('This legacy Wallet address requires the pinned Testnet STS genesis.');
  }
  return readiness;
}

export function useWalletOwnerSnapshot({account, endpoint, canRead, read, parse, limit, unavailable,
  supportsOwner = isProtectedWalletAddress, readReadiness = readProtectedWalletReadiness}) {
  const [request, setRequest] = useState(0);
  const mounted = useRef(false);
  const activeRead = useRef(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRead.current?.abort();
    };
  }, []);

  const observation = useResource(async resourceSignal => {
    if (!request) return null;
    const controller = new AbortController();
    activeRead.current = controller;
    const {signal} = controller;
    const cancel = () => controller.abort(resourceSignal.reason);
    resourceSignal.addEventListener('abort', cancel, {once: true});
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canRead()) throw Error('The Wallet owner context changed.');
    }
    try {
      const readiness = await readReadiness(account, endpoint, signal, checkScope);
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
    } finally {
      resourceSignal.removeEventListener('abort', cancel);
      if (activeRead.current === controller) activeRead.current = null;
    }
  }, request);

  return {observation, requested: request > 0, check: () => setRequest(value => value + 1),
    supportedAccount: supportsOwner(account)};
}
