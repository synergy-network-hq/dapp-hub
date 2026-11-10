import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EXTRA_FACES} from '../src/extra-faces.js';
import {createRobotSchedule, replyExpression} from '../src/robot-state.js';

test('custom face glyphs fit within the LED screen', () => {
  for (const glyphs of Object.values(EXTRA_FACES)) {
    for (const {x,y,rows} of glyphs) {
      assert.ok(x >= 0 && y >= 0);
      assert.ok(y + rows.length <= 16);
      assert.ok(rows.every(row => x + row.length <= 22 && /^[.#]+$/.test(row)));
    }
  }
});
test('contextual replies speak, show the requested face, then return to idle', () => {
  for (const [text,face] of [['Thanks Jarvis!', 'hearts'], ['Show my staking rewards', 'money'], ['That is cool', 'cool']]) {
    const run = createRobotSchedule();
    const state = replyExpression(text);
    assert.equal(state, `reply-${face}`);
    assert.equal(run(0,{state,activityId:1}), 'speaking');
    assert.equal(run(4500,{state,activityId:1}), face);
    assert.equal(run(8000,{state,activityId:1}), 'idle');
    assert.equal(run(61000,{state,activityId:1}), 'sleeping');
  }
  assert.equal(replyExpression('Explain the network'), 'reply');
});
