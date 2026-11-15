import {useCallback, useState} from 'react';
import {
  useNative, atlas, rpc, chainIdNumber, openWallet, Card, Resource, useResource,
  useAction, ErrorMessage, Detail, Copy,
} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {WalletFeeMarket} from './WalletFeeMarket.jsx';
import {WalletConnections} from './WalletConnections.jsx';
import {WalletHistory} from './WalletHistory.jsx';
import {WalletBalances} from './WalletBalances.jsx';
import {WalletTokens} from './WalletTokens.jsx';
import {readAtlasTokenBalances} from './token-balance-inventory.js';
import {readAtlasAddress} from './atlas-account.js';
import {Receive} from './WalletReceive.jsx';
import {WalletContacts} from './WalletContacts.jsx';
import {WalletCollectibles} from './WalletCollectibles.jsx';
import {WalletOverview} from './WalletOverview.jsx';
import {WalletRecipientDraft} from './WalletRecipientDraft.jsx';
import './wallet.css';

const tabs = ['Assets', 'Collectibles', 'Activity', 'Receive', 'Send', 'Address book', 'Connections'];

export function WalletApp() {
  const n = useNative();
  const connection = n.wallet.connection;
  const [tab, setTab] = useState('Assets');
  const [revision, setRevision] = useState(0);
  const [recipientDraft, setRecipientDraft] = useState(null);
  const invalidateRecipient = useCallback(contact => setRecipientDraft(current =>
    current?.contact === contact ? {...current, contact: null} : current), []);
  const action = useAction();
  const ready = !n.recoverySuspended && n.permit('wallet', 'readWallet') &&
    connection?.chainId === 'synergy:1266' && Number(n.endpoint.chainId) === 1266;
  const currentTab = ready ? tab : 'Connections';
  const scope = JSON.stringify([connection?.walletId, connection?.address, n.endpointId, n.endpoint.rpc, n.endpoint.networkKey, ready]);
  const observationKey = `${scope}:${revision}`;
  const draftScope = JSON.stringify([scope, n.walletConsentSession]);
  if (recipientDraft && recipientDraft.scope !== draftScope) setRecipientDraft(null);

  const tokens = useResource(async signal => {
    if (!ready) throw Error('Connect a chain 1266 account and allow Wallet reads.');
    const options = {endpoint: n.endpoint.rpc, signal};
    if (chainIdNumber(await rpc('synergy_getChainId', [], options)) !== 1266) {
      throw Error('RPC chain identity does not match Wallet chain 1266.');
    }
    signal.throwIfAborted();
    const inventory = await readAtlasTokenBalances(atlas, connection.address, {signal});
    return {inventory, receivedAt: Date.now()};
  }, observationKey);

  const account = useResource(async signal => {
    if (!ready) throw Error('Wallet reads unavailable.');
    if (chainIdNumber(await rpc('synergy_getChainId', [], {endpoint: n.endpoint.rpc, signal})) !== 1266) {
      throw Error('RPC chain identity does not match Wallet chain 1266.');
    }
    signal.throwIfAborted();
    const value = await readAtlasAddress(atlas, connection.address, {signal});
    return {...value, portalReceivedAt: Date.now()};
  }, observationKey);
  const data = ready && !account.loading && !account.error ? account.data : null;

  function tabContent() {
    if (currentTab === 'Connections') return <WalletConnections canRead={ready}/>;
    switch (currentTab) {
      case 'Assets':
        return <>
          <WalletOverview account={connection.address} endpoint={n.endpoint} revision={revision} observation={account}
            onActivity={() => setTab('Activity')} onCollectibles={() => setTab('Collectibles')}/>
          <Card title="Live assets"><Resource value={tokens}>{result => <>
            <SourceAge updatedAt={result.receivedAt}/><WalletTokens inventory={result.inventory}/>
          </>}</Resource></Card>
        </>;
      case 'Collectibles':
        return <WalletCollectibles key={observationKey} account={connection.address} endpoint={n.endpoint}/>;
      case 'Activity':
        return <Card title="Indexed transactions"><WalletHistory key={observationKey} account={connection.address}
          endpoint={n.endpoint} recent={data} recentAt={data?.portalReceivedAt}/></Card>;
      case 'Receive':
        return <Receive account={connection.address} endpoint={n.endpoint}/>;
      case 'Address book':
        return <><WalletContacts key={scope} onDraftRecipient={contact => {
          if (!n.permit('wallet', 'readWallet')) return false;
          setRecipientDraft({scope: draftScope, contact});
          return true;
        }}/>{!!n.profile.contacts?.length && <Card title="Legacy contacts">
          <p>Existing profile contacts are retained. Review and add them to this network-specific address book when needed.</p>
          <Detail data={{contacts: n.profile.contacts}}/>
        </Card>}</>;
      default:
        return <Card title="Send requires a supported transaction contract">
          <p>Transfers remain unavailable until the network’s authoritative ETDAG transaction preparation and mobile signing contracts are integrated. No nonce, fees, signature algorithm or transaction envelope is guessed.</p>
          {recipientDraft?.scope === draftScope && <WalletRecipientDraft contact={recipientDraft.contact} endpoint={n.endpoint}
            onClear={() => setRecipientDraft(null)} onInvalidate={invalidateRecipient}/>}
          <WalletFeeMarket endpoint={n.endpoint}/>
          <button onClick={() => action.run(openWallet)}>Open Synergy Wallet app</button>
        </Card>;
    }
  }

  let headerStatus = 'Not connected';
  if (connection) headerStatus = ready ? connection.walletName || 'Connected' : 'Read access unavailable';
  return <div className="wallet-migrated">
    <div className="native-actions">
      <p>Synergy Wallet · {headerStatus}</p>
      <button onClick={() => action.run(openWallet)}>Open Synergy Wallet app</button>
      {currentTab !== 'Connections' && <button onClick={() => n.navigate('wallet-connection')}>Manage connection</button>}
      <button disabled={!ready || account.loading || tokens.loading} onClick={() => setRevision(value => value + 1)}>
        Refresh Wallet observations
      </button>
    </div>
    <ErrorMessage error={action.error}/>
    {!connection && <Card title="Connect once across Portal"><p>Pair Synergy Wallet using Connect Wallet in the header.</p></Card>}
    {connection && !ready && <Card title="Wallet reads unavailable">
      <p>Allow Wallet reads in Security &amp; permissions and select the connected Synergy Testnet account on chain 1266.</p>
    </Card>}
    <div key={scope}>
      {ready && <>
        <Card title="Account">
          <Copy value={connection.address} label="Copy address"/>
          <Detail data={{address: connection.address, chain: connection.chainId}}/>
          <ErrorMessage error={account.error}/>
        </Card>
        <WalletBalances key={revision} account={connection.address} endpoint={n.endpoint} index={data}
          indexReceivedAt={data?.portalReceivedAt}/>
      </>}
      <div className="native-tabs">{tabs.map(name => <button key={name} aria-pressed={currentTab === name}
        disabled={!ready && name !== 'Connections'} onClick={() => setTab(name)}>{name}</button>)}</div>
      {tabContent()}
    </div>
  </div>;
}
