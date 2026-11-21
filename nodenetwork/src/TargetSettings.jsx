import {useEffect, useState} from 'react';
import {WorkspaceIcon} from './WorkspaceUI.jsx';
import {Card, Detail, ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {readTargetSelection, saveTargetSelection, targetSelectionDraft, targetSelectionKey, TargetSelectionChanged} from './target-selection.js';
import {hostCompatibility,requireTargetMode} from './host-compatibility.js';

function initialSelection() {
 try {
  const snapshot = readTargetSelection();
  return {snapshot, target: snapshot.target, error: '', notice: ''};
 } catch (error) {
  return {snapshot: null, target: null, error: error.message, notice: ''};
 }
}

export function useTargetSelection() {
 const [selection, setSelection] = useState(initialSelection);
 const [draft, setDraft] = useState(() => targetSelectionDraft(selection.target));
 const {snapshot} = selection;

 useEffect(() => {
  if (!snapshot) return;
  function checkSavedChoice(event) {
   if (event && event.key !== targetSelectionKey && event.key !== null) return;
   try {
    if (readTargetSelection().raw === snapshot.raw) return;
    throw new TargetSelectionChanged();
   } catch (error) {
    setSelection(current => current.snapshot !== snapshot ? current : {
     snapshot: null, target: null, error: error.message, notice: '',
    });
   }
  }
  window.addEventListener('storage', checkSavedChoice);
  checkSavedChoice();
  return () => window.removeEventListener('storage', checkSavedChoice);
 }, [snapshot]);

 function updateDraft(field, value) {
  setDraft(current => {const next = {...current, [field]: value}; if (current[field] !== value && ['kind', 'host', 'port'].includes(field)) delete next.guest; return next;});
  setSelection(current => ({...current, notice: ''}));
 }

 function loadSavedChoice() {
  try {
   const saved = readTargetSelection();
   setDraft(targetSelectionDraft(saved.target));
   setSelection({snapshot: saved, target: null, error: '',
    notice: saved.target ? 'Saved target loaded into the form. Save the reviewed choice to enable target controls.' : 'The saved choice is monitor-only.',
   });
  } catch (error) {
   setSelection({snapshot: null, target: null, error: error.message, notice: ''});
  }
 }

 function save(compatibility) {
  if (!snapshot) return;
  try {
   requireTargetMode(compatibility,draft.kind);
   const saved = saveTargetSelection(draft, snapshot.raw);
   setDraft(targetSelectionDraft(saved.target));
   setSelection({snapshot: saved, target: saved.target, error: '',
    notice: saved.target ? 'Validator target saved.' : 'Monitor-only mode saved on this device.',
   });
  } catch (error) {
   setSelection(current => error instanceof TargetSelectionChanged
    ? {snapshot: null, target: null, error: error.message, notice: ''}
    : {...current, error: error.message, notice: ''});
  }
 }

 function selectTarget(value) {
  if (!snapshot) throw Error('Reload the saved target selection before changing it.');
  const saved = saveTargetSelection(value, snapshot.raw);
  setDraft(targetSelectionDraft(saved.target));
  setSelection({snapshot: saved, target: saved.target, error: '', notice: 'Validator target saved.'});
 }

 function targetIsCurrent() {
  if (!snapshot || !selection.target) return false;
  try {return readTargetSelection().raw === snapshot.raw;} catch {return false;}
 }

 return {...selection, draft, updateDraft, loadSavedChoice, save, selectTarget, targetIsCurrent};
}

export function TargetSettings({selection, local}) {
 const {target, draft, snapshot, updateDraft, loadSavedChoice, save, error, notice} = selection;
 const compatibility = hostCompatibility(local);
 const monitorOnly = draft.kind === 'monitor';
 return <Card title="Validator target">
  <form onSubmit={event => {event.preventDefault(); save(compatibility);}}>
   <fieldset className="workspace-machine-choices"><legend>Where will your node run?</legend><div className="wf-role-grid">{[
    {kind:'local',label:'This computer',icon:'server',description:'Run on the same machine as NodeNetwork. Requires a qualified Linux x86_64 native controller.',supported:compatibility.local},
    {kind:'remote',label:'Remote machine',icon:'cloud',description:'Manage a remote Linux host through its saved, authenticated SSH identity.',supported:compatibility.remote},
    {kind:'monitor',label:'Monitor public network only',icon:'globe',description:'Observe the selected public endpoint without selecting or contacting a managed host.',supported:true},
   ].map(mode=><button type="button" className={`wf-role ${draft.kind===mode.kind?'selected':''}`} aria-pressed={draft.kind===mode.kind} disabled={!mode.supported} key={mode.kind} onClick={()=>updateDraft('kind',mode.kind)}><span className="wf-role-top"><span className="wf-role-symbol"><WorkspaceIcon name={mode.icon}/></span><span className="wf-radio">{draft.kind===mode.kind&&<WorkspaceIcon name="check" size={13}/>}</span></span><strong>{mode.label}</strong><p>{mode.description}</p><span className="wf-role-note">{mode.supported?'Review before saving':'Unavailable on this platform'}</span></button>)}</div></fieldset>
   {draft.kind === 'remote' && <>
    <label>Remote host
     <input aria-label="Remote validator host" value={draft.host} onChange={event => updateDraft('host', event.target.value)} placeholder="Hostname or IP address" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={253}/>
    </label>
    <label>SSH port
     <input aria-label="Remote validator SSH port" value={draft.port} onChange={event => updateDraft('port', event.target.value)} inputMode="numeric" autoComplete="off" maxLength={5}/>
    </label>
   </>}
   {monitorOnly && target && <p>Saving monitor-only mode detaches the target from Portal. The node keeps running and submitted operations can still finish.</p>}
   <button disabled={!snapshot || (!monitorOnly && !(draft.kind==='local'?compatibility.local:draft.kind==='remote'&&compatibility.remote))}>
    {monitorOnly ? 'Save monitor-only mode' : 'Save validator target'}
   </button>
  </form>
  <ErrorMessage error={error}/>
  {!snapshot && <><p>Load the saved choice to replace the current form and review it before saving.</p><button onClick={loadSavedChoice}>Load saved target choice</button></>}
  {notice && <p role="status">{notice}</p>}
  <Detail data={{target: target?.kind === 'local' ? 'This machine' : target?.host ?? 'Host selection deferred', root: target?.root}}/>
  <p>Managed targets require operator and host authentication and an approved release before installation.</p>
  <p role="status">{compatibility.message}</p>
  {local.error&&local.reload&&<button type="button" onClick={local.reload}>Check native platform compatibility again</button>}
 </Card>;
}
