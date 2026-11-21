import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import test from 'node:test';
import {inspectSparkDraft} from '../src/spark-sts-launch-draft.js';
import {mintDraftText} from './fixtures/spark-nf1-draft.mjs';
import {saleDraftText} from './fixtures/spark-nf1-sale-draft.mjs';
import {launchCreator, launchDraftText, launchGoldens, launchImageHash, launchImageUri,
  launchMetadataHash, launchMetadataUri, launchName, launchSymbol, launchCliSupply,
  launchWideNonce, launchWideSupply} from './fixtures/spark-sts-launch-draft.mjs';

const inspect = text => inspectSparkDraft(Buffer.from(text));

test('reviews the exact owner B1 draft and matches the owner-reproduced CLI-v20 wire digest', () => {
  const bytes = Buffer.from(launchDraftText());
  const value = inspectSparkDraft(bytes);
  assert.equal(bytes.length, launchGoldens.cli.size);
  assert.equal(value.action, 'launch');
  assert.equal(value.expectedTokenId, launchGoldens.cli.expectedTokenId);
  assert.equal(value.sha256, launchGoldens.cli.sha256);
  assert.equal(value.payloadSha256, launchGoldens.cli.payloadSha256);
  assert.equal(value.creatorAddress, launchCreator);
  assert.equal(value.name, launchName);
  assert.equal(value.symbol, launchSymbol);
  assert.equal(value.metadataHash, launchMetadataHash);
  assert.equal(value.identityMetadataHash, launchMetadataHash);
  assert.equal(value.metadataUri, null);
  assert.equal(value.nonce, '717001');
  assert.equal(value.supply, launchCliSupply);
  assert.equal(value.createdAt, 1784310000);
  assert.equal(value.exceedsCliV20Supply, false);
});

test('preserves full u128 fixed supply, u64 creator nonce and the owner name-derived ID', () => {
  const bytes = Buffer.from(launchDraftText('wide'));
  const value = inspectSparkDraft(bytes);
  assert.equal(bytes.length, launchGoldens.wide.size);
  assert.equal(value.expectedTokenId, launchGoldens.wide.expectedTokenId);
  assert.equal(value.supply, launchWideSupply);
  assert.equal(value.nonce, launchWideNonce);
  assert.equal(value.sha256, launchGoldens.wide.sha256);
  assert.equal(value.payloadSha256, launchGoldens.wide.payloadSha256);
  assert.equal(value.metadataHash, null);
  assert.equal(value.identityMetadataHash, launchGoldens.wide.identityMetadataHash);
  assert.equal(value.exceedsCliV20Supply, true);
});

test('reviews text-only metadata and image references and keeps the existing NF1 draft kinds', () => {
  const value = inspect(launchDraftText('references'));
  assert.equal(value.sha256, launchGoldens.references.sha256);
  assert.equal(value.payloadSha256, launchGoldens.references.payloadSha256);
  assert.equal(value.metadataUri, launchMetadataUri);
  assert.equal(value.imageUri, launchImageUri);
  assert.equal(value.imageHash, launchImageHash);
  assert.equal(inspect(mintDraftText()).action, 'mint');
  for (const action of ['list', 'cancel', 'buy']) assert.equal(inspect(saleDraftText(action)).action, action);
});

test('rejects contradictory hex copies, original wrapper encoding and a different checksummed token ID', () => {
  const text = launchDraftText();
  assert.throws(() => inspect(launchDraftText('cli', undefined, {expectedTokenId: launchGoldens.wide.expectedTokenId})), /expected token ID/);
  assert.throws(() => inspect(launchDraftText('cli', undefined, {payload_hex: '00'})), /supported unsigned Spark draft/);
  assert.throws(() => inspect(launchDraftText('cli', undefined, {payloadHex: '00', payload_hex: '00'})), /hexadecimal copies disagree/);
  assert.throws(() => inspect(launchDraftText('cli', undefined, {status: 'submitted', transactionHash: 'syntxn-' + 'ab'.repeat(32)})), /supported unsigned Spark draft/);
  for (const altered of [text.trimEnd(), text.replace(/\n/g, '\r\n'), text.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "schemaVersion": 1,')]) {
    assert.throws(() => inspect(altered), /supported unsigned Spark draft/);
  }
});

test('rejects unsupported policy, precision, widths and noncanonical payload even when the three copies agree', () => {
  for (const changes of [
    ['"creator_nonce":18446744073709551615', '"creator_nonce":18446744073709551616'],
    [launchWideSupply, '340282366920938463463374607431768211456'],
    [`"initial_supply":${launchWideSupply}`, '"initial_supply":0'],
    [`"max_supply":${launchWideSupply}`, '"max_supply":9'],
    [`"initial_supply":${launchWideSupply}`, `"initial_supply":"${launchWideSupply}"`],
    ['"can_freeze":false', '"can_freeze":false,"can_mint":true'],
    ['"can_freeze":false', '"can_freeze":true'],
    ['"mint_authority":null', `"mint_authority":"${launchCreator}"`],
    ['"policies":[]', '"policies":["private"]'],
    ['"metadata_mutable":false', '"metadata_mutable":true'],
    ['"class":"b1"', '"class":"b2"'],
    ['"decimals":9', '"decimals":10'],
    ['"symbol":"SPK717"', '"symbol":"SPK717\\n"'],
    ['"version":1', '"version":1,"version":1'],
    ['"op":"create_fungible"', '"op":"transfer_fungible"'],
    ['"created_at":1784310000', '"created_at":1784310000000'],
  ]) {
    assert.throws(() => inspect(launchDraftText('wide', payload => payload.replace(...changes))), /noncanonical B1 launch payload/, changes[0]);
  }
});

test('rejects unsafe or contradictory references and bounds the raw file', () => {
  for (const [before, after] of [
    [launchMetadataUri, 'https://fixture:secret@example.invalid/'],
    [launchMetadataUri, 'https://example.invalid/' + 'z'.repeat(500)],
    [`"metadata_hash":"${launchMetadataHash}"`, '"metadata_hash":null'],
    [launchImageUri, 'https://fixture.invalid/vector.SVG'],
    [`"image_hash":"${launchImageHash}"`, '"image_hash":null'],
  ]) assert.throws(() => inspect(launchDraftText('references', payload => payload.replace(before, after))), /noncanonical B1 launch payload/);
  assert.throws(() => inspectSparkDraft(Buffer.alloc(24 * 1024 + 1)), /exceeds 24 KiB/);
  assert.throws(() => inspectSparkDraft(Buffer.from([0xff, 0xfe])), /supported unsigned Spark draft/);
});
