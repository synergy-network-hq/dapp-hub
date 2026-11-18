import {useId, useLayoutEffect, useRef, useState} from 'react';
import {inspectSparkNf1SaleEvidence, MAX_SPARK_SALE_EVIDENCE_BYTES} from './spark-nf1-sale-evidence.js';

export function WalletSparkSaleEvidenceReview({draftBytes, isCurrent}) {
  const [review, setReview] = useState({status: 'empty'});
  const input = useRef(null);
  const revision = useRef(0);
  const instructions = useId();
  useLayoutEffect(() => () => {revision.current++;}, []);

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file || !isCurrent()) return;
    const current = ++revision.current;
    const stillCurrent = () => current === revision.current && isCurrent();
    if (file.size > MAX_SPARK_SALE_EVIDENCE_BYTES) {
      setReview({status: 'failed', message: 'The purchase evidence archive exceeds 34 MiB.'});
      return;
    }

    setReview({status: 'reading'});
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (stillCurrent()) setReview({status: 'failed', message: 'The purchase evidence archive could not be read.'});
      return;
    }
    if (!stillCurrent()) return;
    try {
      setReview({status: 'checked', value: inspectSparkNf1SaleEvidence(bytes, draftBytes)});
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
  return <section aria-label="Spark purchase evidence review">
    <p id={instructions}>Choose a Spark public sale evidence archive, up to 34 MiB. The file is checked on this device.</p>
    <label>Spark purchase evidence archive<input ref={input} type="file" accept=".json,application/json"
      aria-describedby={instructions} onChange={chooseFile}/></label>
    {review.status !== 'empty' && <button type="button" onClick={clearFile}>Clear evidence archive</button>}
    {review.status === 'reading' && <p role="status">Reading purchase evidence…</p>}
    {review.status === 'failed' && <p role="alert" className="native-error">{review.message}</p>}
    {value && <>
      <p role="status">The archived RPC records match this purchase draft.</p>
      <dl className="native-details">
        <div><dt>Recorded transaction</dt><dd><code>{value.transactionHash}</code></dd></div>
        <div><dt>Recorded receipt block {value.blockHeight}</dt><dd><code>{value.blockHash}</code></dd></div>
        <div><dt>Recorded network fee</dt><dd>{value.feeNwei} nWei</dd></div>
        <div><dt>Recorded buyer debit</dt><dd>{value.buyerDebitNwei} nWei</dd></div>
        <div><dt>Recorded seller credit</dt><dd>{value.sellerCreditNwei} nWei</dd></div>
        <div><dt>Recorded NFT checkpoint {value.snapshotHeight}</dt><dd><code>{value.snapshotHash}</code></dd></div>
        <div><dt>Reported owner at that checkpoint</dt><dd>{value.buyerReportedAtSnapshot ? 'Draft buyer' : 'Another owner'}</dd></div>
      </dl>
      <p>Results describe the archive’s recorded checkpoints. Current ownership requires a separate check.</p>
    </>}
  </section>;
}
