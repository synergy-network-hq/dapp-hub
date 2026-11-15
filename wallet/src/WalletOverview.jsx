import {Card, Resource, Table, short} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {indexedTransactionAmount, transactionDirection} from './WalletActivity.jsx';
import {WalletCollectiblesPreview} from './WalletCollectibles.jsx';
import {sourceRecords} from './source-records.js';
import {comparableTransactionHash} from './transaction-observation.js';

const recentColumns = [
  {key: 'hash', label: 'Hash', render: row => <code title={row.hash}>{short(row.hash)}</code>},
  {key: 'direction', label: 'Direction'},
  {key: 'amount', label: 'Reported SNRG'},
];

function recentActivity(raw, account) {
  const source = sourceRecords(raw, 'Recent account activity');
  if (!source.available) return null;

  const counts = new Map();
  for (const {hash} of source.records) {
    if (!comparableTransactionHash(hash)) continue;
    const key = hash.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const preview = [];
  for (const row of source.items) {
    if (typeof row.hash !== 'string' || counts.get(row.hash.toLowerCase()) !== 1) continue;
    const direction = transactionDirection(row, account);
    if (direction === 'Unclassified') continue;
    preview.push({hash: row.hash, direction, amount: indexedTransactionAmount(row.amount_nwei)});
    if (preview.length === 3) break;
  }
  return preview;
}

export function WalletOverview({account, endpoint, revision, observation, readAtlas, onActivity, onCollectibles}) {
  return <div className="native-grid">
    <Card title="Recent activity" action={<button onClick={onActivity}>View full Activity</button>}>
      <Resource value={{...observation, error: observation.error ? 'Atlas recent activity is unavailable.' : null}}>{result => {
        const rows = recentActivity(result.recentTransactions, account);
        return rows === null ? <p>Atlas did not return a supported recent activity list.</p> : <>
          <SourceAge source="Atlas recent account records" updatedAt={result.portalReceivedAt}/>
          <p>Up to three matching records from the limited account response.</p>
          <Table rows={rows} columns={recentColumns} empty="No matching transactions were returned in the recent Atlas response."/>
        </>;
      }}</Resource>
    </Card>
    <WalletCollectiblesPreview {...{account, endpoint, revision, readAtlas}} onBrowse={onCollectibles}/>
  </div>;
}
