import {useLayoutEffect, useRef, useState} from 'react';
import {rpc, rpcGasPriceObservation, Resource, useResource, Detail} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {readProtocolObservation, feeMarketObservation, unsignedObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis, rpcReceiptReadiness as testnetReadiness} from './rpc-receipt-observation.js';

export function WalletFeeMarket({endpoint, canRead}) {
  const mounted = useRef(false);
  const [legacyRevision, setLegacyRevision] = useState(0);
  const checkLegacy = () => setLegacyRevision(value => value + 1);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  function checkScope(signal) {
    signal.throwIfAborted();
    if (!mounted.current || !canRead()) throw Error('The Wallet fee context changed.');
  }

  async function readSelectedRpc(method, params, options) {
    checkScope(options.signal);
    const result = await rpc(method, params, options);
    checkScope(options.signal);
    return result;
  }

  const observation = useResource(signal => {
    if (Number(endpoint.chainId) !== 1266) throw Error('Fee observations require selected chain 1266.');
    return readProtocolObservation(readSelectedRpc, 'synergy_getFeeMarket', endpoint, signal, (value, chain) => {
      const fee = feeMarketObservation(value, chain);
      checkConfiguredGenesis(fee.chain, endpoint.genesisHash);
      return fee;
    });
  }, null);

  const legacy = useResource(async signal => {
    if (!legacyRevision) return null;
    if (Number(endpoint.chainId) !== 1266) throw Error('Fee observations require selected chain 1266.');
    const readiness = await readProtocolObservation(readSelectedRpc, 'synergy_getReadiness', endpoint, signal, testnetReadiness);
    checkConfiguredGenesis(readiness.chain, endpoint.genesisHash);
    checkScope(signal);

    let response;
    try {
      response = await rpcGasPriceObservation({endpoint: endpoint.rpc, signal});
    } catch {
      checkScope(signal);
      throw Error('The legacy gas price is unavailable from the selected RPC.');
    }
    checkScope(signal);
    const {value, chainContext} = response;
    const checked = readiness.chain;
    if (chainContext?.chainId !== checked.chainId || String(chainContext.incarnation) !== checked.incarnation ||
        chainContext.genesis !== checked.genesis.toLowerCase()) {
      throw Error('The legacy gas-price response does not match the selected RPC readiness identity.');
    }
    return {gasPriceNwei: unsignedObservation(value), receivedAt: Date.now(), chain: {...chainContext, network: checked.network}};
  }, legacyRevision);

  return <>
    <h3>RPC fee-market observation</h3>
    <p>Reported gas-unit prices from the selected RPC. A transaction fee estimate and simulation require the supported transaction contract.</p>
    <Resource value={observation}>{value => <>
      <SourceAge source="Selected RPC fee-market read" updatedAt={value.receivedAt}/>
      <Detail data={{reportedEnabled: value.enabled, currentBlock: value.currentBlock, currentBaseFeeNweiPerGas: value.currentBaseFeeNwei,
        nextBlock: value.nextBlock, nextBaseFeeNweiPerGas: value.nextBaseFeeNwei, nextPqGasPriceNwei: value.nextPqGasPrice,
        pqMultiplier: value.pqMultiplier, reportedNetwork: value.chain.network, reportedIncarnation: value.chain.incarnation,
        reportedGenesis: value.chain.genesis}}/>
      <p>The chain context is reported by this endpoint.</p>
    </>}</Resource>
    <button disabled={observation.loading} onClick={observation.reload}>Refresh fee-market observation</button>

    <section aria-label="Legacy RPC gas price observation">
      <button disabled={!!legacyRevision && legacy.loading} onClick={checkLegacy}>
        {legacyRevision ? 'Check legacy RPC gas price again' : 'Check legacy RPC gas price'}
      </button>
      {!!legacyRevision && <Resource value={{...legacy, reload: undefined}}>{value => <>
        <p>Reported legacy gas price <strong>{value.gasPriceNwei} nWei per gas</strong> (SNRG).</p>
        <SourceAge source="Selected RPC legacy gas price" updatedAt={value.receivedAt}/>
        <Detail data={{readinessNetwork: value.chain.network, reportedChain: value.chain.chainId,
          reportedIncarnation: value.chain.incarnation, reportedGenesis: value.chain.genesis}}/>
        <p>The selected endpoint reported matching chain identities in both reads. A total fee requires a transaction-specific gas estimate.</p>
      </>}</Resource>}
    </section>
  </>;
}
