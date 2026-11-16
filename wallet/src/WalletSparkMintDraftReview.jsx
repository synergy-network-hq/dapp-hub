import {useId, useLayoutEffect, useRef, useState} from 'react';
import {Card, useNative} from '@synergy-network/portal-native/dapp-sdk';
import {inspectSparkNf1MintDraft, isSparkNf1WalletAddress, MAX_SPARK_MINT_DRAFT_BYTES} from './spark-nf1-draft.js';
import {STS_TESTNET_GENESIS} from './wallet-address.js';
import {WalletSparkMintAuthorityCheck} from './WalletSparkMintAuthorityCheck.jsx';

export function WalletSparkMintDraftReview() {
  const [review, setReview] = useState({status: 'empty'});
  const input = useRef(null);
  const revision = useRef(0);
  const instructions = useId();
  useLayoutEffect(() => () => {revision.current++;}, []);

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const current = ++revision.current;
    if (file.size > MAX_SPARK_MINT_DRAFT_BYTES) {
      setReview({status: 'failed', message: 'The mint draft exceeds 24 KiB.'});
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
      setReview({status: 'checked', value: inspectSparkNf1MintDraft(bytes), revision: current});
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

  return <Card title="Review an unsigned Spark mint draft">
    <p id={instructions}>Choose the NF1 mint JSON downloaded from Spark, up to 24 KiB. The file stays on this device.</p>
    <label>Unsigned Spark mint draft<input ref={input} type="file" accept=".json,application/json"
      aria-describedby={instructions} onChange={chooseFile}/></label>
    {review.status !== 'empty' && <button type="button" onClick={clearFile}>Clear mint draft file</button>}
    {review.status === 'reading' && <p role="status">Reading mint draft…</p>}
    {review.status === 'failed' && <p role="alert" className="native-error">{review.message}</p>}
    {review.status === 'checked' && <MintDraftSummary value={review.value} isCurrent={() => revision.current === review.revision}/>}
  </Card>;
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
    <WalletSparkMintAuthorityCheck draft={value} isCurrent={isCurrent}/>
    <p>Signer identity, fees and transaction approval still require independent verification.</p>
  </section>;
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
