import test from 'node:test';
import assert from 'node:assert/strict';
import {lessonContent} from '../src/content.js';

const lesson = block => ({slug: 'synthetic-lesson', title: 'Synthetic lesson', content: [block]});

test('projects the owner checkpoint prompt and excludes assessment choices and answers', () => {
  const value = lessonContent(lesson({
    type: 'quiz-checkpoint',
    prompt: 'Which part of the instruction states its purpose?',
    choices: ['Fixture choice'],
    answer: 'Fixture answer',
    question: 'Older alias',
  }), 'synthetic-lesson');
  assert.deepEqual(value.content, [{
    type: 'quiz-checkpoint',
    question: 'Which part of the instruction states its purpose?',
  }]);
});

test('retains older prompt aliases and bounds the owner checkpoint prompt', () => {
  const parse = block => lessonContent(lesson({type: 'quiz-checkpoint', ...block}), 'synthetic-lesson').content[0];
  assert.equal(parse({question: 'Older question'}).question, 'Older question');
  assert.equal(parse({text: 'Older text'}).question, 'Older text');
  for (const prompt of [' '.repeat(10), 'a'.repeat(16001), 3]) {
    assert.throws(() => parse({prompt, question: 'Older question'}), /unsupported content/);
  }
});
