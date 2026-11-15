import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseValidatorObservation, readValidatorObservationFile, validatorObservationLimit} from '../src/validator-operations-observation.js';

const fixture = readFileSync(new URL('./fixtures/validator-operations-observation.json', import.meta.url), 'utf-8').trim();
const release = JSON.parse(fixture).release;
const withExpected = expected => `${fixture.slice(0,-1)},"expected_release":${JSON.stringify(expected)}}`;

test('preserves u64 wire integers and projects only allowed saved evidence', () => {
 const data = parseValidatorObservation(fixture);
 assert.equal(data.headHeight, '18446744073709551615');
 assert.equal(data.finalizedHeight, '18446744073709551614');
 assert.equal(data.posyView, '9007199254740993');
 assert.equal(data.releaseMismatches, null);
 assert.equal(data.protectedSource, 'NORMAL_ETDAG_STEADY_STATE');
 assert.deepEqual(data.missingTransition, {
  from:'POSY.QC', to:'POSY.FINALIZED',
  evidence:'The saved PoSy height is 18446744073709551615 and the finalized height is 18446744073709551614.',
 });
 for (const omitted of ['192.0.2.2', 'fixture-hostname', '/fixture/private-path', 'fixture detail excluded', 'fixture-validator-key']) {
  assert.ok(!JSON.stringify(data).includes(omitted));
 }
});

const healthy = () => JSON.parse(fixture.replaceAll('18446744073709551615', '128').replaceAll('18446744073709551614', '128'));
const diagnose = value => parseValidatorObservation(JSON.stringify(value)).missingTransition;

test('finds the first missing service, peer or ProtectedPipeline edge in owner order', () => {
 const value = healthy();
 const {service, peers, posy, protected_pipeline: pipeline} = value;
 service.state = 'FAILED';
 peers.p2p_listener_ready = false;
 peers.authenticated_validator_peer_count = 2;
 pipeline.availability_count = 1;
 pipeline.cutoff_marker_count = 2;
 pipeline.cut_ready = false;
 pipeline.order_ready = false;
 posy.proposal_seen = false;
 assert.equal(diagnose(value).to, 'SERVICE.ACTIVE');
 service.state = 'ACTIVE';
 assert.equal(diagnose(value).to, 'P2P.LISTENING');
 peers.p2p_listener_ready = true;
 assert.match(diagnose(value).evidence, /2 of 3 required/);
 peers.authenticated_validator_peer_count = 4;
 for (const source of ['NORMAL_ETDAG', 'NORMAL_ETDAG_STEADY_STATE']) {
  pipeline.source = source;
  assert.equal(diagnose(value).to, 'PROTECTED_PIPELINE.AVAILABILITY_QUORUM');
 }
 pipeline.availability_count = 4;
 assert.match(diagnose(value).evidence, /Cutoff markers reached 2 of 4 required/);
 pipeline.cutoff_marker_count = 4;
 assert.equal(diagnose(value).to, 'PROTECTED_PIPELINE.CUT_READY');
 pipeline.cut_ready = true;
 assert.equal(diagnose(value).to, 'PROTECTED_PIPELINE.ORDER_READY');
 pipeline.order_ready = true;
 pipeline.consumed = false;
 pipeline.execution_ready = false;
 pipeline.reveal_authorized = false;
 pipeline.parent_commitment = null;
 assert.equal(diagnose(value).to, 'PROTECTED_PIPELINE.COMMITTED_IN_PARENT');
 pipeline.parent_commitment = 'fixture-parent';
 posy.expected_proposer = 'unreviewed-proposer-reference';
 const proposal = diagnose(value);
 assert.equal(proposal.to, 'POSY.PROPOSAL');
 assert.ok(!proposal.evidence.includes(posy.expected_proposer));
});

test('orders VC, reveal, execution and QC and follows the owner Genesis exception', () => {
 const value = healthy();
 const {posy, protected_pipeline: pipeline} = value;
 assert.equal(diagnose(value), null);
 posy.vc_status = 'COLLECTING';
 assert.match(diagnose(value).evidence, /4 of 4 required.*COLLECTING/);
 posy.vc_status = 'FORMED';
 posy.validation_votes = 3;
 assert.equal(diagnose(value).to, 'POSY.VC');
 posy.validation_votes = 4;
 pipeline.consumed = false;
 pipeline.execution_ready = false;
 pipeline.reveal_authorized = false;
 assert.equal(diagnose(value).to, 'PROTECTED_PIPELINE.REVEAL_AUTHORIZED');
 pipeline.reveal_authorized = true;
 pipeline.reveal_share_count = 2;
 assert.match(diagnose(value).evidence, /Reveal shares reached 2 of 4 required/);
 pipeline.reveal_share_count = 4;
 assert.equal(diagnose(value).to, 'PROTECTED_PIPELINE.EXECUTION_READY');
 pipeline.execution_ready = true;
 posy.qc_status = 'REJECTED';
 assert.equal(diagnose(value).to, 'POSY.QC');
 posy.qc_status = 'FORMED';
 posy.finality_votes = 3;
 assert.equal(diagnose(value).to, 'POSY.QC');
 posy.finality_votes = 4;

 pipeline.source = 'GENESIS_BOOTSTRAP';
 pipeline.availability_count = 0;
 pipeline.cutoff_marker_count = 0;
 pipeline.reveal_share_count = 0;
 pipeline.cut_ready = false;
 pipeline.order_ready = false;
 pipeline.reveal_authorized = false;
 pipeline.execution_ready = false;
 assert.equal(diagnose(value).from, 'PROTECTED_PIPELINE.GENESIS_BOOTSTRAP');
 pipeline.execution_ready = true;
 assert.equal(diagnose(value), null);
});

test('reports release comparison as unavailable, matching or differing using the included reference', () => {
 assert.equal(parseValidatorObservation(withExpected(null)).releaseMismatches, null);
 assert.deepEqual(parseValidatorObservation(withExpected(release)).releaseMismatches, []);
 assert.deepEqual(parseValidatorObservation(withExpected({...release, core_revision:'other', genesis_hash:'other'})).releaseMismatches,
  ['core_revision', 'genesis_hash']);
 assert.throws(()=>parseValidatorObservation(withExpected({...release, binary_sha256:'not-a-digest'})), /not a supported/);
});

test('refuses wrong schemas, unknown and duplicate fields, invalid scalar types and inconsistent owner evidence', () => {
 for (const raw of [
  fixture.replace('synergy.validator-operations.v1','synergy.validator-operations.v2'),
  fixture.replace('"head_height":','"seed_material":"fixture", "head_height":'),
  fixture.replace('"head_height":','"head_hei\\u0067ht":0, "head_height":'),
  fixture.replace('"head_height":18446744073709551615','"head_height":"\\u00001"'),
  fixture.replace('"head_height":18446744073709551615','"head_height":18446744073709551616'),
  fixture.replace('"head_height":18446744073709551615','"head_height":1e1'),
  fixture.replace('"head_height":18446744073709551615','"head_height":1'),
  fixture.replace('"reveal_authorized":true','"reveal_authorized":false'),
  fixture.replace('"finality_votes_required":4','"finality_votes_required":0'),
  fixture.replace('"cpu_percent":12.5','"cpu_percent":101'),
 ]) assert.throws(()=>parseValidatorObservation(raw), /not a supported/);
});

test('bounds bytes before reading and refuses unreadable or malformed files', async () => {
 const oversized = {size:validatorObservationLimit+1, arrayBuffer:()=>assert.fail('unexpected file read')};
 await assert.rejects(readValidatorObservationFile(oversized), /at most 1 MiB/);
 assert.throws(()=>parseValidatorObservation('é'.repeat(validatorObservationLimit/2+1)), /at most 1 MiB/);
 const file = new Blob([fixture]);
 assert.equal((await readValidatorObservationFile(file)).headHeight, '18446744073709551615');
 await assert.rejects(readValidatorObservationFile(new Blob([new Uint8Array([255])])), /not a supported/);
 await assert.rejects(readValidatorObservationFile({size:1, arrayBuffer:async()=>new ArrayBuffer(2)}), /could not be read/);
});

const ownerFixturePath = process.env.SYNERGY_VALIDATOR_OPERATIONS_OWNER_FIXTURE;
test('projects the pinned Node Control Panel five-validator fixture observations', {skip:!ownerFixturePath}, () => {
 const ownerFixture = readFileSync(ownerFixturePath, 'utf8');
 const envelope = JSON.parse(ownerFixture);
 const owner = envelope.base_observation;
 assert.throws(()=>parseValidatorObservation(ownerFixture), /not a supported/);
 assert.equal(parseValidatorObservation(JSON.stringify(owner)).headHeight, '128');
 for (const id of envelope.validator_ids) {
  const observation = {...owner, discovery:{...owner.discovery, validator_id:id}};
  if (id === envelope.release_mismatch_validator_id) observation.release = {...owner.release, binary_sha256:'b'.repeat(64)};
  if (id === envelope.first_missing_transition_validator_id) {
   observation.protected_pipeline = {...owner.protected_pipeline, phase:'REVEALING', reveal_share_count:2, execution_ready:false, consumed:false};
  }
  const projected = parseValidatorObservation(JSON.stringify(observation));
  assert.equal(projected.validator, id);
  assert.deepEqual(projected.releaseMismatches, id === envelope.release_mismatch_validator_id ? ['binary_sha256'] : []);
  if (id === envelope.first_missing_transition_validator_id) {
   assert.equal(projected.missingTransition.to, 'PROTECTED_PIPELINE.EXECUTION_READY');
   assert.match(projected.missingTransition.evidence, /Reveal shares reached 2 of 4 required/);
  } else assert.equal(projected.missingTransition, null);
 }
 const {expected_release, ...withoutReference} = owner;
 assert.ok(expected_release);
 assert.equal(parseValidatorObservation(JSON.stringify(withoutReference)).releaseMismatches, null);
});
