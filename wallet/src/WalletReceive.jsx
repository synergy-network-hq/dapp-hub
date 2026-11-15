import {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {Card, chainIdNumber, Detail, Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {isProtectedWalletAddress} from './wallet-address.js';
import {checkConfiguredReceiptGenesis as checkConfiguredGenesis} from './rpc-receipt-observation.js';

export function Receive({account, endpoint, consentSession, canUse = () => true, readRpc, generateQr = QRCode.toDataURL}) {
  const chainId = Number(endpoint?.chainId);
  const networkName = typeof endpoint?.name === 'string' && endpoint.name.trim() ? endpoint.name : null;
  const hasNetwork = !!networkName && Number.isSafeInteger(chainId) && chainId > 0;
  const supportedNetwork = hasNetwork && chainId === 1266;
  const canReceive = supportedNetwork && isProtectedWalletAddress(account) && canUse();
  const key = JSON.stringify([account, endpoint?.id, endpoint?.networkKey, endpoint?.rpc, networkName, chainId,
    endpoint?.genesisHash, consentSession, canReceive]);
  const scope = useRef({key});
  if (scope.current.key !== key) scope.current = {key};
  const current = scope.current;
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  const [pendingCopy, setPendingCopy] = useState(null);
  const copyInProgress = useRef(false);
  const [checkRequest, setCheckRequest] = useState(null);
  const activeCheck = checkRequest?.scope === current ? checkRequest : null;
  const canCheck = canReceive && typeof readRpc === 'function' && typeof endpoint.rpc === 'string' && !!endpoint.rpc;

  const network = useResource(async signal => {
    if (!activeCheck) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (scope.current !== current || !canUse()) throw Error('The Wallet receive context changed.');
    }

    checkScope();
    const options = {endpoint: endpoint.rpc, signal};
    let reportedChain;
    try {
      reportedChain = chainIdNumber(await readRpc('synergy_getChainId', [], options));
    } catch {
      throw Error('The selected RPC chain ID is unavailable.');
    }
    checkScope();
    if (reportedChain !== chainId) {
      return {kind: 'mismatch', message: `The selected RPC reported chain ${reportedChain}. Receive expects chain ${chainId}.`};
    }

    let readiness;
    try {
      const reported = await readRpc('synergy_getReadiness', [], options);
      readiness = rpcReadinessObservation(reported, reported?.chain?.chain_id);
      if (!/^[a-f0-9]{64}$/i.test(readiness.chain.genesis) || readiness.chain.genesis.length !== 64) throw Error('Unsupported genesis hash');
    } catch {
      checkScope();
      return {kind: 'chain-only', checkedAt: new Date().toISOString()};
    }
    checkScope();
    if (readiness.chain.chainId !== chainId) {
      return {kind: 'mismatch', message: `The selected RPC readiness report identifies chain ${readiness.chain.chainId}. Receive expects chain ${chainId}.`};
    }
    if (readiness.chain.network !== 'synergy-testnet-v3') {
      return {kind: 'mismatch', message: 'The selected RPC reported a network different from Synergy Testnet v3.'};
    }
    try {
      checkConfiguredGenesis(readiness.chain, endpoint.genesisHash);
    } catch (failure) {
      return {kind: 'mismatch', message: failure.message};
    }
    return {kind: 'matched', chain: readiness.chain, checkedAt: new Date().toISOString()};
  }, activeCheck);

  const observation = network.data;
  const conflict = observation?.kind === 'mismatch' ? observation.message :
    observation?.kind === 'matched' ? null : activeCheck?.priorConflict;
  const canShare = canReceive && !conflict;
  const sharing = useRef(false);
  sharing.current = canShare;

  function checkNetwork() {
    if (!canCheck || !canUse() || scope.current !== current) return;
    setStatus(null);
    setCheckRequest({scope: current, priorConflict: conflict});
  }

  useEffect(() => {
    if (!canShare) return;
    let active = true;
    setQr(null);
    Promise.resolve().then(() => {
      if (active) return generateQr(account, {width: 220, margin: 2});
    }).then(url => {
      if (active) setQr({scope: current, url});
    }).catch(() => {
      if (active) setQr({scope: current, error: 'QR generation unavailable. Use the public address below.'});
    });
    return () => {active = false;};
  }, [account, canShare, current, generateQr]);

  async function copy() {
    if (!canShare || !canUse() || scope.current !== current || copyInProgress.current) return;
    copyInProgress.current = true;
    setPendingCopy(current);
    setStatus(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(account);
      if (scope.current === current && sharing.current && canUse()) setStatus({scope: current, message: 'Address copied.'});
    } catch {
      if (scope.current === current && sharing.current && canUse()) setStatus({scope: current, message: 'Copy unavailable. Select the public address above to copy it.'});
    } finally {
      copyInProgress.current = false;
      setPendingCopy(null);
    }
  }

  const image = qr?.scope === current ? qr.url : null;
  const error = qr?.scope === current ? qr.error : null;
  const copyLabel = pendingCopy === current ? 'Copying address…' : pendingCopy ? 'Waiting for clipboard…' : 'Copy public address';
  return <Card title="Receive SNRG">
    <p>{hasNetwork ? `Selected network · ${networkName} · Chain ${chainId}` : 'Selected network unavailable'}</p>
    {!supportedNetwork ? <p role="status">Select a Synergy Testnet endpoint on chain 1266 to use Receive.</p> :
      !canReceive ? <p role="status">This connection does not provide a current Synergy Wallet receive address. Open Synergy Wallet to confirm your receive address.</p> :
        <>
          {canCheck && <section aria-label="Receive network observation">
            <button disabled={!!activeCheck && network.loading} onClick={checkNetwork}>
              {activeCheck ? 'Check selected network again' : 'Check selected network'}
            </button>
            {activeCheck && <Resource value={{...network, reload: undefined}}>{value => <>
              {value.kind === 'matched' && <Detail data={{reportedNetwork: value.chain.network,
                reportedGenesisHash: value.chain.genesis, reportedIncarnation: value.chain.incarnation}}/>}
              {value.kind === 'chain-only' && <p role="status">The RPC reported chain {chainId}. Network identity is unavailable.</p>}
              {value.checkedAt && <p>Network checked <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>}
            </>}</Resource>}
            {conflict && <p role="alert">{conflict} QR and copy are unavailable until the endpoint reports the expected network.</p>}
          </section>}
          <div className="wallet-receive-layout">
            {canShare && <div>{image ? <img className="receive-qr" src={image} alt="Public account receive QR"/> :
              error ? <p role="alert">{error}</p> : <div className="receive-qr-placeholder" role="status">Generating address QR…</div>}</div>}
            <div>
              <h3>Public receive address</h3>
              <p className="account-address" tabIndex={0}>{account}</p>
              <p>Confirm the full address and intended network with the sender. This QR contains only your public address. RPC observations do not verify the network incarnation.</p>
              <button disabled={!canShare || !!pendingCopy} onClick={copy}>{copyLabel}</button>
              <p role="status">{canShare && status?.scope === current ? status.message : ''}</p>
            </div>
          </div>
        </>}
  </Card>;
}
