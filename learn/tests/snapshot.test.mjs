import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurriculumSnapshot, MAX_SNAPSHOT_BYTES, parseCurriculumSnapshot, readCurriculumSnapshot} from '../src/snapshot.js';

const revision = '0'.repeat(40);
const published = 'published';
const seed = {
  paths: [
    {slug: 'selected-path', title: 'Selected path', publishState: published},
    {slug: 'draft-path', title: 'Draft path', publishState: 'draft'},
  ],
  modules: [
    {slug: 'selected-module', pathSlug: 'selected-path', publishState: published},
    {slug: 'draft-parent-module', pathSlug: 'draft-path', publishState: published},
    {slug: 'draft-module', pathSlug: 'selected-path', publishState: 'draft'},
  ],
  lessons: [
    {
      slug: 'selected-lesson', moduleSlug: 'selected-module', publishState: published, title: 'Selected lesson',
      content: [
        {type: 'source-note', title: 'Source', source: 'Fixture reference', text: 'Fixture explanation.'},
        {type: 'concept-map', title: 'Concept map', nodes: ['Fixture node'], edges: ['Fixture edge']},
        {type: 'manifest', title: 'Manifest', fields: {intent: 'Fixture intent'}},
        {type: 'quiz-checkpoint', prompt: 'What is the user trying to do?', answer: 'Fixture answer', choices: ['Fixture choice']},
      ],
    },
    {slug: 'draft-parent-lesson', moduleSlug: 'draft-parent-module', publishState: published},
    {slug: 'draft-module-lesson', moduleSlug: 'draft-module', publishState: published},
    {slug: 'draft-lesson', moduleSlug: 'selected-module', publishState: 'draft'},
  ],
  quizzes: [{answer: 'Fixture quiz answer'}],
};

test('exports only reading blocks from lessons with published ancestors and opens the file', async () => {
  const snapshot = createCurriculumSnapshot(seed, revision);
  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /draft-|Fixture answer|Fixture choice|Fixture quiz answer/);
  const result = await readCurriculumSnapshot(new Blob([json]));
  assert.equal(result.sourceRevision, revision);
  assert.deepEqual(result.catalog.paths.map(path => path.slug), ['selected-path']);
  assert.deepEqual(result.catalog.lessons.map(lesson => lesson.slug), ['selected-lesson']);
  const blocks = result.lessons.get('selected-lesson').content;
  assert.deepEqual(blocks[0], seed.lessons[0].content[0]);
  assert.deepEqual(blocks[1], seed.lessons[0].content[1]);
  assert.deepEqual(blocks[2], seed.lessons[0].content[2]);
  assert.deepEqual(blocks[3], {type: 'quiz-checkpoint', question: 'What is the user trying to do?'});
});

test('refuses snapshots with missing or mismatched catalog entries and enforces byte bounds', async () => {
  const valid = createCurriculumSnapshot(seed, revision);
  assert.throws(() => parseCurriculumSnapshot(JSON.stringify({...valid, lessons: []})), /differs from its catalog/);
  const mismatched = {...valid, lessons: [{...valid.lessons[0], title: 'Different title'}]};
  assert.throws(() => parseCurriculumSnapshot(JSON.stringify(mismatched)), /differs from its catalog/);
  assert.throws(() => parseCurriculumSnapshot(JSON.stringify({...valid, sourceRevision: 'main'})), /version 1/);
  assert.throws(() => parseCurriculumSnapshot('sensitive malformed file'), {message: 'The snapshot is not readable JSON.'});
  await assert.rejects(readCurriculumSnapshot(new Blob([new Uint8Array([255])])), /read as UTF-8/);
  await assert.rejects(readCurriculumSnapshot(new Blob(['a'.repeat(MAX_SNAPSHOT_BYTES + 1)])), /2 MB or less/);
});
