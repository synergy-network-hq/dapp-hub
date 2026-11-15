import {useEffect, useState} from 'react';
import {CONTACT_KEY, matchesReviewedContact, readContacts} from './wallet-contacts.js';
import {contactAddressProfile} from './wallet-address.js';

function contactStillSaved(contact) {
  try {
    return readContacts(localStorage).some(saved => matchesReviewedContact(saved, contact));
  } catch {
    return false;
  }
}

export function WalletRecipientDraft({contact, endpoint, onClear, onInvalidate}) {
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
    </> : <p role="status">The saved contact changed or became unavailable. Review it again in the address book.</p>}
    <button onClick={onClear}>Clear recipient draft</button>
  </section>;
}
