import {useEffect, useState} from 'react';
import {Card, Detail, ErrorMessage, ModalDialog} from '@synergy-network/portal-native/dapp-sdk';
import {provisioningChecks} from './nodeNetwork.js';
import {createInstallationReview, installationReviewKey, installationReviewMatches, readInstallationReview, saveInstallationReview} from './installation-review.js';

function loadReview() {
 try {
  return {snapshot: readInstallationReview(), error: ''};
 } catch (error) {
  return {snapshot: null, error: error.message};
 }
}

export function InstallationDraftReview({form}) {
 const [stored, setStored] = useState(loadReview);
 const [staged, setStaged] = useState(null);
 const [saveError, setSaveError] = useState('');
 const [notice, setNotice] = useState('');
 const saved = stored.snapshot?.record;
 const review = staged?.record;
 const valid = provisioningChecks(form).every(check => check.valid);
 const stillCurrent = installationReviewMatches(review, form);
 const sameBaseline = Boolean(staged && stored.snapshot && staged.expectedRaw === stored.snapshot.raw);

 useEffect(() => {
  function onStorage(event) {
   if (event.key !== installationReviewKey && event.key !== null) return;
   setStored(loadReview());
   setNotice('');
  }
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
 }, []);

 function reload() {
  setStored(loadReview());
  setNotice('');
  setSaveError('');
 }

 function save() {
  if (!sameBaseline || !stillCurrent) return;
  try {
   const snapshot = saveInstallationReview(review, staged.expectedRaw);
   setStored({snapshot, error: ''});
   setStaged(null);
   setNotice('Review saved on this device.');
  } catch (error) {
   setSaveError(error.message);
  }
 }

 return <Card title="Installation review record">
  <p>Keep a local record of the exact draft reviewed before host selection. Qualified build, chain identity, host prerequisites and operator approval are verified separately.</p>
  {saved ? <>
   <p role="status">{installationReviewMatches(saved, form)
    ? 'The saved review matches the current draft.'
    : 'The current draft differs from the saved review.'}</p>
   <details>
    <summary>Saved review references</summary>
    <Detail data={{reviewedAt: saved.reviewedAt, installationRoot: saved.installationRoot, ...saved.parameters}}/>
   </details>
  </> : stored.snapshot && <p>No local review has been saved.</p>}
  <ErrorMessage error={stored.error}/>
  {notice && <p role="status">{notice}</p>}
  <div className="native-actions">
   <button disabled={!valid || !stored.snapshot} onClick={() => {
    setSaveError('');
    setNotice('');
    setStaged({record: createInstallationReview(form), expectedRaw: stored.snapshot.raw});
   }}>Review provisioning draft</button>
   <button onClick={reload}>Reload saved installation review</button>
  </div>
  {review && <ModalDialog label="Review provisioning draft" onClose={() => setStaged(null)}>
   <h2>Review provisioning draft</h2>
   <Detail data={{reviewedAt: review.reviewedAt, installationRoot: review.installationRoot, ...review.parameters}}/>
   <p>Saving keeps these references as the latest local review. This record carries no operator signature or target authorization.</p>
   {saved && <p>Saving replaces the previous local review.</p>}
   {!stillCurrent && <p role="status">The draft changed. Close this review and reopen it for the updated fields.</p>}
   {!sameBaseline && <p role="status">The saved review changed. Close this review and reopen it against the saved copy.</p>}
   <ErrorMessage error={saveError}/>
   <div className="native-actions">
    <button data-initial-focus onClick={() => setStaged(null)}>Cancel</button>
    <button disabled={!stillCurrent || !sameBaseline} onClick={save}>Save local review record</button>
   </div>
  </ModalDialog>}
 </Card>;
}
