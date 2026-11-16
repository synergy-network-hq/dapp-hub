import {useLayoutEffect, useRef, useState} from 'react';
import {Resource, rpc, rpcDraftAccountObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {isProtectedWalletAddress} from './wallet-address.js';

export function WalletDraftAccountObservation({account, endpoint, canCheck}) {
  const mounted = useRef(false);
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const observation = useResource(async signal => {
    if (!revision) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canCheck()) throw Error('The reviewed Wallet draft changed. Review it again before checking the account.');
    }
    checkScope();
    if (Number(endpoint.chainId) !== 1266 || !isProtectedWalletAddress(account)) {
      throw Error('The account observation requires a protected Wallet address on selected chain 1266.');
    }
    const readiness = await readProtocolObservation(async (method, params, options) => {
      checkScope();
      const result = await rpc(method, params, options);
      checkScope();
      return result;
    }, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    if (!readiness.reportedReady) throw Error('The selected RPC reported that its chain state is unready for an account check.');
    checkScope();

    let response;
    try {
      response = await rpcDraftAccountObservation({endpoint: endpoint.rpc, signal, owner: account});
    } catch {
      checkScope();
      throw Error('The account observation is unavailable from the selected RPC.');
    }
    checkScope();
    const {value, chainContext} = response ?? {};
    const {chain} = readiness;
    if (chainContext?.chainId !== chain.chainId || String(chainContext.incarnation) !== chain.incarnation ||
        chainContext.genesis !== chain.genesis.toLowerCase()) {
      throw Error('The account observation does not match the selected RPC readiness identity.');
    }
    const balanceNwei = exactRpcAmount(value?.balanceNwei, maxU128);
    const proposedNextNonce = exactRpcAmount(value?.proposedNextNonce, maxU64);
    if (value?.owner !== account || balanceNwei === null || proposedNextNonce === null) {
      throw Error('The selected RPC returned unsupported account evidence.');
    }
    return {balanceNwei, proposedNextNonce, receivedAt: Date.now()};
  }, revision);

  return <section aria-label="Draft account observation">
    <button disabled={!!revision && observation.loading} onClick={check}>
      {revision ? 'Check selected RPC account again' : 'Check selected RPC account'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <dl className="native-details">
        <div><dt>Reported balance</dt><dd>{amount(value.balanceNwei)} SNRG</dd></div>
        <div><dt>Exact reported balance</dt><dd>{value.balanceNwei} nWei</dd></div>
        <div><dt>Proposed next nonce</dt><dd>{value.proposedNextNonce}</dd></div>
      </dl>
      <SourceAge source="Selected RPC account response" updatedAt={value.receivedAt}/>
      <p>The reported nonce can include this endpoint’s pending transactions. Nonce reservation and spendability remain unverified.</p>
    </>}</Resource>}
  </section>;
}
