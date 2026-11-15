import {useState} from 'react';
import {ErrorMessage, ModalDialog, useNative} from '@synergy-network/portal-native/dapp-sdk';
import {HISTORY_PAGE_LIMIT} from './account-history.js';
import {atlasAccountKey} from './atlas-account.js';
import {comparableTransactionHash} from './transaction-observation.js';

const indexedStatuses = new Set(['pending', 'confirmed', 'success', 'failed', 'indexed', 'dropped', 'reverted']);
const hashDigest = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/i.test(value);
const reportTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

function activityReport(page, visible, account, appVersion) {
  if (page.version !== 1 || page.source !== 'atlas_transactions' || page.partial !== true ||
      page.address !== atlasAccountKey(account) || !page.snapshot || !hashDigest(page.snapshot.blockHash) ||
      typeof page.network !== 'string' || page.network.trim() !== page.network ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(page.network) ||
      !Number.isSafeInteger(page.receivedAt) || page.receivedAt <= 0 || page.receivedAt > 8_640_000_000_000_000 ||
      !visible.length || visible.length > HISTORY_PAGE_LIMIT) return null;

  const sourceRows = new Set(page.items);
  if (visible.some(({transaction, direction}) => !sourceRows.has(transaction) ||
      !comparableTransactionHash(transaction.hash) || direction === 'Unclassified')) return null;

  return {
    schemaVersion: 1,
    scope: 'visible_rows_of_current_page',
    account,
    walletVersion: appVersion,
    chainId: 1266,
    source: {
      id: page.source, version: page.version, reportedNetwork: page.network,
      partial: true, finality: 'unverified', observedAt: reportTime(page.observedAt), indexedAt: reportTime(page.indexedAt),
      receivedAt: new Date(page.receivedAt).toISOString(),
      snapshot: {blockNumber: page.snapshot.blockNumber, blockHash: page.snapshot.blockHash},
    },
    page: {number: page.ordinal, returnedRows: page.items.length, exportedRows: visible.length, hasMore: page.hasMore},
    rows: visible.map(({transaction, type, direction, time}) => ({
      hash: transaction.hash, blockNumber: transaction.block_number, direction,
      hashFamily: type === 'unclassified' ? null : type,
      indexedStatus: indexedStatuses.has(transaction.status) ? transaction.status : null,
      amountNwei: transaction.amount_nwei, feeNwei: transaction.fee_nwei,
      reportedTimeUtc: time ? new Date(time.ms).toISOString() : null,
    })),
  };
}

function startDownload(json) {
  const link = document.createElement('a');
  const revoke = URL.revokeObjectURL.bind(URL);
  const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
  try {
    link.href = url;
    link.download = 'synergy-wallet-activity.json';
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => revoke(url), 1000);
  }
}

function ReviewedActivityExport({report, permit}) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');

  function confirm() {
    if (!review || !permit('wallet', 'readWallet')) {
      setReview(null);
      setError('Wallet export access is unavailable in this Portal context.');
      return;
    }
    try {
      startDownload(review);
      setReview(null);
    } catch {
      setError('Portal could not start the Wallet activity download.');
    }
  }

  return <>
    <button onClick={() => {
      if (!permit('wallet', 'readWallet')) return;
      setError('');
      setReview(report);
    }}>Review visible activity export</button>
    {!review && <ErrorMessage error={error}/>}
    {review && <ModalDialog label="Review Wallet activity export" onClose={() => setReview(null)}>
      <h2>Review Wallet activity export</h2>
      <p>The file includes your public account address and the visible rows of this Atlas page. Coverage is partial and finality remains unverified.</p>
      <pre aria-label="Wallet activity JSON">{review}</pre>
      <ErrorMessage error={error}/>
      <div className="native-actions">
        <button data-initial-focus onClick={() => setReview(null)}>Cancel export</button>
        <button onClick={confirm}>Download activity JSON</button>
      </div>
    </ModalDialog>}
  </>;
}

export function activityWalletVersion(native) {
  return native?.installedVersions?.wallet ?? native?.apps?.find(app => app.id === 'wallet')?.manifest?.version;
}

export function WalletActivityExport({page, visible, account, endpoint, filters}) {
  const n = useNative();
  const currentEndpoint = n?.endpoint;
  const version = activityWalletVersion(n);
  if (!n?.permit('wallet', 'readWallet') || !n.walletConsentSession || typeof version !== 'string' ||
      version.trim() !== version || !/^\d+\.\d+\.\d+$/.test(version) || n.wallet?.connection?.address !== account ||
      n.wallet.connection.chainId !== 'synergy:1266' || Number(currentEndpoint?.chainId) !== 1266 ||
      endpoint?.id !== currentEndpoint.id || endpoint?.rpc !== currentEndpoint.rpc ||
      endpoint?.networkKey !== currentEndpoint.networkKey) return null;

  const snapshot = activityReport(page, visible, account, version);
  if (!snapshot) return null;
  const report = JSON.stringify(snapshot, null, 2);
  const scope = JSON.stringify([n.walletConsentSession, endpoint.id, endpoint.rpc, endpoint.networkKey, filters, report]);
  return <ReviewedActivityExport key={scope} report={report} permit={n.permit}/>;
}
