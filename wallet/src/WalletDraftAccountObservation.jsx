import {useLayoutEffect, useRef, useState} from 'react';
import {Resource, rpc, rpcDraftAccountObservation, rpcFeeScheduleObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {exactRpcAmount, maxU64, maxU128} from './rpc-unsigned.js';
import {isProtectedWalletAddress} from './wallet-address.js';
import {draftFeeSchedule} from './draft-fee-schedule.js';
import {checkDraftSpendWindow, draftDebit, draftSpendLowerBound, draftSpendReadiness, readDraftFinalizedHead} from './draft-spend.js';
import {matchesReadinessContext, readOrdinaryFeeEstimate, requirePinnedFeeEstimateReadiness} from './ordinary-fee-estimate.js';

export function WalletDraftAccountObservation({account, endpoint, canCheck, ordinaryDraftNwei}) {
  const mounted = useRef(false);
  const [request, setRequest] = useState(null);
  const check = kind => setRequest({kind});
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const observation = useResource(async signal => {
    if (!request) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canCheck()) throw Error('The reviewed Wallet draft changed. Review it again before checking the account.');
    }
    checkScope();
    if (Number(endpoint.chainId) !== 1266 || !isProtectedWalletAddress(account)) {
      throw Error('The account observation requires a protected Wallet address on selected chain 1266.');
    }
    const read = async (method, params, options) => {
      checkScope();
      const result = await rpc(method, params, options);
      checkScope();
      return result;
    };
    async function readReadiness(parse) {
      const value = await readProtocolObservation(read, 'synergy_getReadiness', endpoint, signal, parse);
      checkConfiguredReceiptGenesis(value.chain, endpoint.genesisHash);
      return value;
    }
    const includeProtocolFee = request.kind === 'protocol';
    const compareEstimate = request.kind === 'estimate';
    const readiness = await readReadiness(includeProtocolFee ? draftSpendReadiness : rpcReceiptReadiness);
    if (!readiness.reportedReady) throw Error('The selected RPC reported that its chain state is unready for an account check.');
    const options = {endpoint: endpoint.rpc, signal};

    let head, feeEstimate;
    if (compareEstimate) {
      requirePinnedFeeEstimateReadiness(readiness);
      head = await readDraftFinalizedHead(options, readiness, checkScope);
      feeEstimate = await readOrdinaryFeeEstimate(options, ordinaryDraftNwei, readiness, checkScope);
      if (feeEstimate.state === 'unavailable') throw Error('The selected RPC does not expose ordinary SNRG fee estimates.');
    }

    let protocolFee;
    if (includeProtocolFee) {
      checkScope();
      let schedule;
      try {
        schedule = await rpcFeeScheduleObservation(options);
      } catch {
        checkScope();
        throw Error('The ordinary SNRG fee schedule is unavailable from the selected RPC.');
      }
      checkScope();
      protocolFee = draftFeeSchedule(schedule, readiness, ordinaryDraftNwei).amountComponent;
    }
    checkScope();

    let response;
    try {
      response = await rpcDraftAccountObservation({...options, owner: account});
    } catch {
      checkScope();
      throw Error('The account observation is unavailable from the selected RPC.');
    }
    checkScope();
    const receivedAt = Date.now();
    const {value, chainContext} = response ?? {};
    if (!matchesReadinessContext(chainContext, readiness)) {
      throw Error('The account observation does not match the selected RPC readiness identity.');
    }
    const balanceNwei = exactRpcAmount(value?.balanceNwei, maxU128);
    const proposedNextNonce = exactRpcAmount(value?.proposedNextNonce, maxU64);
    if (value?.owner !== account || balanceNwei === null || proposedNextNonce === null) {
      throw Error('The selected RPC returned unsupported account evidence.');
    }
    let spend = null, estimatedDebit = null;
    if (includeProtocolFee) {
      const after = await readReadiness(draftSpendReadiness);
      checkScope();
      checkDraftSpendWindow(readiness, after);
      spend = {protocolFee, height: readiness.height, ...draftSpendLowerBound(ordinaryDraftNwei, protocolFee, balanceNwei)};
    }
    if (compareEstimate) {
      const after = await readDraftFinalizedHead(options, readiness, checkScope);
      if (after.height !== head.height || after.hash !== head.hash) {
        throw Error('The reported finalized head changed during the check. Check the draft again.');
      }
      estimatedDebit = {fee: feeEstimate.total, height: head.height, ...draftDebit(ordinaryDraftNwei, feeEstimate.total, balanceNwei)};
    }
    return {balanceNwei, proposedNextNonce, spend, estimatedDebit, receivedAt};
  }, request);

  return <section aria-label="Draft account observation">
    <div className="native-actions">
      <button disabled={!!request && observation.loading} onClick={() => check('account')}>
        {request ? 'Check selected RPC account again' : 'Check selected RPC account'}
      </button>
      {ordinaryDraftNwei != null && <button disabled={!!request && observation.loading} onClick={() => check('protocol')}>
        Check draft amount and protocol fee
      </button>}
      {ordinaryDraftNwei != null && <button disabled={!!request && observation.loading} onClick={() => check('estimate')}>
        Check estimated total against reported balance
      </button>}
    </div>
    {ordinaryDraftNwei != null && <p>The estimated total check sends the draft amount and your approved public account to the selected RPC in separate requests.</p>}
    {request && canCheck() && <Resource value={{...observation, reload: undefined}}>{value => <>
      <dl className="native-details">
        <div><dt>Reported balance</dt><dd>{amount(value.balanceNwei)} SNRG</dd></div>
        <div><dt>Exact reported balance</dt><dd>{value.balanceNwei} nWei</dd></div>
        <div><dt>Proposed next nonce</dt><dd>{value.proposedNextNonce}</dd></div>
      </dl>
      <SourceAge source="Selected RPC account response" updatedAt={value.receivedAt}/>
      <p>The reported nonce can include this endpoint’s pending transactions. Nonce reservation and spendability remain unverified.</p>
      {value.spend && <>
        <dl className="native-details">
          <div><dt>Amount-based protocol fee</dt><dd>{value.spend.protocolFee} nWei</dd></div>
          <div><dt>Transfer amount plus protocol fee</dt><dd>{value.spend.minimum} nWei</dd></div>
          <div><dt>Reported readiness height before and after the check</dt><dd>{value.spend.height}</dd></div>
        </dl>
        <p role="status">{value.spend.shortfall === null ?
          'The reported balance covers this lower bound.' :
          'The reported balance falls short of this lower bound by ' + value.spend.shortfall + ' nWei.'}</p>
        <p>Total cost requires preparation and gas usage. The account and fee responses were read separately.</p>
      </>}
      {value.estimatedDebit && <>
        <dl className="native-details">
          <div><dt>Estimated network fee</dt><dd>{value.estimatedDebit.fee} nWei</dd></div>
          <div><dt>Draft amount plus estimated fee</dt><dd>{value.estimatedDebit.total} nWei</dd></div>
          <div><dt>Reported finalized height before and after the check</dt><dd>{value.estimatedDebit.height}</dd></div>
        </dl>
        <p role="status">{value.estimatedDebit.shortfall === null
          ? 'The reported balance covers this estimated total.'
          : 'The reported balance falls short of this estimated total by ' + value.estimatedDebit.shortfall + ' nWei.'}</p>
        <p>Balance and fees are RPC observations. Final cost, fee reserve and spendability require transaction preparation.</p>
      </>}
    </>}</Resource>}
  </section>;
}
