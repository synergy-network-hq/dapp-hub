import {useState} from 'react';
import {WorkspaceCard} from './WorkspaceUI.jsx';
import {
 networkProfileSchema, networkProfileStoreKey, networkTargetKey,
 readNetworkProfiles, sameNetworkProfile, signedOriginFiles, validateValidatorNetworkProfile,
} from './network-provisioning.js';

const fields = [
 ['profile_id', 'Profile ID'], ['network_name', 'Network name'], ['network_id', 'Network ID'],
 ['chain_id', 'Chain ID'], ['genesis_hash', 'Logical Genesis SHA-256'], ['node_name', 'Node name'],
];
function emptyDraft() {
 return {
  schema: networkProfileSchema, ...Object.fromEntries(fields.map(([key]) => [key, ''])),
  role: 'validator', gateway: null,
  origin: Object.fromEntries(signedOriginFiles.map(name => [name, ''])),
 };
}

export function useNetworkProvisioning(target) {
 const [state, setState] = useState(() => {
  try {
   return {store: readNetworkProfiles(localStorage), error: ''};
  } catch (error) {
   return {store: {profiles: [], selections: {}}, error: error.message};
  }
 });
 const targetKey = networkTargetKey(target);
 const profiles = state.store.profiles.filter(profile => profile.role === 'validator');
 const selected = profiles.find(profile => profile.profile_id === state.store.selections[targetKey]);

 function update(callback) {
  if (state.error) throw Error(state.error);
  const next = callback(readNetworkProfiles(localStorage));
  localStorage.setItem(networkProfileStoreKey, JSON.stringify(next));
  setState({store: next, error: ''});
 }

 function save(profile) {
  validateValidatorNetworkProfile(profile);
  update(store => {
   const remaining = store.profiles.filter(value => value.profile_id !== profile.profile_id);
   if (remaining.length >= 64) throw Error('Remove a saved draft before adding another network profile.');
   const prior = store.profiles.find(value => value.profile_id === profile.profile_id);
   if (prior && prior.role !== 'validator') throw Error('Choose a different profile ID. This ID is reserved.');
   const selections = prior && !sameNetworkProfile(prior, profile)
    ? Object.fromEntries(Object.entries(store.selections).filter(([, id]) => id !== profile.profile_id))
    : store.selections;
   return {profiles: [...remaining, profile], selections};
  });
 }

 function select(profileId) {
  if (!targetKey) throw Error('Save the managed target before selecting its network profile.');
  update(store => {
   if (!store.profiles.some(profile => profile.profile_id === profileId && profile.role === 'validator')) throw Error('Save the profile before assigning it.');
   return {...store, selections: {...store.selections, [targetKey]: profileId}};
  });
 }

 function remove(profileId) {
  update(store => ({
   profiles: store.profiles.filter(value => value.profile_id !== profileId),
   selections: Object.fromEntries(Object.entries(store.selections).filter(([, id]) => id !== profileId)),
  }));
 }

 return {profiles, selected, error: state.error, save, select, remove};
}

export function NetworkProvisioning({profiles, target}) {
 const [draft, setDraft] = useState(emptyDraft);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');

 function change(key, value) {
  setDraft(previous => ({...previous, [key]: value}));
 }

 function edit(profile) {
  setDraft({...profile, chain_id: String(profile.chain_id)});
  setError('');
  setNotice('');
 }

 function run(callback) {
  setError('');
  setNotice('');
  try { callback(); } catch (problem) { setError(problem.message); }
 }

 function draftProfile() {
  if (!/^[1-9][0-9]{0,15}$/.test(draft.chain_id)) throw Error('Enter a positive decimal chain ID.');
  return validateValidatorNetworkProfile({...draft, chain_id: Number(draft.chain_id)});
 }

 async function importProfile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  setError('');
  setNotice('');
  try {
   if (file.size > 16384) throw Error('The public network profile exceeds 16 KiB.');
   edit(validateValidatorNetworkProfile(JSON.parse(await file.text())));
  } catch (problem) { setError(problem.message); }
 }

 function exportProfile() {
  run(() => {
   const url = URL.createObjectURL(new Blob([JSON.stringify(draftProfile(), null, 2) + '\n'], {type: 'application/json'}));
   const link = document.createElement('a');
   link.href = url;
   link.download = 'network-provisioning.json';
   link.click();
   setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
 }

 return <WorkspaceCard title="Network Provisioning">
  <p className="small muted">Select a profile for this target. Native setup verifies its signed network artifacts before installation.</p>
  <label>Saved profiles<select value={profiles.selected?.profile_id ?? ''} disabled={!target || Boolean(profiles.error)}
   onChange={event => run(() => { profiles.select(event.target.value); setNotice('Profile selected for the managed target.'); })}>
   <option value="" disabled>Select a network profile</option>
   {profiles.profiles.map(profile => <option key={profile.profile_id} value={profile.profile_id}>
    {profile.network_name} · {profile.chain_id} · {profile.node_name}
   </option>)}
  </select></label>
  {profiles.selected && <div className="native-actions">
   <button type="button" onClick={() => edit(profiles.selected)}>Edit selected profile</button>
   <button type="button" onClick={() => run(() => { profiles.remove(profiles.selected.profile_id); setNotice('Draft removed from this workspace.'); })}>Remove saved draft</button>
  </div>}
  <label>Import a public profile<input type="file" accept=".json,application/json" onChange={importProfile}/></label>
  <form className="native-grid" onSubmit={event => {
   event.preventDefault();
   run(() => { profiles.save(draftProfile()); setNotice('Profile draft saved.'); });
  }}>
   {fields.map(([key, label]) => <label key={key}>{label}<input value={draft[key]} onChange={event => change(key, event.target.value)} maxLength={128}/></label>)}
   <details>
    <summary>Signed bootstrap and transport artifacts</summary>
    {signedOriginFiles.map(name => <label key={name}>{name} SHA-256<input value={draft.origin[name]} maxLength={64}
     onChange={event => change('origin', {...draft.origin, [name]: event.target.value})}/></label>)}
   </details>
   <div className="native-actions">
    <button type="submit" disabled={Boolean(profiles.error)}>Save profile draft</button>
    <button type="button" onClick={exportProfile}>Export profile</button>
    <button type="button" onClick={() => {setDraft(emptyDraft()); setError(''); setNotice('');}}>New profile</button>
   </div>
  </form>
  {(error || profiles.error) && <p role="alert">{error || profiles.error}</p>}
  {notice && <p role="status">{notice}</p>}
 </WorkspaceCard>;
}
