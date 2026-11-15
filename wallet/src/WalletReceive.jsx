import {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {Card} from '@synergy-network/portal-native/dapp-sdk';
import {isProtectedWalletAddress} from './wallet-address.js';

export function Receive({account, endpoint, generateQr = QRCode.toDataURL}) {
  const chainId = Number(endpoint?.chainId);
  const networkName = typeof endpoint?.name === 'string' && endpoint.name.trim() ? endpoint.name : null;
  const hasNetwork = !!networkName && Number.isSafeInteger(chainId) && chainId > 0;
  const supportedNetwork = hasNetwork && chainId === 1266;
  const canReceive = supportedNetwork && isProtectedWalletAddress(account);
  const key = JSON.stringify([account, endpoint?.id, endpoint?.networkKey, endpoint?.rpc, networkName, chainId]);
  const scope = useRef({key});
  if (scope.current.key !== key) scope.current = {key};
  const current = scope.current;
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  const [pendingCopy, setPendingCopy] = useState(null);
  const copyInProgress = useRef(false);

  useEffect(() => {
    if (!canReceive) return;
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
  }, [account, canReceive, current, generateQr]);

  async function copy() {
    if (!canReceive || scope.current !== current || copyInProgress.current) return;
    copyInProgress.current = true;
    setPendingCopy(current);
    setStatus(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(account);
      if (scope.current === current) setStatus({scope: current, message: 'Address copied.'});
    } catch {
      if (scope.current === current) setStatus({scope: current, message: 'Copy unavailable. Select the public address above to copy it.'});
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
        <div className="wallet-receive-layout">
          <div>{image ? <img className="receive-qr" src={image} alt="Public account receive QR"/> :
            error ? <p role="alert">{error}</p> : <div className="receive-qr-placeholder" role="status">Generating address QR…</div>}</div>
          <div>
            <h3>Public receive address</h3>
            <p className="account-address" tabIndex={0}>{account}</p>
            <p>Confirm the full address and intended network with the sender. This QR contains only your public address. Chain ID alone does not verify a network incarnation.</p>
            <button disabled={!!pendingCopy} onClick={copy}>{copyLabel}</button>
            <p role="status">{status?.scope === current ? status.message : ''}</p>
          </div>
        </div>}
  </Card>;
}
