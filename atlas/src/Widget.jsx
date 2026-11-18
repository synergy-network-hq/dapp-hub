import {useNative, atlas, useResource, ErrorMessage, short} from '@synergy-network/portal-native/dapp-sdk';
import {ATLAS_NETWORK, LATEST_INDEXED_BLOCK, latestIndexedBlock} from './observations.js';

const paths = {
  'latest-block': LATEST_INDEXED_BLOCK,
  transactions: 'txs?page=1&limit=3',
  validators: 'validators?page=1&limit=3',
};

export function DappWidget({widgetKey: key}) {
  const n = useNative();
  const allowed = !n.recoverySuspended && n.permit('atlas', 'readNetwork');
  const path = Object.hasOwn(paths, key) ? paths[key] : null;
  const resource = useResource(async signal => {
    if (!path || !allowed) return null;
    const value = await atlas(path, {signal});
    if (key === 'latest-block') return latestIndexedBlock(value);
    if (!Array.isArray(value?.items) || value.items.length > 3 || value.items.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw Error('Atlas returned an unsupported record list.');
    }
    return value.items;
  }, JSON.stringify([path, allowed]));

  if (!allowed) return <p>Allow Atlas network access in Security.</p>;
  if (!path) return <p>This Atlas widget is unavailable.</p>;
  const data = resource.data;
  let content;
  if (resource.error) content = <ErrorMessage error={resource.error}/>;
  else if (resource.loading) content = <p role="status">Loading Atlas records…</p>;
  else if (key === 'latest-block') {
    content = data ? <>
      <strong>{data.height}</strong>
      <p>{data.indexedAt ? <>Indexed <time dateTime={data.indexedAt}>{data.indexedAt}</time></> : 'Indexing time unavailable.'}</p>
    </> : <p>No indexed block was returned.</p>;
  } else {
    content = data?.length
      ? data.map(row => <p key={row.hash || row.address}>{short(key === 'transactions' ? row.hash : row.address)} · {row.status || 'indexed'}</p>)
      : <p>No indexed records.</p>;
  }
  return <>
    <p className="native-source">Atlas · {ATLAS_NETWORK}</p>
    {content}
  </>;
}
