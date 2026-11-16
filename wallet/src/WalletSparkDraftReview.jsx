import {Fragment, useId, useLayoutEffect, useRef, useState} from 'react';
import {Card, useNative} from '@synergy-network/portal-native/dapp-sdk';
import {isSparkNf1WalletAddress, MAX_SPARK_NF1_DRAFT_BYTES} from './spark-nf1-draft.js';
import {inspectSparkDraft} from './spark-sts-launch-draft.js';
import {STS_TESTNET_GENESIS} from './wallet-address.js';
import {WalletSparkMintAuthorityCheck} from './WalletSparkMintAuthorityCheck.jsx';
import {WalletSparkMintReceiptCheck} from './WalletSparkMintReceiptCheck.jsx';
import {WalletSparkSaleEvidenceReview} from './WalletSparkSaleEvidenceReview.jsx';
import {useWalletReadScope} from './wallet-account-read.js';

export function WalletSparkDraftReview() {
  const [review, setReview] = useState({status: 'empty'});
  const input = useRef(null);
  const revision = useRef(0);
  const instructions = useId();
  useLayoutEffect(() => () => {revision.current++;}, []);

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const current = ++revision.current;
    if (file.size > MAX_SPARK_NF1_DRAFT_BYTES) {
      setReview({status: 'failed', message: 'The draft exceeds 24 KiB.'});
      return;
    }

    setReview({status: 'reading'});
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (current === revision.current) setReview({status: 'failed', message: 'The selected draft file could not be read.'});
      return;
    }
    if (current !== revision.current) return;
    try {
      const value = inspectSparkDraft(bytes);
      setReview({status: 'checked', value, revision: current, draftBytes: value.action === 'buy' ? bytes : null});
    } catch (error) {
      setReview({status: 'failed', message: error.message});
    }
  }

  function clearFile() {
    revision.current++;
    input.current.value = '';
    setReview({status: 'empty'});
    input.current.focus();
  }

  const value = review.status === 'checked' ? review.value : null;
  return <Card title="Review an unsigned Spark draft">
    <p id={instructions}>Choose a B1 token launch or an NF1 mint, list, cancel or buy draft exported from Spark, up to 24 KiB. The file stays on this device.</p>
    <label>Unsigned Spark draft<input ref={input} type="file" accept=".json,application/json"
      aria-describedby={instructions} onChange={chooseFile}/></label>
    {review.status !== 'empty' && <button type="button" onClick={clearFile}>Clear draft file</button>}
    {review.status === 'reading' && <p role="status">Reading draft…</p>}
    {review.status === 'failed' && <p role="alert" className="native-error">{review.message}</p>}
    {value?.action === 'launch' && <LaunchDraftSummary value={value}/>}
    {value?.action === 'mint' && <MintDraftSummary value={value} isCurrent={() => revision.current === review.revision}/>}
    {value && Object.hasOwn(saleActions, value.action) && <SaleDraftSummary value={value} draftBytes={review.draftBytes}
      isCurrent={() => revision.current === review.revision}/>}
  </Card>;
}

function LaunchDraftSummary({value}) {
  return <section aria-label="Unsigned B1 token launch review">
    <p role="status">Unsigned B1 token launch draft</p>
    <dl className="native-details">
      <div><dt>Token</dt><dd>{value.name} ({value.symbol})</dd></div>
      <div><dt>Draft network</dt><dd>{value.network} · Chain {value.chainId}</dd></div>
      <div><dt>Draft creator</dt><dd><code>{value.creatorAddress}</code></dd></div>
      <div><dt>Expected token ID</dt><dd><code>{value.expectedTokenId}</code></dd></div>
      <div><dt>Token decimals</dt><dd>{value.decimals}</dd></div>
      <div><dt>Fixed supply (atomic units)</dt><dd>{value.supply}</dd></div>
      <div><dt>STS creator nonce</dt><dd>{value.nonce}</dd></div>
      <div><dt>Creation timestamp</dt><dd>{value.createdAt} Unix seconds</dd></div>
      <div><dt>Metadata URI</dt><dd>{value.metadataUri === null ? 'Unset' : <bdi>{value.metadataUri}</bdi>}</dd></div>
      <div><dt>Metadata SHA3-256 commitment</dt><dd>{value.metadataHash === null ? 'Unset' : <code>{value.metadataHash}</code>}</dd></div>
      {value.metadataHash === null && <div><dt>Name-derived identity SHA3-256</dt><dd><code>{value.identityMetadataHash}</code></dd></div>}
      <div><dt>Image URI</dt><dd>{value.imageUri === null ? 'Unset' : <bdi>{value.imageUri}</bdi>}</dd></div>
      <div><dt>Image SHA3-256 commitment</dt><dd>{value.imageHash === null ? 'Unset' : <code>{value.imageHash}</code>}</dd></div>
      <div><dt>Mint and metadata authority overrides</dt><dd>Unset</dd></div>
      <div><dt>Metadata mutable</dt><dd>No</dd></div>
      <div><dt>Draft file SHA-256</dt><dd><code>{value.sha256}</code></dd></div>
      <div><dt>STS payload SHA-256</dt><dd><code>{value.payloadSha256}</code></dd></div>
    </dl>
    {value.exceedsCliV20Supply && <p>This supply exceeds the STS CLI v20 draft limit.</p>}
    <p>The token ID is derived from this draft. Signing and deployment require a compatible Wallet.</p>
  </section>;
}

function MintDraftSummary({value, isCurrent}) {
  return <section aria-label="Unsigned NF1 mint review">
    <p role="status">Unsigned NF1 mint draft</p>
    <dl className="native-details">
      <div><dt>Draft network</dt><dd>{value.network} · Chain {value.chainId}</dd></div>
      <div><dt>Draft sender</dt><dd><code>{value.sender}</code></dd></div>
      <div><dt>Recipient</dt><dd><code>{value.recipient}</code></dd></div>
      <div><dt>NF1 collection</dt><dd><code>{value.collectionId}</code></dd></div>
      <div><dt>Mint timestamp</dt><dd>{value.mintedAt} Unix seconds</dd></div>
      <div><dt>Metadata URI</dt><dd>{value.metadataUri === null ? 'Collection default' : <bdi>{value.metadataUri}</bdi>}</dd></div>
      <div><dt>Metadata SHA3-256 commitment</dt><dd>{value.metadataSha3 === null ? 'Collection default' : <code>{value.metadataSha3}</code>}</dd></div>
      <div><dt>Metadata mutable</dt><dd>No</dd></div>
      <div><dt>Transferability and issuer approval overrides</dt><dd>Collection defaults</dd></div>
      <div><dt>Draft expiry</dt><dd>Unset</dd></div>
      <div><dt>Draft file SHA-256</dt><dd><code>{value.sha256}</code></dd></div>
    </dl>
    <SparkMintPairingComparison draft={value}/>
    <SparkMintRpcChecks draft={value} isCurrent={isCurrent}/>
    <p>Signer identity, fees and transaction approval still require independent verification.</p>
  </section>;
}

const saleActions = {list: 'List NFT', cancel: 'Cancel listing', buy: 'Buy NFT'};

function SaleDraftSummary({value, draftBytes, isCurrent}) {
  return <section aria-label="Unsigned NF1 sale review">
    <p role="status">Unsigned NF1 sale draft</p>
    <dl className="native-details">
      <div><dt>Action</dt><dd>{saleActions[value.action]}</dd></div>
      <div><dt>Draft network</dt><dd>{value.network} · Chain {value.chainId}</dd></div>
      <div><dt>Draft sender</dt><dd><code>{value.sender}</code></dd></div>
      <div><dt>NF1 NFT</dt><dd><code>{value.nftId}</code></dd></div>
      {value.listingId && <div><dt>Listing ID</dt><dd><code>{value.listingId}</code></dd></div>}
      {value.expectedSeller && <div><dt>Expected seller</dt><dd><code>{value.expectedSeller}</code></dd></div>}
      {value.priceNwei && <div><dt>Draft price</dt><dd>{value.priceNwei} nWei</dd></div>}
      {value.expiresAtHeight && <div><dt>Listing expiry height</dt><dd>{value.expiresAtHeight}</dd></div>}
      <div><dt>Draft file SHA-256</dt><dd><code>{value.sha256}</code></dd></div>
    </dl>
    <p>Ownership, listing state, fees and transaction approval require separate verification.</p>
    {value.action === 'buy' && <WalletSparkSaleEvidenceReview key={value.sha256} draftBytes={draftBytes} isCurrent={isCurrent}/>}
  </section>;
}

function SparkMintRpcChecks({draft, isCurrent}) {
  const native = useNative();
  const {endpoint, walletConsentSession: consent, wallet: {connection, connectionRevision, isCurrentConnection}} = native;
  const scope = JSON.stringify([draft.sha256, native.endpointId, endpoint?.id, endpoint?.rpc, endpoint?.networkKey,
    endpoint?.chainId, endpoint?.genesisHash, consent, connectionRevision, connection?.walletId, connection?.address, connection?.chainId]);
  const allowed = () => !!connection && typeof consent === 'string' && !!consent && isCurrent() &&
    !native.recoverySuspended && native.permit('wallet', 'readWallet') && connection.chainId === 'synergy:1266' &&
    Number(endpoint?.chainId) === 1266 && Number.isSafeInteger(connectionRevision) &&
    typeof isCurrentConnection === 'function' && isCurrentConnection(connectionRevision, connection.address, connection.chainId);
  const canRead = useWalletReadScope(scope, allowed);
  return allowed() && <Fragment key={scope}>
    <WalletSparkMintAuthorityCheck {...{draft, endpoint, canRead}}/>
    <WalletSparkMintReceiptCheck {...{draft, endpoint, canRead}}/>
  </Fragment>;
}

function SparkMintPairingComparison({draft}) {
  const native = useNative();
  const {connection, connectionRevision, isCurrentConnection} = native.wallet;
  const endpoint = native.endpoint;
  const consent = native.walletConsentSession;
  const configuredGenesis = endpoint?.genesisHash;
  const chainMatches = connection?.chainId === 'synergy:' + draft.chainId && Number(endpoint?.chainId) === draft.chainId;
  const genesisMatches = configuredGenesis == null ||
    (typeof configuredGenesis === 'string' && configuredGenesis.toLowerCase() === STS_TESTNET_GENESIS);
  const matchesWalletAuthorization = () => !native.recoverySuspended && native.permit('wallet', 'readWallet') &&
    isCurrentConnection(connectionRevision, connection.address, connection.chainId);

  if (!chainMatches || !genesisMatches || connection.walletId !== 'synergy-mobile' ||
      typeof consent !== 'string' || !consent || !Number.isSafeInteger(connectionRevision) ||
      typeof isCurrentConnection !== 'function' || !matchesWalletAuthorization()) return null;

  const scope = JSON.stringify([draft.sha256, consent, connectionRevision, connection.address, connection.chainId,
    native.endpointId, endpoint.id, endpoint.rpc, endpoint.networkKey, endpoint.chainId, configuredGenesis]);
  return <PairingComparison key={scope} sender={draft.sender} pairedAddress={connection.address}
    authorized={matchesWalletAuthorization}/>;
}

const pairingReports = {
  match: 'The draft sender exactly matches the address reported by the current pairing.',
  different: 'The draft sender differs from the address reported by the current pairing.',
  unsupported: 'The current paired address cannot be checked as a Spark NF1 Bech32m address.',
};

function PairingComparison({sender, pairedAddress, authorized}) {
  const [result, setResult] = useState(null);

  function compare() {
    if (!authorized()) {
      setResult(null);
      return;
    }
    setResult(isSparkNf1WalletAddress(pairedAddress) ? (pairedAddress === sender ? 'match' : 'different') : 'unsupported');
  }

  return <section aria-label="Current pairing comparison">
    <button type="button" onClick={compare}>Compare sender with current pairing</button>
    {result && authorized() && <p role="status">{pairingReports[result]}</p>}
  </section>;
}
