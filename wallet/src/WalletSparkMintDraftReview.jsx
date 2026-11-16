import {useId, useLayoutEffect, useRef, useState} from 'react';
import {Card} from '@synergy-network/portal-native/dapp-sdk';
import {inspectSparkNf1MintDraft, MAX_SPARK_MINT_DRAFT_BYTES} from './spark-nf1-draft.js';

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
      setReview({status: 'checked', value: inspectSparkNf1MintDraft(bytes)});
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
    {review.status === 'checked' && <MintDraftSummary value={review.value}/>}
  </Card>;
}

function MintDraftSummary({value}) {
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
    <p>Mint authority and transaction approval require separate verification.</p>
  </section>;
}
