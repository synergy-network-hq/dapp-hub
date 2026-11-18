import {useId, useLayoutEffect, useRef, useState} from 'react';
import {compareSparkNf1WalletInspection, MAX_NATIVE_INSPECTION_BYTES} from './spark-nf1-wallet-inspection.js';

export function WalletSparkNativeInspectionReview({draftBytes, isCurrent}) {
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
    if (file.size > MAX_NATIVE_INSPECTION_BYTES) {
      setReview({status: 'failed', message: 'The inspection report exceeds 128 KiB.'});
      return;
    }

    setReview({status: 'reading'});
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (stillCurrent()) setReview({status: 'failed', message: 'The inspection report could not be read.'});
      return;
    }
    if (!stillCurrent()) return;
    try {
      setReview({status: 'checked', value: compareSparkNf1WalletInspection(bytes, draftBytes)});
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
  return <section aria-label="Native Wallet inspection comparison">
    <p id={instructions}>Choose the JSON output of <code>wallet-chain1266-sts inspect</code> for this draft, up to 128 KiB.</p>
    <label>Native Wallet inspection report<input ref={input} type="file" accept=".json,application/json"
      aria-describedby={instructions} onChange={chooseFile}/></label>
    {review.status !== 'empty' && <button type="button" onClick={clearFile}>Clear inspection report</button>}
    {review.status === 'reading' && <p role="status">Reading inspection report…</p>}
    {review.status === 'failed' && <p role="alert" className="native-error">{review.message}</p>}
    {value && <>
      <p role="status">The inspection report matches this unsigned NF1 draft.</p>
      <dl className="native-details">
        <div><dt>Native Wallet gas price limit</dt><dd>{value.maximumGasPriceNwei} nWei per gas</dd></div>
        <div><dt>Native Wallet balance reserve limit</dt><dd>{value.maximumBalanceReserveNwei} nWei</dd></div>
        {value.purchasePriceNwei !== '0' && <div><dt>Purchase price in the report</dt><dd>{value.purchasePriceNwei} nWei</dd></div>}
      </dl>
      <p>Current fees and transaction approval require separate verification.</p>
    </>}
  </section>;
}
