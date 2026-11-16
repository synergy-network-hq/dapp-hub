import {removalRoot} from './offboarding.js';

const scopes = {
 chain_data: 'Chain data', custody: 'Node custody', recovery: 'Recovery data', other: 'Other in-root members',
};
const unsupported = 'The selected controller returned unsupported removal scope evidence.';
const maxMembers = 20_000;
const maxFileBytes = 18_446_744_073_709_551_615n;
const memberCount = value => Number.isSafeInteger(value) && value >= 0 && value <= maxMembers;

export function removalPreflightObservation(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 6
  || value.root !== removalRoot || value.destructive !== true || typeof value.managedAccountRemoval !== 'boolean'
  || value.outsideRootAuditComplete !== false || value.forensicErasureProven !== false
  || !Array.isArray(value.scopes) || value.scopes.length !== Object.keys(scopes).length) throw Error(unsupported);

 const sections = Object.entries(scopes).map(([id, label], index) => {
  const row = value.scopes[index];
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 5 || row.id !== id
   || ![row.files, row.directories, row.sockets].every(memberCount)
   || typeof row.file_bytes !== 'string' || !row.file_bytes.length || row.file_bytes.length > 24
   || /[^0-9]/.test(row.file_bytes) || (row.file_bytes.length > 1 && row.file_bytes.startsWith('0'))
   || BigInt(row.file_bytes) > BigInt(row.files) * maxFileBytes) throw Error(unsupported);
  return {id, label, files:row.files, directories:row.directories, sockets:row.sockets, fileBytes:row.file_bytes};
 });
 const memberCountTotal = sections.reduce((sum, row) => sum + row.files + row.directories + row.sockets, 0);
 if (memberCountTotal > maxMembers) throw Error(unsupported);
 return {root:value.root, accountRemoval:value.managedAccountRemoval, sections, memberCount:memberCountTotal};
}

export function logicalRemovalObservation(value, submitted, target) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 6
  || value.schema !== 'nodenetwork-logical-removal-v1' || value.root !== removalRoot
  || value.root !== submitted?.confirmation || value.root !== target?.root
  || value.logical_removal_verified !== true || value.forensic_erasure_proven !== false
  || value.backup_created !== false || value.remaining_attributed_records !== 0) {
  throw Error('Removal outcome is uncertain. Ask the node operator to reconcile the selected installation before another change.');
 }
 return {root:value.root};
}
