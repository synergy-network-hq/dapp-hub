import {useState} from 'react';
import {Resource, rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {requireWalletReadScope, useWalletReadScope} from './wallet-account-read.js';
import {readOrdinaryFeeEstimate, requirePinnedFeeEstimateReadiness} from './ordinary-fee-estimate.js';

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
    requirePinnedFeeEstimateReadiness(readiness);
    return readOrdinaryFeeEstimate({endpoint: endpoint.rpc, signal}, draftNwei, readiness, checkScope);
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
