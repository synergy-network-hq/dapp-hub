// Degrees for articulated joints; all movement stays inside the companion lane.
export function bodyPose(state, seconds, still = false, transitionSeconds = Infinity) {
  const t = still ? 0 : seconds;
  const wave = Math.sin(t * 2.2), slow = Math.sin(t * 1.5);
  const p = {lift: still ? 0 : slow * .8, lean: 0, leftArm: 10, rightArm: -10, leftElbow: -12, rightElbow: 12, leftLeg: 0, rightLeg: 0, leftKnee: 0, rightKnee: 0, crouch: 0};
  switch (state) {
    case 'sleeping': {
      const ease = n => {const x = Math.max(0, Math.min(1,n)); return x*x*(3-2*x);};
      const sit = still ? 1 : ease(transitionSeconds / .9);
      const fold = still ? 1 : ease((transitionSeconds - .65) / 1.1);
      Object.assign(p, {crouch: 14 * sit, lift: slow * .45,
        leftArm: 10, rightArm: -10, leftElbow: -8, rightElbow: 8,
        leftLeg: 55 * fold, rightLeg: -55 * fold,
        leftKnee: -140 * fold, rightKnee: 140 * fold});
      break;
    }
    case 'hearts': Object.assign(p, {lean: slow * 1.2, leftElbow: -25, rightElbow: 25}); break;
    case 'money': Object.assign(p, {leftArm: 18, rightArm: -18, leftElbow: -35, rightElbow: 35}); break;
    case 'cool': Object.assign(p, {lean: -2, leftElbow: -35, rightElbow: 20}); break;
    case 'thinking': Object.assign(p, {lean: -2, rightArm: 65, rightElbow: 105, leftElbow: -35}); break;
    case 'searching': Object.assign(p, {lean: slow * 3, leftArm: 22, leftElbow: -145, rightArm: -18}); break;
    case 'listening': Object.assign(p, {lean: -2, leftElbow: -24, rightElbow: 30 + wave * 5}); break;
    case 'speaking': Object.assign(p, {leftArm: 25 + wave * 12, rightArm: -25 + Math.sin(t * 2.2 + 1.6) * 12, leftElbow: -55 - wave * 20, rightElbow: 55 - wave * 20}); break;
    case 'working': Object.assign(p, {leftArm: -18, rightArm: 18, leftElbow: -85 + wave * 18, rightElbow: 85 + wave * 18}); break;
    case 'happy': Object.assign(p, {lift: still ? 0 : -Math.abs(Math.sin(t * 3)) * 3, leftArm: 45, leftElbow: 120 + Math.sin(t * 5) * 12, rightArm: -30, rightElbow: 35}); break;
    case 'error': Object.assign(p, {lean: wave * 2, leftArm: 38, rightArm: -38, leftElbow: -100, rightElbow: 100}); break;
    default: Object.assign(p, {leftArm: 10 + slow * 3, rightArm: -10 - slow * 3, rightElbow: 15 + wave * 4});
  }
  return p;
}

export function attachedHeadPose(pose, neck = pose) {
  const clamp = (n, limit) => Math.max(-limit, Math.min(limit, n));
  // Use the neck springs before standalone hop/spin/shake effects are added.
  // Wrapping a full spin then clamping it would snap from one limit to the other.
  return {...pose, x: 0, lift: 0, sx: 1, sy: 1,
    yaw: clamp(neck.yaw * .5, .18),
    pitch: clamp(neck.pitch * .7, .16), roll: clamp(neck.roll * .5, .07),
    antennaX: 0, antennaZ: 0};
}
