import {useCallback, useState} from 'react';
import {
  useNative, rpc, openWallet, Card, Resource, useResource,
  useAction, ErrorMessage, Detail, Copy,
} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {WalletFeeMarket} from './WalletFeeMarket.jsx';
import {WalletEtdagTransferStatus} from './WalletEtdagTransferStatus.jsx';
import {WalletConnections} from './WalletConnections.jsx';
import {WalletHistory} from './WalletHistory.jsx';
import {WalletStsActivity} from './WalletStsActivity.jsx';
import {WalletReceiptHashLookup} from './WalletRpcReceiptObservation.jsx';
import {WalletBalances} from './WalletBalances.jsx';
import {WalletTokens} from './WalletTokens.jsx';
import {WalletOwnerTokens} from './WalletOwnerTokens.jsx';
import {readAtlasTokenBalances} from './token-balance-inventory.js';
import {readAtlasAddress} from './atlas-account.js';
import {Receive} from './WalletReceive.jsx';
import {WalletContacts} from './WalletContacts.jsx';
import {WalletCollectibles, WalletOwnerCollectibles} from './WalletCollectibles.jsx';
import {WalletMultiAssetInventory} from './WalletMultiAssetInventory.jsx';
import {WalletOverview} from './WalletOverview.jsx';
import {WalletOneTimeDraft, WalletRecipientDraft} from './WalletRecipientDraft.jsx';
import {WalletSparkMintDraftReview} from './WalletSparkMintDraftReview.jsx';
import {atlasEndpointRequired, canReadWalletAtlas, readScopedWalletAtlas} from './atlas-scope.js';
import {checkWalletAccountEndpoint, requireWalletReadScope, useWalletReadScope} from './wallet-account-read.js';
import './wallet.css';

const tabs = ['Assets', 'Collectibles', 'Activity', 'Receive', 'Send', 'Address book', 'Connections'];
// Portal can remount this app when Wallet consent or the selected endpoint changes.
const receiveConflicts = new Map();

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
  const atlasReady = canReadWalletAtlas(n);
  const readAtlas = (path, options) => readScopedWalletAtlas(n, path, options);
  const currentTab = ready ? tab : 'Connections';
  const scope = JSON.stringify([connection?.walletId, connection?.address, n.endpointId, n.endpoint.rpc, n.endpoint.networkKey, ready]);
  const atlasScope = JSON.stringify([scope, atlasReady, n.endpoint.genesisHash, n.walletConsentSession]);
  const atlasKey = `${atlasScope}:${revision}`;
  const draftScope = JSON.stringify([scope, n.endpoint.chainId, n.endpoint.genesisHash, n.walletConsentSession]);
  const canReadWallet = () => !n.recoverySuspended && n.permit('wallet', 'readWallet');
  const canReadAtlasAccount = useWalletReadScope(atlasKey, () => canReadWalletAtlas(n));
  if (recipientDraft && recipientDraft.scope !== draftScope) setRecipientDraft(null);

  const tokens = useResource(async signal => {
    if (!canReadAtlasAccount()) return null;
    await checkWalletAccountEndpoint(rpc, n.endpoint, signal, canReadAtlasAccount);
    requireWalletReadScope(signal, canReadAtlasAccount);
    const inventory = await readAtlasTokenBalances(readAtlas, connection.address, {signal});
    requireWalletReadScope(signal, canReadAtlasAccount);
    return {inventory, receivedAt: Date.now()};
  }, atlasKey);

  const account = useResource(async signal => {
    if (!canReadAtlasAccount()) return null;
    await checkWalletAccountEndpoint(rpc, n.endpoint, signal, canReadAtlasAccount);
    requireWalletReadScope(signal, canReadAtlasAccount);
    const value = await readAtlasAddress(readAtlas, connection.address, {signal});
    requireWalletReadScope(signal, canReadAtlasAccount);
    return {...value, portalReceivedAt: Date.now()};
  }, atlasKey);
  const data = atlasReady && !account.loading && !account.error ? account.data : null;

  function tabContent() {
    if (currentTab === 'Connections') return <WalletConnections canRead={ready} indexedIdentity={atlasReady ? account : null}/>;
    switch (currentTab) {
      case 'Assets':
        return <>
          {atlasReady ? <>
            <WalletOverview key={atlasScope} account={connection.address} endpoint={n.endpoint} revision={revision} observation={account} readAtlas={readAtlas}
              onActivity={() => setTab('Activity')} onCollectibles={() => setTab('Collectibles')}/>
            <Card title="Live assets"><Resource value={tokens}>{result => <>
              <SourceAge updatedAt={result.receivedAt}/><WalletTokens inventory={result.inventory}/>
            </>}</Resource></Card>
          </> : <Card title="Live assets"><p>{atlasEndpointRequired}</p></Card>}
          <WalletOwnerTokens key={`owner-tokens:${draftScope}`} account={connection.address} endpoint={n.endpoint} canRead={canReadWallet}/>
        </>;
      case 'Collectibles':
        return <>
          {atlasReady ? <WalletCollectibles key={atlasKey} account={connection.address} endpoint={n.endpoint} readAtlas={readAtlas}/>
            : <Card title="Collectibles"><p>{atlasEndpointRequired}</p></Card>}
          <WalletOwnerCollectibles key={`owner-nfts:${draftScope}`} account={connection.address} endpoint={n.endpoint} canRead={canReadWallet}/>
          <WalletMultiAssetInventory key={`owner-multi-assets:${draftScope}`} account={connection.address} endpoint={n.endpoint} canRead={canReadWallet}/>
        </>;
      case 'Activity':
        return <>
          <Card title="Indexed transactions">{atlasReady ? <WalletHistory key={atlasKey} account={connection.address}
            endpoint={n.endpoint} readAtlas={readAtlas} recent={data} recentAt={data?.portalReceivedAt}/> : <p>{atlasEndpointRequired}</p>}</Card>
          <WalletStsActivity key={`sts-activity:${draftScope}`} account={connection.address} endpoint={n.endpoint} canRead={canReadWallet}/>
          <WalletReceiptHashLookup key={`receipt-hash:${draftScope}`} account={connection.address} endpoint={n.endpoint} readRpc={rpc}/>
        </>;
      case 'Receive': {
        const {id, rpc: url, networkKey, chainId, genesisHash} = n.endpoint;
        const endpointKey = JSON.stringify([n.endpointId, id, url, networkKey, Number(chainId),
          typeof genesisHash === 'string' ? genesisHash.toLowerCase() : genesisHash]);
        function recordConflict(message) {
          if (message === null) receiveConflicts.delete(endpointKey);
          else receiveConflicts.set(endpointKey, message);
        }
        return <Receive account={connection.address} endpoint={n.endpoint} consentSession={n.walletConsentSession}
          endpointKey={endpointKey} readConflict={() => receiveConflicts.get(endpointKey)} onConflictChange={recordConflict}
          readRpc={rpc} canUse={canReadWallet}/>;
      }
      case 'Address book':
        return <><WalletContacts key={draftScope} canWrite={() => !n.recoverySuspended && n.permit('wallet', 'readWallet')} onDraftRecipient={contact => {
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
          <WalletEtdagTransferStatus key={`transfer-status:${draftScope}`} endpoint={n.endpoint} canCheck={canReadWallet}/>
          {recipientDraft?.scope === draftScope ? <WalletRecipientDraft contact={recipientDraft.contact} account={connection.address} endpoint={n.endpoint}
            onClear={() => setRecipientDraft(null)} onInvalidate={invalidateRecipient}
            canReview={canReadWallet}/> : <WalletOneTimeDraft key={draftScope} account={connection.address} endpoint={n.endpoint}
            canReview={canReadWallet}/>}
          <WalletFeeMarket key={`fee:${draftScope}`} endpoint={n.endpoint} canRead={canReadWallet}/>
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
      <button disabled={!ready || (atlasReady && (account.loading || tokens.loading))} onClick={() => setRevision(value => value + 1)}>
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
          {atlasReady && <ErrorMessage error={account.error}/>}
        </Card>
        <WalletBalances key={revision} account={connection.address} endpoint={n.endpoint} index={data}
          indexReceivedAt={data?.portalReceivedAt} consentSession={n.walletConsentSession} canRead={canReadWallet}/>
      </>}
      <div className="native-tabs">{tabs.map(name => <button key={name} aria-pressed={currentTab === name}
        disabled={!ready && name !== 'Connections'} onClick={() => setTab(name)}>{name}</button>)}</div>
      {tabContent()}
      {(currentTab === 'Connections' || currentTab === 'Send') && <WalletSparkMintDraftReview key={currentTab}/>}
    </div>
  </div>;
}
