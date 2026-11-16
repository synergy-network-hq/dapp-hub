import {useState} from 'react';
import {Resource, rpc, rpcOrdinaryFeeEstimateObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {requireWalletReadScope, useWalletReadScope} from './wallet-account-read.js';
import {STS_TESTNET_GENESIS} from './wallet-address.js';

export function WalletOrdinaryFeeEstimate({endpoint, draftNwei, canCheck}) {
  const [revision, setRevision] = useState(0);
  const canRead = useWalletReadScope(draftNwei, canCheck);
  const observation = useResource(async signal => {
    if (!revision) return null;
    const checkScope = () => requireWalletReadScope(signal, canRead);
    checkScope();
    const readiness = await readProtocolObservation(async (method, params, options) => {
      checkScope();
      const value = await rpc(method, params, options);
      checkScope();
      return value;
    }, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    if (!readiness.reportedReady || readiness.chain.incarnation !== '5' ||
        readiness.chain.genesis.toLowerCase() !== STS_TESTNET_GENESIS) {
      throw Error('The fee estimate requires the supported Testnet v3 Genesis and incarnation.');
    }
    checkScope();

    let evidence;
    try {
      evidence = await rpcOrdinaryFeeEstimateObservation({endpoint: endpoint.rpc, signal, amountNwei: draftNwei});
    } catch {
      checkScope();
      throw Error('The selected RPC could not provide a supported ordinary SNRG fee estimate.');
    }
    checkScope();
    if (evidence?.state === 'unavailable') return evidence;
    const {value, chainContext} = evidence ?? {};
    if (evidence?.state !== 'estimated' || chainContext?.chainId !== readiness.chain.chainId ||
        String(chainContext.incarnation) !== readiness.chain.incarnation || chainContext.genesis !== STS_TESTNET_GENESIS ||
        value?.amountNwei !== draftNwei) throw Error('The fee estimate does not match this draft and selected RPC identity.');
    const gas = exactRpcAmount(value.gas, maxU64), gasPrice = exactRpcAmount(value.gasPriceNwei, maxU64);
    const gasFee = exactRpcAmount(value.gasFeeNwei, maxU128), amountFee = exactRpcAmount(value.amountProtocolFeeNwei, maxU128);
    const total = exactRpcAmount(value.totalFeeNwei, maxU128);
    if ([gas, gasPrice, gasFee, amountFee, total].includes(null)) throw Error('The selected RPC returned unsupported fee quantities.');
    return {state: 'estimated', gas, gasPrice, gasFee, amountFee, total, receivedAt: Date.now()};
  }, revision);

  return <section aria-label="Ordinary SNRG fee estimate">
    <p>This check sends the draft amount to the selected RPC using fixed placeholders for the sender and recipient.</p>
    <button type="button" disabled={revision > 0 && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Estimate ordinary SNRG fee again' : 'Estimate ordinary SNRG fee'}
    </button>
    {revision > 0 && canRead() && <Resource value={{...observation, reload: undefined}}>{value =>
      value.state === 'unavailable' ? <p role="status">The selected RPC does not expose ordinary SNRG fee estimates.</p> : <>
        <dl className="native-details">
          <div><dt>Estimated network fee</dt><dd>{value.total} nWei</dd></div>
          <div><dt>Estimated gas</dt><dd>{value.gas}</dd></div>
          <div><dt>Reported gas price</dt><dd>{value.gasPrice} nWei per gas</dd></div>
          <div><dt>Gas component</dt><dd>{value.gasFee} nWei</dd></div>
          <div><dt>Amount-based protocol fee</dt><dd>{value.amountFee} nWei</dd></div>
        </dl>
        <SourceAge source="Selected RPC ordinary fee estimate" updatedAt={value.receivedAt}/>
        <p>Final cost and spendability require transaction preparation and execution. Simulation and approval remain unavailable.</p>
      </>
    }</Resource>}
  </section>;
}
