import {useLayoutEffect, useRef, useState} from 'react';
import {Detail, Resource, rpc, rpcFeeScheduleObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {draftFeeSchedule} from './draft-fee-schedule.js';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis, rpcReceiptReadiness as testnetReadiness} from './rpc-receipt-observation.js';

export function WalletDraftFeeSchedule({endpoint, draftNwei, canCheck}) {
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
      if (!mounted.current || !canCheck()) throw Error('The reviewed Wallet draft changed. Review it again before checking its fee rule.');
    }
    checkScope();
    if (Number(endpoint.chainId) !== 1266) throw Error('The ordinary SNRG fee schedule requires selected chain 1266.');
    const readiness = await readProtocolObservation(async (method, params, options) => {
      checkScope();
      const result = await rpc(method, params, options);
      checkScope();
      return result;
    }, 'synergy_getReadiness', endpoint, signal, testnetReadiness);
    checkConfiguredGenesis(readiness.chain, endpoint.genesisHash);

    checkScope();
    let response;
    try {
      response = await rpcFeeScheduleObservation({endpoint: endpoint.rpc, signal});
    } catch {
      checkScope();
      throw Error('The ordinary SNRG fee schedule is unavailable from the selected RPC.');
    }
    checkScope();
    return draftFeeSchedule(response, readiness, draftNwei);
  }, revision);

  return <section aria-label="Draft SNRG fee schedule">
    <button disabled={!!revision && observation.loading} onClick={check}>
      {revision ? 'Check SNRG fee schedule again' : 'Check SNRG fee schedule'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <p>Amount-based component under the reported ordinary SNRG transfer rule <strong>{value.amountComponent} nWei</strong>.</p>
      <SourceAge source="Selected RPC fee schedule" updatedAt={value.receivedAt}/>
      <Detail data={{reportedRateBps: value.bps, minimumAmountFeeNwei: value.minAmountFee, maximumAmountFeeNwei: value.maxAmountFee,
        reportedGasPriceNweiPerGas: value.gasPrice, defaultGasPriceNweiPerGas: value.defaultGasPrice,
        gasPriceRangeNweiPerGas: `${value.minGasPrice}–${value.maxGasPrice}`, reportedBlockGasLimit: value.blockGasLimit}}/>
      <p>A total fee requires a prepared transaction and its gas usage. Spendability and simulation remain unverified.</p>
    </>}</Resource>}
  </section>;
}
