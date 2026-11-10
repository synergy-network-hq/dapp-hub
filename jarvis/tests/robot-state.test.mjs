import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRobotSchedule, requestExpression, BLUE_ROBOT, GREEN_ROBOT} from '../src/robot-state.js';

test('sleeping head wakes on activity, replies then smiles, and sleeps after inactivity', () => {
 const run = createRobotSchedule();
 assert.equal(run(0), 'sleeping');
 assert.equal(run(100, {state:'attentive', activityId:1}), 'listening');
 assert.equal(run(6000, {state:'attentive', activityId:1}), 'idle');
 assert.equal(run(60101, {state:'attentive', activityId:1}), 'sleeping');
 assert.equal(run(61000, {state:'typing', activityId:2}), 'listening');
 assert.equal(run(62000, {state:'reply', activityId:3}), 'speaking');
 assert.equal(run(66000, {state:'reply', activityId:3}), 'happy');
 assert.equal(run(69000, {state:'reply', activityId:3}), 'idle');
});
test('all nine expressions have contextual triggers; pending work never sleeps', () => {
 const run = createRobotSchedule();
 for(const state of ['thinking','searching','working','error','happy','speaking','listening','sleeping','idle']) {
  const expected = state === 'idle' ? 'idle' : state;
  assert.equal(run(100, {state, activityId:1}), expected);
 }
 assert.equal(requestExpression('Where is Atlas?'), 'searching');
 assert.equal(requestExpression('Connect my wallet'), 'working');
 assert.equal(requestExpression('Explain the network'), 'thinking');
 assert.equal(run(200, {state:'working',activityId:2}), 'working');
 assert.equal(run(120000, {state:'working',activityId:2}), 'working');
});
test('unchanged inputs do not restart a reply and Portal palettes match the request', () => {
 const run = createRobotSchedule();
 assert.equal(run(0, {state:'reply',activityId:1}), 'speaking');
 for(let now=250;now<=6500;now+=250) run(now,{state:'reply',activityId:1});
 assert.equal(run(6501,{state:'reply',activityId:1}), 'idle');
 assert.deepEqual(BLUE_ROBOT,{color:'#a9b9c8',trimColor:'#59caff',screenColor:'#59caff'});
 assert.deepEqual(GREEN_ROBOT,{color:'#a9b9c8',trimColor:'#54efb0',screenColor:'#54efb0'});
});
