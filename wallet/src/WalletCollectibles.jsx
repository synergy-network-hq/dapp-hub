import {useState} from 'react';
import {Card, Detail, Resource, chainIdNumber, rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {ATLAS_NFT_LIMIT, collectibleObservations} from './collectible-observations.js';
import {requireAtlasAccountKey} from './atlas-account.js';

const classLabels = {nf1: 'NF1 standard NFT', nf2: 'NF2 controlled NFT'};
const collectionStatusLabels = {verified: 'Atlas marks this collection verified', active: 'Atlas reports an active collection'};

function CollectibleList({items, receivedAt}) {
  const [collection, setCollection] = useState('');
  const [status, setStatus] = useState('');
  const [selection, setSelection] = useState(null);
  const collections = new Map(items.map(item => [item.collectionId, item.collection]));
  const statuses = [...new Set(items.map(item => item.status))].sort();
  const visible = items.filter(item => (!collection || item.collectionId === collection) && (!status || item.status === status));
  const selected = visible.find(item => item.key === selection);
  return <>
    <SourceAge source="Atlas public token registry" updatedAt={receivedAt}/>
    {items.length ? <>
      <label>Filter by collection<select value={collection} onChange={event => {
        setCollection(event.target.value);
        setSelection(null);
      }}>
        <option value="">All returned collections</option>
        {[...collections].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Filter by indexed status<select value={status} onChange={event => {
        setStatus(event.target.value);
        setSelection(null);
      }}>
        <option value="">All returned statuses</option>
        {statuses.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <div className="native-grid" aria-label="Indexed collectible records">
        {visible.map(item => <article key={item.key} className="native-card">
          <p>Media unavailable</p>
          <h3>{item.name}</h3>
          <p>{item.collection} · {item.status}</p>
          <button aria-pressed={item.key === selection} onClick={() => setSelection(item.key)}>
            Inspect {item.name}
          </button>
        </article>)}
      </div>
      {!visible.length && <p>No returned collectibles match these filters.</p>}
      {selected && <aside aria-label="Selected collectible">
        <h3>{selected.name}</h3>
        <Detail data={{
          collection: selected.collection,
          collectionId: selected.collectionId,
          tokenId: selected.nftId,
          tokenAddress: selected.address ?? 'Unavailable',
          indexedOwner: selected.ownerAddress,
          indexedStatus: selected.status,
          indexedQuantity: selected.quantity,
          reportedTokenClass: classLabels[selected.tokenClass] ?? 'Unavailable',
          reportedCollectionStatus: collectionStatusLabels[selected.collectionStatus] ?? 'Unavailable',
          indexedCreationBlock: selected.creationBlock ?? 'Unavailable',
          indexedCreationTransaction: selected.creationHash ?? 'Unavailable',
          provenance: 'Unverified',
          metadata: selected.metadataStatus,
          reportedMetadataHash: selected.metadataHash ?? 'Unavailable',
        }}/>
        <p>Media unavailable. Wallet does not load the metadata reference.</p>
      </aside>}
    </> : <p>No matching NFT records were returned. This limited view cannot establish an empty inventory.</p>}
  </>;
}

function useCollectibleObservations({account, endpoint, readRpc = rpc, readAtlas, revision, requested = true}) {
  return useResource(async signal => {
    if (!requested) return null;
    signal.throwIfAborted();
    requireAtlasAccountKey(account);
    if (Number(endpoint.chainId) !== 1266 ||
        chainIdNumber(await readRpc('synergy_getChainId', [], {endpoint: endpoint.rpc, signal})) !== 1266) {
      throw Error('Atlas collectible observations require a matching Synergy Testnet endpoint.');
    }
    signal.throwIfAborted();
    const result = await readAtlas('tokens', {signal});
    signal.throwIfAborted();
    return {items: collectibleObservations(result, account), receivedAt: Date.now()};
  }, JSON.stringify([account, endpoint.id, endpoint.rpc, endpoint.chainId, endpoint.networkKey, revision, requested]));
}

export function WalletCollectiblesPreview({account, endpoint, revision, readAtlas, onBrowse}) {
  const [requested, setRequested] = useState(false);
  const observation = useCollectibleObservations({account, endpoint, revision, readAtlas, requested});

  return <Card title="Collectible preview" action={<button onClick={onBrowse}>View full Collectibles</button>}>
    <p>Matching records from up to {ATLAS_NFT_LIMIT} recent STS NFTs across accounts in Atlas. Current ownership and coverage remain unverified.</p>
    {requested ? <Resource value={observation}>{({items, receivedAt}) => <>
      <SourceAge source="Atlas public token registry" updatedAt={receivedAt}/>
      {items.length ? <ul>{items.slice(0, 3).map(item => <li key={item.key}>
        <strong>{item.name}</strong><small>{item.collection} · {item.status} · Media unavailable</small>
      </li>)}</ul> : <p>No matching NFT records were returned in this limited view.</p>}
    </>}</Resource> : <button onClick={() => setRequested(true)}>Load collectible preview</button>}
  </Card>;
}

export function WalletCollectibles({account, endpoint, readRpc, readAtlas}) {
  const [revision, setRevision] = useState(0);
  const {data, loading, error} = useCollectibleObservations({account, endpoint, readRpc, readAtlas, revision});

  return <Card title="Collectibles">
    <p>Atlas lists up to {ATLAS_NFT_LIMIT} recent STS NFT records across all accounts. Wallet shows records reporting the selected account as owner.</p>
    <p>Coverage, current ownership and provenance are unverified. Multi-asset holdings and remote media are unavailable.</p>
    <Resource value={{data, loading, error}}>{observation =>
      <CollectibleList items={observation.items} receivedAt={observation.receivedAt}/>
    }</Resource>
    <button disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh collectible observations</button>
  </Card>;
}
