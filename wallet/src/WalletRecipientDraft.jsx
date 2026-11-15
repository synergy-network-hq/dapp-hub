import {useEffect, useId, useRef, useState} from 'react';
import {amount} from '@synergy-network/dapp-data-view';
import {CONTACT_KEY, matchesReviewedContact, readContacts} from './wallet-contacts.js';
import {canSaveContactAddress, contactAddressProfile} from './wallet-address.js';
import {parseSnrgDraftAmount} from './send-draft-amount.js';
import {WalletDraftBalanceComparison} from './WalletDraftBalanceComparison.jsx';

function contactStillSaved(contact) {
  try {
    return readContacts(localStorage).some(saved => matchesReviewedContact(saved, contact));
  } catch {
    return false;
  }
}

function AmountDraft({contact, account, endpoint, canReview, onInvalidate}) {
  const [input, setInput] = useState('');
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const errorId = useId();
  const reviewCount = useRef(0);

  function reviewDraft(event) {
    event.preventDefault();
    setReview(null);
    setError('');
    if (!canReview()) {
      setError('Wallet draft access is unavailable in this Portal context.');
      return;
    }
    if (!canSaveContactAddress(contact.address) || !contactStillSaved(contact)) {
      onInvalidate(contact);
      return;
    }
    try {
      setReview({nwei: parseSnrgDraftAmount(input), revision: ++reviewCount.current});
    } catch (failure) {
      setError(failure.message);
    }
  }

  return <>
    <form noValidate onSubmit={reviewDraft}>
      <label>Amount (SNRG)<input value={input} autoComplete="off" inputMode="decimal" maxLength={64}
        aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        onChange={event => {
          setInput(event.target.value);
          setReview(null);
          setError('');
        }}/></label>
      {error && <p role="alert" id={errorId}>{error}</p>}
      <button type="submit">Review local draft</button>
    </form>
    {review && <section aria-label="Reviewed local SNRG draft">
      <h4>Local draft review</h4>
      <dl className="native-details">
        <div><dt>Recipient</dt><dd>{contact.address}</dd></div>
        <div><dt>Selected network</dt><dd>{endpoint.name} · Chain {endpoint.chainId}</dd></div>
        <div><dt>Draft amount</dt><dd>{amount(review.nwei)} SNRG</dd></div>
        <div><dt>Exact atomic amount</dt><dd>{review.nwei} nWei</dd></div>
      </dl>
      <p>Input checks are local. Fees, spendable balance and simulation remain unverified.</p>
      <WalletDraftBalanceComparison key={review.revision} account={account} endpoint={endpoint} draftNwei={review.nwei}
        canCompare={() => canReview() && contactStillSaved(contact)}/>
    </section>}
  </>;
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
