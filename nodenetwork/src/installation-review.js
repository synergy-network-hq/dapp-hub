import {installParameters} from './nodeNetwork.js';

export const installationReviewKey = 'synergy-nodenetwork:installation-review:v1';
const kind = 'nodenetwork-installation-draft-review';
const root = '/opt/synergy';
const fields = ['release_id', 'manifest_sha256', 'network_id', 'chain_id', 'node_name'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exactFields = (value, keys) => object(value) && Object.keys(value).length === keys.length
 && keys.every(key => Object.hasOwn(value, key));
const unsupported = 'Saved installation review is unsupported. The original record is retained.';

function validate(value) {
 if (!exactFields(value, ['version', 'kind', 'scope', 'installationRoot', 'reviewedAt', 'parameters'])
  || value.version !== 1 || value.kind !== kind || value.scope !== 'local-draft'
  || value.installationRoot !== root || typeof value.reviewedAt !== 'string'
  || value.reviewedAt.length > 32 || !Number.isFinite(Date.parse(value.reviewedAt))
  || new Date(value.reviewedAt).toISOString() !== value.reviewedAt
  || !exactFields(value.parameters, fields) || !Number.isSafeInteger(value.parameters.chain_id)) {
  throw Error(unsupported);
 }
 let parameters;
 try {
  parameters = installParameters({...value.parameters, chain_id: String(value.parameters.chain_id)});
 } catch {
  throw Error(unsupported);
 }
 return {...value, parameters};
}

export function createInstallationReview(form, time = Date.now()) {
 return {
  version: 1,
  kind,
  scope: 'local-draft',
  installationRoot: root,
  reviewedAt: new Date(time).toISOString(),
  parameters: installParameters(form),
 };
}

export function installationReviewMatches(record, form) {
 if (!record) return false;
 try {
  const current = installParameters(form);
  return fields.every(field => current[field] === record.parameters?.[field]);
 } catch {
  return false;
 }
}

export function readInstallationReview(storage) {
 let raw;
 try {
  raw = (storage ?? localStorage).getItem(installationReviewKey);
 } catch {
  throw Error('Device storage is unavailable. Reload the installation review when storage is accessible.');
 }
 if (raw === null) return {raw, record: null};
 if (raw.length > 4096) throw Error(unsupported);
 let parsed;
 try {
  parsed = JSON.parse(raw);
 } catch {
  throw Error(unsupported);
 }
 return {raw, record: validate(parsed)};
}

export function saveInstallationReview(record, expectedRaw, storage) {
 // Compare the stored copy before replacing it. Local storage has no atomic compare-and-swap.
 const current = readInstallationReview(storage);
 if (current.raw !== expectedRaw) throw Error('The saved review changed. Reload it before replacing it.');
 const snapshot = validate(record);
 const raw = JSON.stringify(snapshot);
 try {
  (storage ?? localStorage).setItem(installationReviewKey, raw);
 } catch {
  throw Error('The review could not be saved. The previous record and current draft are retained.');
 }
 return {raw, record: snapshot};
}
