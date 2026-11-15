import {useNative, Card, Table} from '@synergy-network/portal-native/dapp-sdk';
import {WalletRelayStatus} from './WalletRelayStatus.jsx';

const grants = {
  readWallet: 'Read public account data',
  readNetwork: 'Read network observations',
  requestTransactions: 'Request separate transaction review',
  notifications: 'Portal notifications',
  externalLinks: 'External links',
};

function sessionStart(connection, session) {
  if (!session || session.address !== connection.address || session.chainId !== connection.chainId) {
    return 'Unavailable';
  }
  const started = session.connectedAt;
  return Number.isSafeInteger(started) && started > 0 && started <= 8640000000000000
    ? new Date(started).toISOString() : 'Unavailable';
}

function idleTimeout(minutes) {
  if (minutes === 0) return 'Off';
  return Number.isSafeInteger(minutes) && minutes > 0 ? String(minutes) + ' minutes' : 'Unavailable';
}

export function WalletConnections({canRead}) {
  const n = useNative();
  const connection = canRead && !n.recoverySuspended && n.permit('wallet', 'readWallet')
    ? n.wallet.connection : null;

  const applications = connection ? n.apps.filter(app => n.installed.includes(app.id)).map(app => {
    const validContext = n.permissionContextMatches(app.id);
    const effectiveGrants = validContext
      ? Object.keys(grants).filter(key => app.manifest?.capabilities.includes(key) && n.permit(app.id, key))
      : [];
    return {
      id: app.id,
      name: app.name,
      version: n.installedVersions[app.id] || app.manifest?.version || 'Unavailable',
      context: validContext ? 'Current account and network' : 'Reapproval required',
      grants: effectiveGrants.map(key => grants[key]).join(', ') || 'None',
    };
  }) : [];

  return <>
    <Card title="Portal connection">
      <dl className="native-details">
        <div><dt>Selected network</dt><dd>{n.endpoint.name}</dd></div>
        <div><dt>Selected chain</dt><dd>{n.endpoint.chainId}</dd></div>
        {connection && <>
          <div><dt>Wallet</dt><dd>{connection.walletName}</dd></div>
          <div><dt>Account</dt><dd>{connection.address}</dd></div>
          <div><dt>Wallet chain</dt><dd>{connection.chainId}</dd></div>
          <div><dt>Local session started</dt><dd>{sessionStart(connection, n.session)}</dd></div>
          <div><dt>Portal inactivity disconnect</dt><dd>{idleTimeout(n.settings.sessionMinutes)}</dd></div>
          <div><dt>Phone version and approved scopes</dt><dd>Unavailable from the current pairing adapter</dd></div>
        </>}
      </dl>
      {!connection && <p>Wallet account access is unavailable in this Portal context.</p>}
      {connection && <WalletRelayStatus connection={connection}/>}
      <div className="native-actions">
        <button onClick={() => n.navigate('wallet-connection')}>Manage connection in Portal</button>
        <button onClick={() => n.navigate('security')}>Manage grants in Portal</button>
      </div>
    </Card>
    {connection && <Card title="Enabled application grants">
      <p>Portal grants apply to this app version, account and network. Review phone sessions separately.</p>
      <Table rows={applications} columns={[
        {key: 'name', label: 'Application'},
        {key: 'version', label: 'Version'},
        {key: 'context', label: 'Grant context'},
        {key: 'grants', label: 'Effective Portal grants'},
      ]} empty="No applications are enabled."/>
    </Card>}
    <Card title="Wallet capabilities">
      <dl className="native-details">
        <div><dt>Public account reads</dt><dd>{connection ? 'Allowed in this Portal context' : 'Unavailable in this Portal context'}</dd></div>
        <div><dt>Transaction signing and submission</dt><dd>Unavailable in this Wallet integration</dd></div>
      </dl>
      <p>Transaction-request grants allow a separate review. Signing requires phone approval and a supported integration.</p>
      <p>Balances and activity come from the selected RPC and Atlas. Index coverage and spendability may be unavailable.</p>
      <p>Use Wallet connection in Portal to disconnect locally and check pending remote cleanup. Phone sessions can also be revoked from the phone.</p>
    </Card>
  </>;
}
