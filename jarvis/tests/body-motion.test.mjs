import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bodyPose, attachedHeadPose} from '../src/body-motion.js';
const states = ['idle','thinking','searching','listening','speaking','working','happy','error','sleeping'];
test('body gestures remain finite, distinct, and animated across all expressions', () => {
  const poses = states.map(state => bodyPose(state, .7));
  assert.equal(new Set(poses.map(JSON.stringify)).size, states.length);
  for (const state of states) {
    for (let t = 0; t < 60; t += .1) assert.ok(Object.values(bodyPose(state,t)).every(Number.isFinite));
    assert.notDeepEqual(bodyPose(state,.2),bodyPose(state,1));
    assert.deepEqual(bodyPose(state,0,true),bodyPose(state,20,true));
  }
  assert.ok(bodyPose('sleeping',0).crouch > 0);
  assert.equal(bodyPose('idle',0).crouch,0);
});
test('attached head cannot hop off its neck or spin away from the torso', () => {
  const original = {yaw: 3.5, pitch: .8, roll: -.4, x: 1, lift: 2, sx: .5, sy: 1.4};
  const p = attachedHeadPose(original);
  assert.equal(p.x,0); assert.equal(p.lift,0); assert.equal(p.sx,1); assert.equal(p.sy,1);
  assert.ok(Math.abs(p.yaw)<=.28 && Math.abs(p.pitch)<=.16 && Math.abs(p.roll)<=.09);
  assert.equal(original.lift,2);
});

test('sleep lowers the body before folding the legs, with hands resting beside it', () => {
  const start = bodyPose('sleeping',0,false,0);
  const lowering = bodyPose('sleeping',.5,false,.5);
  const seated = bodyPose('sleeping',3,false,3);
  assert.equal(start.crouch,0);
  assert.ok(lowering.crouch > 0);
  assert.equal(lowering.leftLeg,0);
  assert.ok(seated.leftLeg > 0 && seated.rightLeg < 0);
  assert.ok(seated.leftKnee < -90 && seated.rightKnee > 90);
  assert.ok(seated.leftArm > 0 && seated.rightArm < 0);
  assert.ok(Math.abs(seated.leftElbow) < 15 && Math.abs(seated.rightElbow) < 15);
  assert.ok(Math.abs(start.leftElbow) < 15 && Math.abs(start.rightElbow) < 15);
});

test('body mesh has finite vertices and real depth on all sides', async () => {
  const {roundedMesh} = await import('../src/robot-body-3d.js');
  const mesh = roundedMesh(38,35,23,6);
  const vertices = mesh.flat();
  assert.ok(vertices.every(v=>[...v.p,...v.n].every(Number.isFinite)));
  assert.ok(vertices.some(v=>v.p[2]>10));
  assert.ok(vertices.some(v=>v.p[2]<-10));
  assert.ok(vertices.some(v=>Math.abs(v.n[0])>.5));
});


test('attached head ignores standalone spins, shakes and antenna impulses', () => {
  const neck = {yaw: .12, pitch: .04, roll: -.03};
  const base = {yaw: 0, pitch: .04, roll: 0, antennaX: .7, antennaZ: -.7};
  const expected = attachedHeadPose(base, neck);
  for (let spin = -8; spin <= 8; spin += .1) {
    assert.deepEqual(attachedHeadPose({...base, yaw: spin, roll: Math.sin(spin)}, neck), expected);
  }
  assert.equal(expected.antennaX, 0);
  assert.equal(expected.antennaZ, 0);
});
