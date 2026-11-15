import {blake3} from '@noble/hashes/blake3';
import {bytesToHex} from '@noble/hashes/utils';
import {blockHeight, comparableTransactionHash} from './transaction-observation.js';

const encoder = new TextEncoder();
const isDigest = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/i.test(value);
const maxHashInput = 4_000_000;

function appendU64(hasher, digits, littleEndian) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(digits), littleEndian);
  hasher.update(bytes);
}

// Testnet-v3 chain-1266 release Transaction::raw_hash and Transaction::hash.
function transactionLeaf(row, remainingBytes) {
  if (row?.chain_id !== 1266 || row.network_id !== 'synergy-testnet-v3' ||
      typeof row.sender !== 'string' || !row.sender || row.sender.length > 160 ||
      typeof row.receiver !== 'string' || !row.receiver || row.receiver.length > 160 ||
      (row.data !== null && (typeof row.data !== 'string' || row.data.length > remainingBytes))) return null;
  const amounts = [row.amount, row.nonce, row.timestamp, row.gas_price, row.gas_limit].map(blockHeight);
  if (amounts.includes(null) || [row.sender, row.receiver, row.data].some(text => text && /[\uD800-\uDFFF]/u.test(text))) return null;

  const network = encoder.encode(row.network_id);
  const sender = encoder.encode(row.sender);
  const receiver = encoder.encode(row.receiver);
  const data = row.data === null ? null : encoder.encode(row.data);
  const byteLength = 56 + network.length + sender.length + receiver.length + (data?.length ?? 0);
  if (byteLength > remainingBytes) return null;

  const hasher = blake3.create();
  appendU64(hasher, row.chain_id, false);
  appendU64(hasher, network.length, false);
  hasher.update(network).update(sender).update(receiver);
  for (const digits of amounts) appendU64(hasher, digits, true);
  if (data !== null) hasher.update(data);
  const digest = bytesToHex(hasher.digest());
  const kind = row.data?.startsWith('bridge_transfer:') || row.data?.startsWith('cross_chain:') ? 'synxxn' : 'syntxn';
  for (const field of ['hash', 'tx_hash']) {
    if (!Object.hasOwn(row, field)) continue;
    const supplied = comparableTransactionHash(row[field]);
    if (supplied?.kind !== kind || supplied.digest !== digest) return null;
  }
  return {digest, kind, byteLength};
}

// Block::compute_merkle_root hashes pairs of hexadecimal leaves and promotes the last odd leaf.
function transactionRoot(digests) {
  if (!digests.length) return bytesToHex(blake3(new Uint8Array()));
  while (digests.length > 1) {
    const next = [];
    for (let index = 0; index < digests.length; index += 2) {
      const left = digests[index];
      const right = digests[index + 1];
      next.push(right === undefined ? left : bytesToHex(blake3(encoder.encode(left + right))));
    }
    digests = next;
  }
  return digests[0];
}

export function nativeBlockMembership(block, transactionHash, receiptIndex) {
  const selected = comparableTransactionHash(transactionHash);
  const rows = block.transactions;
  if (!selected?.kind || !isDigest(block.transactions_root) || !Array.isArray(rows) || rows.length > 10_000 ||
      blockHeight(block.tx_count) !== String(rows.length)) return 'unsupported';

  let remainingBytes = maxHashInput;
  const digests = [];
  let selectedIndex = -1;
  let matches = 0;
  for (const [index, row] of rows.entries()) {
    const leaf = transactionLeaf(row, remainingBytes);
    if (!leaf) return 'unsupported';
    digests.push(leaf.digest);
    remainingBytes -= leaf.byteLength;
    if (leaf.kind === selected.kind && leaf.digest === selected.digest) {
      selectedIndex = index;
      matches++;
    }
  }
  if (transactionRoot(digests) !== block.transactions_root.toLowerCase()) return 'rootMismatch';
  if (matches === 0) return 'notListed';
  if (matches > 1) return 'ambiguous';
  return receiptIndex === null || receiptIndex === String(selectedIndex) ? 'listed' : 'indexMismatch';
}
