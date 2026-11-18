import {nodeNetworkTarget} from './nodeNetwork.js';

export const targetSelectionKey = 'portal-native-v1:nodeNetworkTarget';
const targetFields = new Set(['kind', 'host', 'port', 'root', 'guest']);
const unsupported = 'Saved target settings are unreadable or unsupported. The original record is retained.';

export class TargetSelectionChanged extends Error {
 constructor() {
  super('Saved target settings changed. Load the saved choice before saving these edits.');
 }
}

function decodeTarget(raw) {
 if (raw === null) return null;
 if (raw.length > 4096) throw Error(unsupported);
 try {
  const value = JSON.parse(raw);
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
   || Object.keys(value).some(key => !targetFields.has(key))
   || (value.kind === 'local' && (value.host != null || value.port != null))) {
   throw Error(unsupported);
  }
  return nodeNetworkTarget(value);
 } catch {
  throw Error(unsupported);
 }
}

function readRawTarget(storage) {
 try {
  return (storage ?? localStorage).getItem(targetSelectionKey);
 } catch {
  throw Error('Device storage is unavailable. Load the saved target settings again when storage is accessible.');
 }
}

export function readTargetSelection(storage) {
 const raw = readRawTarget(storage);
 return {raw, target: decodeTarget(raw)};
}

export function saveTargetSelection(draft, expectedRaw, storage) {
 const current = readRawTarget(storage);
 if (current !== expectedRaw) throw new TargetSelectionChanged();
 decodeTarget(current);
 const target = draft.kind === 'monitor' ? null : nodeNetworkTarget(draft);
 const raw = JSON.stringify(target);
 try {
  (storage ?? localStorage).setItem(targetSelectionKey, raw);
 } catch {
  throw Error('Target settings could not be saved. Your current selection and edits are retained.');
 }
 return {raw, target};
}

export function targetSelectionDraft(target) {
 return {kind: target?.kind ?? 'monitor', host: target?.host ?? '', port: String(target?.port ?? 22), ...(target?.guest ? {guest: {...target.guest}} : {})};
}
