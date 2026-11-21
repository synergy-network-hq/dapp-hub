import {useState} from 'react';
import {Resource, useNative, useResource} from '@synergy-network/portal-native/dapp-sdk';

const statuses = {
  approved: 'The relay reported approval for this connection.',
  checking: 'Portal already has a relay check in progress.',
  unavailable: 'The relay could not confirm this connection.',
  'locally-revoked': 'Portal reported a change to the local approval.',
  disconnected: 'The mobile adapter reported a disconnected session.',
};

function checkedStatus(value) {
  const status = value?.status;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof status !== 'string' || !Object.hasOwn(statuses, status)) {
    throw Error('The mobile adapter returned an unsupported relay status.');
  }
  if (status !== 'approved' && status !== 'unavailable') return {status, checkedAt: null};
  if (!Number.isSafeInteger(value.checkedAt) || value.checkedAt <= 0 || value.checkedAt > 8_640_000_000_000_000) {
    throw Error('The mobile adapter returned an unsupported check time.');
  }
  return {status, checkedAt: new Date(value.checkedAt).toISOString()};
}

function RelayCheck({provider, isCurrent}) {
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision) return null;
    signal.throwIfAborted();
    if (!isCurrent()) throw Error('The Wallet connection changed. Review the current connection.');
    let value;
    let failed = false;
    try {
      value = await provider.request({method: 'portal_checkPhoneConnection'});
    } catch {
      failed = true;
    }
    signal.throwIfAborted();
    if (!isCurrent()) throw Error('The Wallet connection changed. Review the current connection.');
    if (failed) throw Error('The Portal relay check could not be completed. Try again.');
    return checkedStatus(value);
  }, revision);

  return <section aria-label="Mobile Wallet relay observation">
    <h3>Phone connection status</h3>
    <p>Portal checks the current relay approval. A changed approval can disconnect Wallet locally. The result is a relay observation.</p>
    {!revision ? <button onClick={check}>Check phone connection status</button> :
      <Resource value={{...observation, reload: check}}>{value => <>
        <p role="status">{statuses[value.status]}</p>
        {value.checkedAt && <p>Checked at <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>}
        <button onClick={check}>Check phone connection again</button>
      </>}</Resource>}
  </section>;
}

export function WalletRelayStatus({connection}) {
  const n = useNative();
  const endpoint = n?.endpoint;
  const revision = n?.wallet?.connectionRevision;
  const provider = connection.provider;
  if (!n?.walletConsentSession || !Number.isSafeInteger(revision) ||
      connection.walletId !== 'synergy-mobile' || connection.chainId !== 'synergy:1266' ||
      Number(endpoint?.chainId) !== 1266 || typeof provider?.request !== 'function' ||
      typeof n.wallet.isCurrentConnection !== 'function') return null;

  const isCurrent = () => !n.recoverySuspended && n.permit('wallet', 'readWallet') &&
    n.wallet.connection === connection && n.wallet.isCurrentConnection(revision, connection.address, connection.chainId);
  if (!isCurrent()) return null;
  const scope = JSON.stringify([n.walletConsentSession, revision, connection.address, connection.chainId,
    endpoint.id, endpoint.rpc, endpoint.networkKey, n.installedVersions?.wallet]);
  return <RelayCheck key={scope} provider={provider} isCurrent={isCurrent}/>;
}
