import {useEffect, useId, useRef, useState} from 'react';
import {Card, ErrorMessage, ModalDialog, useAction} from '@synergy-network/portal-native/dapp-sdk';
import {canSaveContactAddress,contactAddressProfile} from './wallet-address.js';
import {CONTACT_KEY, matchesReviewedContact, readContacts, removeContact, saveContact} from './wallet-contacts.js';

const emptyContact = {name: '', address: ''};

function ContactEditor({original, blocked, onClose, onSave}) {
  const [draft, setDraft] = useState(original ?? emptyContact);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const formId = useId();
  const nameField = useRef(null);
  const addressField = useRef(null);
  const title = original ? 'Edit Wallet contact' : 'Add Wallet contact';

  function change(field, value) {
    setDraft(current => ({...current, [field]: value}));
    setErrors(current => ({...current, [field]: null}));
    setSaveError('');
  }

  function submit(event) {
    event.preventDefault();
    if (blocked) return;
    const nextErrors = {};
    if (!draft.name.trim()) nextErrors.name = 'Enter a contact name.';
    const address = draft.address.trim();
    if (!canSaveContactAddress(address, original?.address)) {
      nextErrors.address = contactAddressProfile(address) === 'legacy'
        ? 'Keep the original saved address or enter a current Synergy address.'
        : 'Enter a current Synergy address with its exact checksum.';
    }
    setErrors(nextErrors);
    setSaveError('');
    if (nextErrors.name || nextErrors.address) {
      (nextErrors.name ? nameField : addressField).current?.focus();
      return;
    }
    try {
      onSave({...draft, original});
    } catch (error) {
      setSaveError(error.message);
    }
  }

  return <ModalDialog label={title} className="wallet-contact-drawer" onClose={onClose}>
    <h2>{title}</h2>
    <form noValidate onSubmit={submit}>
      <label>Contact name<input data-initial-focus ref={nameField} required maxLength={80}
        aria-invalid={!!errors.name} aria-describedby={errors.name ? formId + '-name-error' : undefined}
        value={draft.name} onChange={event => change('name', event.target.value)}/></label>
      {errors.name && <span className="integration-field-error" id={formId + '-name-error'} role="alert">{errors.name}</span>}
      <label>Contact address<input ref={addressField} autoCapitalize="none" spellCheck={false} required maxLength={100}
        aria-invalid={!!errors.address} aria-describedby={errors.address ? formId + '-address-error' : undefined}
        value={draft.address} onChange={event => change('address', event.target.value)}/></label>
      {original && contactAddressProfile(original.address) === 'legacy' &&
        <p>You can keep the saved legacy address when editing this contact.</p>}
      {errors.address && <span className="integration-field-error" id={formId + '-address-error'} role="alert">{errors.address}</span>}
      <ErrorMessage error={blocked || saveError}/>
      <div className="native-actions">
        <button disabled={!!blocked}>{original ? 'Save contact changes' : 'Add contact'}</button>
        <button type="button" onClick={onClose}>{original ? 'Cancel editing' : 'Cancel adding contact'}</button>
      </div>
    </form>
  </ModalDialog>;
}

function ContactRemoval({contact, blocked, onClose, onRemove}) {
  const [removeError, setRemoveError] = useState('');
  function confirm() {
    try {
      onRemove(contact);
    } catch (error) {
      setRemoveError(error.message);
    }
  }
  return <ModalDialog label="Remove Wallet contact" className="integration-dialog" onClose={onClose}>
    <h2>Remove {contact.name}?</h2>
    <p className="account-address">{contact.address}</p>
    <p>This removes the contact from this device’s Wallet address book.</p>
    <ErrorMessage error={blocked || removeError}/>
    <div className="native-actions">
      <button disabled={!!blocked} onClick={confirm}>Confirm remove contact</button>
      <button data-initial-focus onClick={onClose}>Cancel removal</button>
    </div>
  </ModalDialog>;
}

function ContactPreview({contact, onClose, readCurrent, onChanged}) {
  const action = useAction();
  function copy() {
    return action.run(async () => {
      const items = readCurrent();
      if (!items?.some(item => matchesReviewedContact(item, contact))) {
        onChanged();
        return;
      }
      await navigator.clipboard.writeText(contact.address);
    });
  }
  return <Card title="Selected contact">
    <p>{contact.name}</p>
    <p className="account-address">{contact.address}</p>
    {contactAddressProfile(contact.address) === 'legacy' && <p>Saved legacy address. Confirm that the receiving wallet supports this format.</p>}
    <div className="native-actions">
      <button disabled={action.busy} onClick={copy}>Copy address</button>
      <button onClick={onClose}>Close contact preview</button>
    </div>
    <ErrorMessage error={action.error}/>
  </Card>;
}

function openAddressBook() {
  try {
    return {items: readContacts(localStorage), error: ''};
  } catch (error) {
    return {items: [], error: error.message};
  }
}

export function WalletContacts() {
  const [state, setState] = useState(openAddressBook);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [reviewed, setReviewed] = useState(null);
  const addButton = useRef(null);
  const removed = useRef(false);
  const readable = !state.error;

  function applyItems(items) {
    setState({items, error: ''});
    setReviewed(current => items.some(item => matchesReviewedContact(item, current)) ? current : null);
  }

  function refresh() {
    try {
      const items = readContacts(localStorage);
      applyItems(items);
      return items;
    } catch (error) {
      setState(current => ({...current, error: error.message}));
      setReviewed(null);
      setStatus('');
      return null;
    }
  }

  useEffect(() => {
    function storageChanged(event) {
      if (event.key !== CONTACT_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (refresh()) setStatus('Address book updated from another window.');
    }
    window.addEventListener('storage', storageChanged);
    return () => window.removeEventListener('storage', storageChanged);
  }, []);

  useEffect(() => {
    if (!dialog && removed.current) {
      removed.current = false;
      addButton.current?.focus();
    }
  }, [dialog]);

  function save(draft) {
    try {
      applyItems(saveContact(localStorage, draft));
      setDialog(null);
      setStatus('Contact saved.');
    } catch (error) {
      refresh();
      throw error;
    }
  }

  function remove(contact) {
    try {
      applyItems(removeContact(localStorage, contact));
      removed.current = true;
      setDialog(null);
      setStatus('Contact removed.');
    } catch (error) {
      refresh();
      throw error;
    }
  }

  const query = search.trim().toLowerCase();
  const matches = state.items.filter(item => (item.name + ' ' + item.address).toLowerCase().includes(query));
  const dialogContact = dialog?.contact;
  const changed = dialogContact && !state.items.some(item => matchesReviewedContact(item, dialogContact));
  const blocked = state.error || (changed ? 'This saved contact changed. Review the current address book before applying changes.' : '');

  return <>
    <Card title="Contacts">
      <p>Stored on this device for Synergy Testnet v3, chain 1266. A valid checksum does not verify identity.</p>
      <ErrorMessage error={state.error}/>
      {!readable && state.items.length > 0 && <p>Showing the last readable address book. Refresh before using contacts.</p>}
      <div className="native-actions">
        <button ref={addButton} disabled={!readable} onClick={() => setDialog({type: 'add'})}>Add contact</button>
        <button onClick={() => {if (refresh()) setStatus('Address book refreshed.');}}>Refresh address book</button>
      </div>
      <label>Search contacts<input value={search} maxLength={160} onChange={event => setSearch(event.target.value)}/></label>
      {matches.map(contact => <article className="wallet-contact" key={contact.id}>
        <h3>{contact.name}</h3>
        <p className="account-address">{contact.address}</p>
        <div className="contact-actions">
          <button aria-label={'Review address for ' + contact.name} disabled={!readable} onClick={() => {
            const items = refresh();
            if (items?.some(item => matchesReviewedContact(item, contact))) setReviewed(contact);
            else if (items) setStatus('This contact changed. Review the current address before copying.');
          }}>Review address</button>
          <button disabled={!readable} onClick={() => setDialog({type: 'edit', contact})}>Edit {contact.name}</button>
          <button disabled={!readable} onClick={() => setDialog({type: 'remove', contact})}>Remove {contact.name}</button>
        </div>
      </article>)}
      {readable && state.items.length > 0 && !matches.length && <p>No contacts match your search.</p>}
      {readable && !state.items.length && <p>No contacts saved for this network.</p>}
      <p role="status">{status}</p>
    </Card>
    {readable && reviewed && <ContactPreview key={reviewed.id} contact={reviewed}
      onClose={() => setReviewed(null)} readCurrent={refresh}
      onChanged={() => setStatus('This contact changed or became unavailable. Review it again before copying.')}/>}
    {dialog?.type === 'remove' && <ContactRemoval contact={dialogContact} blocked={blocked} onClose={() => setDialog(null)} onRemove={remove}/>}
    {dialog && dialog.type !== 'remove' && <ContactEditor original={dialogContact} blocked={blocked} onClose={() => setDialog(null)} onSave={save}/>}
  </>;
}
