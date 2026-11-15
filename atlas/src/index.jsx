import {useEffect, useRef, useState} from 'react';
import {useNative, atlas, openExternal, snrg, Card, Resource, useResource, useAction, ErrorMessage, Table, Detail, short} from '@synergy-network/portal-native/dapp-sdk';
import {atlasDetailUrl, checkedAtlasDetail, describeAtlasSelection} from './detail-model.js';
import {ATLAS_NETWORK, atlasSummary} from './observations.js';

const tabs = [
  ['blocks', 'Blocks'], ['txs', 'Transactions'], ['network/accounts', 'Accounts'],
  ['validators', 'Validators'], ['contracts', 'Contracts'], ['tokens', 'Tokens'],
];
const defaultView = {tab: 'blocks', page: 1, lookup: '', revision: 0};
const lookupKey = 'portal-native-v1:atlasLookup';
const searchColumns = [{key: 'title', label: 'Result'}, {key: 'type', label: 'Type'}, {key: 'id', label: 'Identifier', render: row => short(row.id)}];

function listColumns(tab) {
  if (tab === 'blocks') return [
    {key: 'number', label: 'Height'}, {key: 'tx_count', label: 'Transactions', render: row => row.tx_count ?? row.txCount ?? '—'},
    {key: 'indexed_at', label: 'Indexed at', render: row => row.indexed_at ?? row.indexedAt ?? '—'},
    {key: 'validator_address', label: 'Producer', render: row => short(row.validator_address ?? row.validatorAddress)},
  ];
  if (tab === 'txs') return [
    {key: 'hash', label: 'Hash', render: row => short(row.hash)}, {key: 'block_number', label: 'Block'},
    {key: 'status', label: 'Status'}, {key: 'amount_nwei', label: 'SNRG', render: row => snrg(row.amount_nwei)},
  ];
  return [{key: tab === 'tokens' ? 'symbol' : 'address', label: tab === 'tokens' ? 'Token' : 'Address',
    render: row => short(row.symbol || row.address)}, {key: 'name', label: 'Name'}, {key: 'status', label: 'Status'}];
}

function cancelRequest(request) {
  request.current?.controller.abort();
  request.current = null;
}

function searchValue(value) {
  if (typeof value !== 'string') return null;
  const query = value.trim();
  return !query || query.length >= 2 && query.length <= 128 ? query : null;
}

export function AtlasApp() {
  const n = useNative();
  const [view, setView] = useState(defaultView);
  const [query, setQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [selection, setSelection] = useState(null);
  const request = useRef(null);
  const external = useAction();
  const allowed = !n.recoverySuspended && n.permit('atlas', 'readNetwork');
  const scope = JSON.stringify([view, n.endpointId, n.endpoint.rpc, n.endpoint.ws, n.endpoint.chainId,
    n.endpoint.networkKey || n.endpoint.id, n.wallet?.connection?.address, allowed]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const visible = selection?.scope === scope ? selection : null;

  function clearSelection() {
    cancelRequest(request);
    setSelection(null);
  }

  function search(raw) {
    const lookup = searchValue(raw);
    if (lookup === null) {
      setSearchError('Search Atlas with 2 to 128 characters.');
      return;
    }
    clearSelection();
    setSearchError('');
    setView(current => ({...current, lookup, page: 1, revision: current.revision + 1}));
  }

  useEffect(() => {
    function loadLookup(event) {
      try {
        const stored = typeof event?.detail !== 'string' ? localStorage.getItem(lookupKey) : null;
        const supplied = typeof event?.detail === 'string' ? event.detail : stored?.replace(/^"|"$/g, '');
        if (!supplied) return;
        localStorage.removeItem(lookupKey);
        const next = searchValue(supplied);
        if (!next) return;
        cancelRequest(request);
        setSelection(null);
        setQuery(next);
        setSearchError('');
        setView(current => ({...current, lookup: next, page: 1, revision: current.revision + 1}));
      } catch {
        // A lookup handoff is optional. Atlas remains available if browser storage is blocked.
      }
    }
    loadLookup();
    window.addEventListener('portal-atlas-lookup', loadLookup);
    return () => window.removeEventListener('portal-atlas-lookup', loadLookup);
  }, []);

  useEffect(() => {
    setSelection(current => current?.scope === scope ? current : null);
    return () => {
      if (request.current?.scope === scope) cancelRequest(request);
    };
  }, [scope]);

  const list = useResource(async signal => {
    signal.throwIfAborted();
    if (!allowed) throw Error('Atlas network access is revoked in Security.');
    const path = view.lookup ? `search?q=${encodeURIComponent(view.lookup)}` : `${view.tab}?page=${view.page}&limit=20`;
    const response = await atlas(path, {signal});
    signal.throwIfAborted();
    const rows = response?.items ?? response?.accounts;
    if (!Array.isArray(rows)) throw Error('Atlas returned an unsupported list response.');
    return {rows: rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)), total: response.total};
  }, scope);
  const summary = useResource(async signal => allowed
    ? atlasSummary(await atlas('network/summary', {signal}))
    : null, String(allowed));
  const counts = allowed && !summary.loading && !summary.error ? summary.data : null;

  async function select(row) {
    clearSelection();
    if (!allowed) return;
    let detail;
    try {
      detail = describeAtlasSelection(row, view.tab, !!view.lookup);
    } catch (error) {
      setSelection({scope, error: error.message});
      return;
    }
    const current = {scope, controller: new AbortController()};
    request.current = current;
    setSelection({scope, loading: true});
    const stillSelected = () => request.current === current && currentScope.current === scope && !current.controller.signal.aborted;
    try {
      const value = detail.path ? await atlas(detail.path, {signal: current.controller.signal}) : row;
      if (stillSelected()) setSelection({scope, detail: checkedAtlasDetail(detail, value)});
    } catch (error) {
      if (stillSelected()) setSelection({scope, error: error instanceof Error ? error.message : 'Atlas detail could not be read.'});
    } finally {
      if (request.current === current) request.current = null;
    }
  }

  function updateView(update) {
    clearSelection();
    setSearchError('');
    setView(current => ({...current, ...update}));
  }

  function refresh() {
    clearSelection();
    setView(current => ({...current, revision: current.revision + 1}));
    summary.reload();
  }

  function openSite(url) {
    return external.run(() => {
      if (!n.permit('atlas', 'externalLinks')) throw Error('External links are revoked.');
      return openExternal(url);
    });
  }

  return <div>
    <div className="native-actions">
      <p className="native-source">Atlas · {ATLAS_NETWORK}</p>
      <button onClick={() => openSite('https://atlas.synergy-network.io')}>Open Atlas website</button>
      <button onClick={refresh}>Refresh</button>
    </div>
    <form className="native-search" onSubmit={event => {event.preventDefault(); search(query);}}>
      <input aria-label="Search Atlas" maxLength={128} placeholder="Block, transaction, validator, contract or address"
        value={query} onChange={event => setQuery(event.target.value)}/>
      <button>Search network</button>
    </form>
    <ErrorMessage error={searchError}/>
    <div className="native-tabs">{tabs.map(([id, label]) =>
      <button key={id} aria-pressed={view.tab === id && !view.lookup}
        onClick={() => updateView({tab: id, lookup: '', page: 1})}>{label}</button>
    )}</div>
    <ErrorMessage error={external.error}/>
    <div className="native-grid">
      <Card title="Reported height"><strong>{counts?.height ?? '—'}</strong><p>Atlas network summary</p></Card>
      <Card title="Reported transactions"><strong>{counts?.transactions ?? '—'}</strong><p>Atlas network summary</p></Card>
      <Card title="Validator nodes"><strong>{counts?.activeValidators ?? '—'}</strong><p>{counts?.totalValidators == null ? 'Reported active validators' : `Active of ${counts.totalValidators} reported`}</p></Card>
    </div>
    {allowed && summary.loading && <p role="status">Reading Atlas summary…</p>}
    {allowed && summary.error && <p>Atlas network summary is unavailable.</p>}
    <div className="native-split">
      <Card title={view.lookup ? 'Search results' : tabs.find(([id]) => id === view.tab)?.[1]}>
        <Resource value={{...list, reload: refresh}}>{data => <>
          <Table rows={data.rows} onSelect={select} columns={view.lookup ? searchColumns : listColumns(view.tab)}/>
          {!view.lookup && <div className="native-actions">
            <button disabled={view.page <= 1} onClick={() => updateView({page: view.page - 1})}>Previous</button>
            <span>Page {view.page} · {data.total ?? data.rows.length} indexed records</span>
            <button disabled={data.rows.length < 20} onClick={() => updateView({page: view.page + 1})}>Next</button>
          </div>}
        </>}</Resource>
      </Card>
      <Card title="Details">
        {visible?.loading ? <p role="status">Loading Atlas detail…</p> :
          visible?.error ? <ErrorMessage error={visible.error}/> :
          visible?.detail ? <>
            <Detail data={visible.detail.data}/>
            <button onClick={() => openSite(atlasDetailUrl(visible.detail))}>View on Atlas</button>
          </> : <p>Select a live record to inspect it.</p>}
      </Card>
    </div>
  </div>;
}
