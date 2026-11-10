// The supplied sheets are not regular grids. These hand-selected cells avoid
// neighboring poses and retain the source artwork at its original resolution.
export const sheets = [new URL('./assets/jarvis-poses.png', import.meta.url).href, new URL('./assets/jarvis-expressions.png', import.meta.url).href];
export const frames = {
  idle: [0, 10, 2, 122, 175], blink: [0, 255, 2, 120, 175], wink: [0, 489, 2, 122, 175],
  wave1: [0, 139, 180, 135, 184], wave2: [0, 270, 180, 142, 184], wave3: [0, 410, 180, 135, 184],
  hello: [0, 948, 180, 131, 184],
  look: [0, 830, 716, 115, 169],
  ponder1: [0, 10, 882, 132, 177], ponder2: [0, 146, 882, 123, 177],
  sit: [0, 420, 1054, 146, 178], sleep1: [0, 140, 1054, 138, 178], sleep2: [0, 278, 1054, 150, 178],
  smile: [1, 203, 0, 97, 142], nod: [1, 302, 0, 99, 142],
  listen: [1, 0, 440, 138, 140], curious: [1, 244, 440, 99, 140],
  thinking: [1, 302, 292, 98, 140],
  carry: [1, 444, 727, 138, 143],
  happy: [1, 498, 0, 99, 142], heart: [1, 596, 0, 102, 142],
  hearts: [1, 699, 0, 100, 142], proud: [1, 0, 148, 100, 140],
  cool: [1, 498, 148, 99, 140], shy: [1, 397, 292, 101, 140],
};
export const clips = {
  idle: [['idle', 2800], ['blink', 130], ['idle', 2600], ['wink', 160], ['idle', 1400]],
  greeting: [['wave1', 180], ['wave2', 170], ['wave3', 170], ['wave2', 170], ['wave1', 190], ['idle', 800]],
  hello: [['hello', 700], ['wink', 220], ['idle', 1500]],
  cheerful: [['smile', 500], ['happy', 650], ['nod', 500], ['idle', 1500]],
  affectionate: [['heart', 650], ['hearts', 650], ['smile', 600], ['idle', 1100]],
  looking: [['idle', 1500], ['look', 1000], ['blink', 160], ['idle', 1500]],
  pondering: [['idle', 1000], ['ponder1', 650], ['ponder2', 650], ['idle', 1400]],
  confident: [['proud', 1100], ['cool', 900], ['idle', 1600]],
  bashful: [['shy', 900], ['curious', 700], ['idle', 1400]],
  attentive: [['listen', 2600], ['idle', 220], ['listen', 1800]],
  typing: [['ponder1', 800], ['ponder2', 500], ['ponder1', 700]],
  thinking: [['ponder1', 600], ['thinking', 750], ['ponder2', 600]],
  reply: [['smile', 500], ['nod', 400], ['smile', 600], ['idle', 400]],
  error: [['curious', 1400], ['idle', 600]],
  dragging: [['carry', 1000]],
  sleep: [['sit', 600], ['sleep1', 2500], ['sleep2', 2000], ['sleep1', 2200]],
};
export function frameAt(clip, elapsed) {
  // Sitting is a one-time transition; sleeping never loops back to awake.
  const sequence = clip === 'sleep' && elapsed >= 600 ? clips.sleep.slice(1) : clips[clip] || clips.idle;
  if (clip === 'sleep' && elapsed >= 600) elapsed -= 600;
  let time = elapsed % sequence.reduce((sum, [, duration]) => sum + duration, 0);
  for (const [name, duration] of sequence) {if (time < duration) return name; time -= duration;}
  return sequence[0][0];
}
export const SLEEP_AFTER = 60000;
const variants = {
  idle: ['idle', 'looking', 'pondering', 'cheerful', 'confident', 'bashful'],
  greeting: ['greeting', 'hello', 'cheerful', 'affectionate', 'confident'],
  attentive: ['attentive', 'looking', 'cheerful', 'hello', 'bashful'],
  typing: ['typing', 'pondering', 'attentive'],
  thinking: ['thinking', 'typing', 'pondering'],
  reply: ['reply', 'cheerful', 'affectionate', 'confident', 'hello'],
  error: ['error', 'bashful', 'pondering'],
};
export function clipDuration(name) {
  return (clips[name] || clips.idle).reduce((sum, [, duration]) => sum + duration, 0);
}
// Shuffle bags exhaust every expression in a family before reusing one. The
// scheduler owns inactivity time, so animation itself never counts as activity.
export function createAnimationSchedule(random = Math.random) {
  const bags = new Map(), previous = new Map();
  let key, lastActivity = 0, active = '', started = 0;
  function choose(family) {
    const choices = variants[family] || [family];
    let bag = bags.get(family);
    if (!bag?.length) {
      bag = [...choices];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag.at(-1) === previous.get(family)) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      bags.set(family, bag);
    }
    const next = bag.pop(); previous.set(family, next); return next;
  }
  return (now, {state = 'idle', hovered = false, activityId = 0, still = false} = {}) => {
    const nextKey = `${state}:${hovered}:${activityId}`;
    const changed = key !== nextKey;
    if (changed) {key = nextKey; lastActivity = now;}
    const sleep = state === 'sleep' || (state !== 'dragging' && state !== 'thinking' && now - lastActivity >= SLEEP_AFTER);
    const family = sleep ? 'sleep' : changed && hovered && state === 'idle' ? 'greeting' : state;
    if (still) return {clip: 'idle', elapsed: 0, sleeping: sleep};
    if (sleep) {
      if (active !== 'sleep') {active = 'sleep'; started = now;}
    } else if (changed || !active || active === 'sleep' || now - started >= clipDuration(active)) {
      active = choose(family); started = now;
    }
    return {clip: active, elapsed: now - started, sleeping: sleep};
  };
}

// Key only border-connected darkness. Enclosed black visor/shirt pixels stay
// opaque; a global black color key would erase Jarvis's face and clothing.
export function keyBackground(data, width, height) {
  const count = width * height, seen = new Uint8Array(count), queue = new Int32Array(count);
  let start = 0, end = 0;
  const visit = index => {
    if (seen[index]) return;
    seen[index] = 1;
    const at = index * 4, value = Math.max(data[at], data[at + 1], data[at + 2]);
    if (value <= 34) queue[end++] = index;
  };
  for (let x = 0; x < width; x++) {visit(x); visit((height - 1) * width + x);}
  for (let y = 0; y < height; y++) {visit(y * width); visit(y * width + width - 1);}
  while (start < end) {
    const index = queue[start++], x = index % width, at = index * 4;
    const value = Math.max(data[at], data[at + 1], data[at + 2]);
    data[at + 3] = Math.round(Math.max(0, (value - 14) / 20) * 255);
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < count - width) visit(index + width);
  }
  return data;
}

// Tiny components touching a cell edge are slivers of neighboring sprites.
// Keep the complete character and detached decorations inside the cell.
export function removeEdgeFragments(data, width, height) {
  const seen = new Uint8Array(width * height);
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || data[i * 4 + 3] < 64) continue;
    const queue = [i], component = []; seen[i] = 1; let edge = false;
    for (let at = 0; at < queue.length; at++) {
      const index = queue[at], x = index % width, y = Math.floor(index / width);
      component.push(index);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || data[next * 4 + 3] < 64) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    if (edge && component.length < 300) for (const index of component) data[index * 4 + 3] = 0;
  }
  return data;
}
