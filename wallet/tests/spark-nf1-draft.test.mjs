import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {inspectSparkNf1Draft, inspectSparkNf1MintDraft, MAX_SPARK_MINT_DRAFT_BYTES} from '../src/spark-nf1-draft.js';
import {mintCollection, mintDraftText, mintFileSha256, mintPayload, mintPayloadSha256, mintSender, mintTimestamp} from './fixtures/spark-nf1-draft.mjs';
import {saleBuyer, saleDraftText, saleExpiry, saleListing, saleNft, salePayloads, salePriceNwei, saleSeller} from './fixtures/spark-nf1-sale-draft.mjs';

const inspect = text => inspectSparkNf1MintDraft(new TextEncoder().encode(text));
const inspectDraft = text => inspectSparkNf1Draft(new TextEncoder().encode(text));
const sha256 = text => createHash('sha256').update(text).digest('hex');

test('checks the pinned Wallet v20 payload in the exact Spark export and hashes original file bytes', () => {
  const text = mintDraftText();
  assert.equal(Buffer.byteLength(text), 1002);
  assert.deepEqual(inspect(text), {
    sha256: mintFileSha256, payloadSha256: mintPayloadSha256, chainId: 1266, network: 'synergy-testnet-v3', sender: mintSender, recipient: mintSender,
    collectionId: mintCollection, mintedAt: mintTimestamp, metadataUri: null, metadataSha3: null,
  });
  const replacement = mintDraftText(mintPayload.replace('1794761001', '1794761002'));
  assert.equal(inspect(replacement).mintedAt, 1794761002);
  assert.notEqual(inspect(replacement).sha256, mintFileSha256);
  assert.notEqual(inspect(replacement).payloadSha256, mintPayloadSha256);
  assert.deepEqual(inspectDraft(text), {action: 'mint', ...inspect(text)});
});

for (const [action, terms] of Object.entries({
  list: {sender: saleSeller, priceNwei: salePriceNwei, expiresAtHeight: String(saleExpiry)},
  cancel: {sender: saleSeller, listingId: saleListing},
  buy: {sender: saleBuyer, listingId: saleListing, expectedSeller: saleSeller, priceNwei: salePriceNwei},
})) {
  test(`preserves the exact unsigned Spark ${action} terms and byte digests`, () => {
    const text = saleDraftText(action);
    assert.deepEqual(inspectDraft(text), {action, sha256: sha256(text), payloadSha256: sha256(salePayloads[action]),
      chainId: 1266, network: 'synergy-testnet-v3', nftId: saleNft, ...terms});
    assert.throws(() => inspect(text), /supported unsigned Spark NF1 mint draft/);
  });
}

test('does not round, coerce or reinterpret original sale price and expiry bytes', () => {
  for (const rawPrice of [`"${salePriceNwei}"`, '0', '-1', '1.0', '1e2', '01', '1,"price_nwei":2',
    (BigInt(salePriceNwei) + 1n).toString(), '9'.repeat(40)]) {
    assert.throws(() => inspectDraft(saleDraftText('buy', salePayloads.buy.replace(salePriceNwei, rawPrice))), /NF1 sale payload/);
  }
  for (const rawExpiry of ['"5451230"', '0', '-1', '5451230.0', '9007199254740992', '1e6']) {
    assert.throws(() => inspectDraft(saleDraftText('list', salePayloads.list.replace(String(saleExpiry), rawExpiry))), /NF1 sale payload/);
  }
  const oneMoreThanSafeInteger = '9007199254740993';
  const text = saleDraftText('list', salePayloads.list.replace(salePriceNwei, oneMoreThanSafeInteger));
  assert.equal(inspectDraft(text).priceNwei, oneMoreThanSafeInteger);
});

test('requires exact sale payload kind, order and counterpart identities', () => {
  for (const [action, payload] of [
    ['cancel', salePayloads.cancel.replace(saleListing, saleListing.toUpperCase())],
    ['cancel', salePayloads.cancel.replace(saleListing, 'a'.repeat(63))],
    ['list', salePayloads.list.replace(saleNft, saleNft.toUpperCase())],
    ['list', salePayloads.list.replace(saleNft, `${saleNft.slice(0, -1)}q`)],
    ['buy', salePayloads.buy.replace(saleSeller, saleBuyer)],
    ['buy', salePayloads.buy.replace(saleSeller, saleSeller.toUpperCase())],
    ['buy', salePayloads.buy.replace(saleSeller, `${saleSeller.slice(0, -1)}q`)],
    ['cancel', salePayloads.cancel.replace('cancel_nft_sale', 'cancel_other_sale')],
    ['cancel', salePayloads.cancel.replace('"data":{"nft_id":', '"data":{"price_nwei":1,"nft_id":')],
    ['cancel', salePayloads.cancel.replace(`"nft_id":"${saleNft}","listing_id":"${saleListing}"`,
      `"listing_id":"${saleListing}","nft_id":"${saleNft}"`)],
    ['buy', mintPayload],
  ]) assert.throws(() => inspectDraft(saleDraftText(action, payload)), /NF1 sale payload/);
  assert.throws(() => inspectDraft(mintDraftText(salePayloads.buy)), /NF1 mint payload/);
  assert.throws(() => inspectDraft(saleDraftText('list', undefined, {transactionHash: 'not-unsigned'})), /supported unsigned Spark NF1 draft/);
  assert.throws(() => inspectDraft(saleDraftText('cancel').trimEnd()), /supported unsigned Spark NF1 draft/);
});

test('requires the exact unsigned Spark version, address, outer shape and bytes', () => {
  for (const changes of [
    {schemaVersion: 2}, {kind: 'spark-sts-nft-sale-draft'}, {chainId: 1264}, {network: 'synergy-mainnet'},
    {status: 'signed'}, {transactionHash: 'syntxn-' + 'a'.repeat(64)}, {sender: mintSender.toUpperCase()},
    {sender: mintSender.slice(0, -1) + 'q'}, {payload_hex: 'abc'}, {payload_hex: 'AB'}, {unknown: true},
  ]) assert.throws(() => inspect(mintDraftText(mintPayload, changes)), /supported unsigned Spark NF1 mint draft/);
  const text = mintDraftText();
  for (const edited of [
    text.trimEnd(), ' ' + text, '\ufeff' + text, text.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'),
    text.replace('"chainId": 1266,\n  "network": "synergy-testnet-v3",', '"network": "synergy-testnet-v3",\n  "chainId": 1266,'),
  ]) assert.throws(() => inspect(edited), /supported unsigned Spark NF1 mint draft/);
});

test('refuses altered, duplicate or unsupported STS fields and encodings', () => {
  for (const payload of [
    mintPayload.replace('synergy-sts-v1:', 'synergy-sts-v2:'),
    mintPayload.replace('"chain_id":1266', '"chain_id":1264'),
    mintPayload.replace('"op":"mint_nft"', '"op":"buy_nft_for_snrg"'),
    mintPayload.replace(mintCollection, mintCollection.slice(0, -1) + 'q'),
    mintPayload.replace(mintSender, 'synw7E5F4552091A69125d5DfCb7b8C2659029395Bdf'),
    mintPayload.replace('"metadata_mutable":false', '"metadata_mutable":true'),
    mintPayload.replace('"transferable":null', '"transferable":false'),
    mintPayload.replace('"requires_issuer_approval":null', '"requires_issuer_approval":true'),
    mintPayload.replace('"expires_at":null', '"expires_at":1794761002'),
    mintPayload.replace('"minted_at":1794761001', '"minted_at":10000000000'),
    mintPayload.replace('"minted_at":1794761001', '"minted_at":1.794761001e9'),
    mintPayload.replace('"minted_at":1794761001', '"minted_at":1794761001,"minted_at":1794761001'),
    mintPayload.replace('"to":', '"unreviewed":"field","to":'),
    mintPayload.replace('"tx":{', '"tx": {'),
  ]) assert.throws(() => inspect(mintDraftText(payload)), /unsupported or noncanonical NF1 mint payload/);
});

test('accepts a paired URI and exact SHA3-256 commitment while rejecting unsafe or incomplete fields', () => {
  const uri = 'ipfs://example-cid/metadata.json';
  const hash = 'de'.repeat(32);
  const metadata = (url, commitment) => mintDraftText(mintPayload.replace(
    '"metadata_uri":null,"metadata_hash":null', '"metadata_uri":' + JSON.stringify(url) + ',"metadata_hash":' + JSON.stringify(commitment),
  ));
  const review = inspect(metadata(uri, hash));
  assert.equal(review.metadataUri, uri);
  assert.equal(review.metadataSha3, hash);
  for (const [url, commitment] of [
    [uri, null], [null, hash], ['javascript:alert(1)', hash], ['https://u:p@example.invalid/file', hash],
    [uri, hash.toUpperCase()], [uri, hash.slice(0, -1) + '\n'], [uri + '\\', hash],
    ['https://example.invalid/' + 'é'.repeat(250), hash], [uri + '\ud800', hash],
  ]) assert.throws(() => inspect(metadata(url, commitment)), /unsupported or noncanonical NF1 mint payload/);
});

test('bounds file and payload bytes and validates UTF-8', () => {
  assert.throws(() => inspectSparkNf1MintDraft(new Uint8Array(MAX_SPARK_MINT_DRAFT_BYTES + 1)), /exceeds 24 KiB/);
  assert.throws(() => inspect(mintDraftText('a'.repeat(4097))), /supported unsigned Spark NF1 mint draft/);
  assert.throws(() => inspectSparkNf1MintDraft(Uint8Array.from([0xff])), /supported unsigned Spark NF1 mint draft/);
  assert.throws(() => inspect(mintDraftText(mintPayload, {payload_hex: 'c0af'})), /unsupported or noncanonical NF1 mint payload/);
});
