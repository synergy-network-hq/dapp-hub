import {useLayoutEffect, useRef, useState} from 'react';
import {Resource, rpc, rpcEtdagTransferStatusObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';

const activationReports = new Map([
  ['FINALIZED_ACTIVATION_PERMIT_REQUIRED', 'A finalized activation permit is required.'],
  ['ACTIVE_CERTIFIED_INPUT_INGRESS', 'Certified input ingress is reported active.'],
]);

export function WalletEtdagTransferStatus({endpoint, canCheck}) {
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
      if (!mounted.current || !canCheck()) throw Error('Wallet transfer status is unavailable in this Portal context.');
    }
    checkScope();
    if (Number(endpoint.chainId) !== 1266) throw Error('The transfer status check requires selected chain 1266.');
    const readiness = await readProtocolObservation(async (method, params, options) => {
      checkScope();
      const result = await rpc(method, params, options);
      checkScope();
      return result;
    }, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    checkScope();

    let response;
    try {
      response = await rpcEtdagTransferStatusObservation({endpoint: endpoint.rpc, signal});
    } catch {
      checkScope();
      throw Error('Encrypted transfer status is unavailable from the selected RPC.');
    }
    checkScope();
    const {value, chainContext} = response ?? {};
    const {chain} = readiness;
    if (chainContext?.chainId !== chain.chainId || String(chainContext.incarnation) !== chain.incarnation ||
        chainContext.genesis !== chain.genesis.toLowerCase()) {
      throw Error('The transfer status response does not match the selected RPC readiness identity.');
    }
    const activationReport = activationReports.get(value?.activationStatus);
    if (!activationReport || value.profileId !== 'POSY-ETDAG-v2.2-rc1' ||
        value.submissionStatus !== 'VALIDATOR_DISTRIBUTED_ADMISSION_SCHEDULER_REQUIRED') {
      throw Error('The selected RPC returned unsupported ETDAG transfer status.');
    }
    return {activationReport, profileId: value.profileId, receivedAt: Date.now()};
  }, revision);

  return <section aria-label="Encrypted transfer status">
    <button disabled={!!revision && observation.loading} onClick={check}>
      {revision ? 'Check encrypted transfer status again' : 'Check encrypted transfer status'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <dl className="native-details">
        <div><dt>Reported network profile</dt><dd>{value.profileId}</dd></div>
        <div><dt>Activation</dt><dd>{value.activationReport}</dd></div>
        <div><dt>Encrypted submission</dt><dd>Unavailable. The validator-distributed admission scheduler is required.</dd></div>
        <div><dt>Plaintext transfer and fallback</dt><dd>Disabled by the reported network policy.</dd></div>
      </dl>
      <SourceAge source="Selected RPC transfer status" updatedAt={value.receivedAt}/>
    </>}</Resource>}
  </section>;
}
