import {useEffect, useId, useRef, useState} from 'react';
import {amount} from '@synergy-network/dapp-data-view';
import {CONTACT_KEY, matchesReviewedContact, readContacts} from './wallet-contacts.js';
import {canSaveContactAddress, contactAddressProfile, isProtectedWalletAddress} from './wallet-address.js';
import {parseSnrgDraftAmount} from './send-draft-amount.js';
import {WalletDraftBalanceComparison} from './WalletDraftBalanceComparison.jsx';
import {WalletDraftAccountObservation} from './WalletDraftAccountObservation.jsx';
import {WalletDraftFeeSchedule} from './WalletDraftFeeSchedule.jsx';
import {WalletOrdinaryFeeEstimate} from './WalletOrdinaryFeeEstimate.jsx';
import {WalletSynIdRecipient} from './WalletSynIdRecipient.jsx';

function contactStillSaved(contact) {
  try {
    return readContacts(localStorage).some(saved => matchesReviewedContact(saved, contact));
  } catch {
    return false;
  }
}

function AmountDraft({contact, account, endpoint, canReview, onInvalidate}) {
  const [address, setAddress] = useState('');
  const [input, setInput] = useState('');
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [recipientRevision, setRecipientRevision] = useState(0);
  const recipientInput = useRef(null);
  const errorId = useId();
  const isBurn = review !== null && contactAddressProfile(review.recipient) === 'burn';
  const draftRevision = useRef(0);
  const canUseReview = () => review !== null && draftRevision.current === review.revision && canReview() &&
    (!contact || contactStillSaved(contact));

  function clearReview() {
    draftRevision.current++;
    setReview(null);
    setError(null);
  }

  function changeRecipient(value) {
    setAddress(value);
    setRecipientRevision(revision => revision + 1);
    clearReview();
  }

  function useSynIdAddress(value) {
    changeRecipient(value);
    recipientInput.current?.focus();
  }

  function reviewDraft(event) {
    event.preventDefault();
    clearReview();
    if (!canReview()) {
      setError({message: 'Wallet draft access is unavailable in this Portal context.'});
      return;
    }
    const recipient = contact?.address ?? address.trim();
    const validRecipient = canSaveContactAddress(recipient);
    if (contact && (!validRecipient || !contactStillSaved(contact))) {
      onInvalidate(contact);
      return;
    }
    if (!validRecipient) {
      setError({field: 'recipient', message: 'Enter a current Synergy recipient address with its exact checksum.'});
      return;
    }
    try {
      setReview({recipient, nwei: parseSnrgDraftAmount(input), revision: draftRevision.current});
    } catch (failure) {
      setError({field: 'amount', message: failure.message});
    }
  }

  return <>
    <form noValidate onSubmit={reviewDraft}>
      {!contact && <label>Recipient address<input ref={recipientInput} value={address} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100}
        aria-invalid={error?.field === 'recipient'} aria-describedby={error?.field === 'recipient' ? errorId : undefined}
        onChange={event => changeRecipient(event.target.value)}/></label>}
      <label>Amount (SNRG)<input value={input} autoComplete="off" inputMode="decimal" maxLength={64}
        aria-invalid={error?.field === 'amount'} aria-describedby={error?.field === 'amount' ? errorId : undefined}
        onChange={event => { setInput(event.target.value); clearReview(); }}/></label>
      {error && <p role="alert" id={errorId}>{error.message}</p>}
      <button type="submit">Review local draft</button>
    </form>
    {!contact && <WalletSynIdRecipient key={recipientRevision} endpoint={endpoint} canReview={canReview} onUse={useSynIdAddress}/>}
    {review && <section aria-label="Reviewed local SNRG draft">
      <h4>Local draft review</h4>
      <dl className="native-details">
        <div><dt>Recipient</dt><dd>{review.recipient}</dd></div>
        <div><dt>Selected network</dt><dd>{endpoint.name} · Chain {endpoint.chainId}</dd></div>
        <div><dt>Draft amount</dt><dd>{amount(review.nwei)} SNRG</dd></div>
        <div><dt>Exact atomic amount</dt><dd>{review.nwei} nWei</dd></div>
      </dl>
      {!contact && isBurn && <p>Canonical burn address</p>}
      <p>Input checks are local. Fees, spendable balance and simulation remain unverified.</p>
      <WalletDraftBalanceComparison key={review.revision} account={account} endpoint={endpoint} draftNwei={review.nwei}
        canCompare={canUseReview}/>
      {isProtectedWalletAddress(account) && <WalletDraftAccountObservation key={`account:${review.revision}`}
        account={account} endpoint={endpoint} canCheck={canUseReview}
        ordinaryDraftNwei={isBurn ? null : review.nwei}/>}
      {!isBurn && <>
        <WalletDraftFeeSchedule key={`fee:${review.revision}`} endpoint={endpoint} draftNwei={review.nwei} canCheck={canUseReview}/>
        <WalletOrdinaryFeeEstimate key={`estimate:${review.revision}`} endpoint={endpoint} draftNwei={review.nwei} canCheck={canUseReview}/>
      </>}
    </section>}
  </>;
}

export function WalletOneTimeDraft({account, endpoint, canReview}) {
  return <section aria-label="One-time SNRG draft">
    <h3>One-time recipient</h3>
    <p>The recipient stays in this draft.</p>
    <AmountDraft {...{account, endpoint, canReview}}/>
  </section>;
}

export function WalletRecipientDraft({contact, account, endpoint, onClear, onInvalidate, canReview}) {
  const [storedOnOpen] = useState(() => !!contact && contactStillSaved(contact));

  useEffect(() => {
    if (!contact) return;
    if (!storedOnOpen) {
      onInvalidate(contact);
      return;
    }
    function checkSavedContact(event) {
      if (event && event.key !== CONTACT_KEY && event.key !== null) return;
      if (event?.storageArea && event.storageArea !== localStorage) return;
      if (!contactStillSaved(contact)) onInvalidate(contact);
    }
    window.addEventListener('storage', checkSavedContact);
    checkSavedContact();
    return () => window.removeEventListener('storage', checkSavedContact);
  }, [contact, onInvalidate, storedOnOpen]);

  return <section aria-label="Recipient draft">
    <h3>Recipient draft</h3>
    {contact && storedOnOpen ? <>
      <p>{contact.name} · {endpoint.name} · Chain {endpoint.chainId}</p>
      <label>Recipient address<input readOnly value={contact.address}/></label>
      {contactAddressProfile(contact.address) === 'burn' && <p>Canonical burn address</p>}
      <AmountDraft {...{contact, account, endpoint, canReview, onInvalidate}}/>
    </> : <p role="status">The saved contact changed or became unavailable. Review it again in the address book.</p>}
    <button onClick={onClear}>Clear recipient draft</button>
  </section>;
}
