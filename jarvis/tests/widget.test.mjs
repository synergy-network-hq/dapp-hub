import test from 'node:test';
import assert from 'node:assert/strict';
import {boundPoint, anchoredPoint, pointAnchor, boundPanel, besideCharacter, CHARACTER, attachedChat} from '../src/geometry.js';
import {createPresetResponder} from '../src/preset.js';
import {frames, clips, frameAt, createAnimationSchedule, SLEEP_AFTER, keyBackground, removeEdgeFragments} from '../src/sprites.js';

test('character and chat fit desktop, narrow screens, and resized windows', () => {
  for (const [width, height] of [[1440, 960], [1920, 1080], [390, 844], [360, 640], [280, 220]]) {
    const point = anchoredPoint(null, width, height, width <= 800 ? 104 : 24);
    assert.ok(point.x >= 8 && point.y >= 8);
    assert.ok(point.x + CHARACTER.width <= width - 8 && point.y + CHARACTER.height <= height - 8);
    const panel = besideCharacter(point, null, width, height);
    assert.ok(panel.x >= 8 && panel.y >= 8 && panel.x + panel.w <= width - 8 && panel.y + panel.h <= height - 8);
    if (height >= 640) assert.ok(panel.x + panel.w < point.x || panel.y + panel.h < point.y, 'Chat stays beside or above the character');
  }
  const point = boundPoint({x: -100, y: Infinity}, 800, 600);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.deepEqual(anchoredPoint(pointAnchor({x: 20, y: 40}, 800, 600), 1600, 1200), {x: 20, y: 40});
  assert.equal(boundPanel({h: NaN}, 300, 200).h, 184);
});
test('all timed clips use bounded source cells and loop without missing frames', () => {
  for (const [sheet, x, y, width, height] of Object.values(frames)) {
    const bounds = sheet ? [1122, 1402] : [1086, 1448];
    assert.ok(x >= 0 && y >= 0 && x + width <= bounds[0] && y + height <= bounds[1]);
  }
  for (const [name, clip] of Object.entries(clips)) {
    const duration = clip.reduce((sum, [frame, ms]) => {assert.ok(frames[frame]); assert.ok(ms > 0); return sum + ms;}, 0);
    if (name !== 'sleep') assert.equal(frameAt(name, 0), frameAt(name, duration));
    for (let time = 0; time < duration * 2; time += 17) assert.ok(frames[frameAt(name, time)]);
  }
});
test('autonomous expressions vary, sleep stays asleep, and interaction wakes immediately', () => {
  const schedule = createAnimationSchedule(() => .3), autonomous = new Set();
  for (let now = 0; now < SLEEP_AFTER; now += 100) autonomous.add(schedule(now).clip);
  assert.ok(autonomous.size >= 6, 'Idle runs all six expression sequences without hover');
  assert.equal(schedule(SLEEP_AFTER).clip, 'sleep');
  assert.equal(schedule(SLEEP_AFTER + 100000).clip, 'sleep');
  for (let time = 600; time < 100000; time += 137) assert.ok(['sleep1', 'sleep2'].includes(frameAt('sleep', time)));
  assert.notEqual(schedule(SLEEP_AFTER + 100100, {hovered: true}).clip, 'sleep');
  const greetings = [];
  for (let i = 1; i <= 15; i++) greetings.push(schedule(SLEEP_AFTER + 100100 + i, {hovered: true, activityId: i}).clip);
  for (let i = 1; i < greetings.length; i++) assert.notEqual(greetings[i], greetings[i - 1]);
  for (let i = 0; i < greetings.length; i += 5) assert.equal(new Set(greetings.slice(i, i + 5)).size, 5);
});
test('an open but inactive chat falls asleep and typing wakes it; reduced motion stays stationary', () => {
  const schedule = createAnimationSchedule(() => .7);
  schedule(0, {state: 'attentive'});
  assert.equal(schedule(SLEEP_AFTER, {state: 'attentive'}).clip, 'sleep');
  assert.notEqual(schedule(SLEEP_AFTER + 1, {state: 'typing', activityId: 1}).clip, 'sleep');
  assert.deepEqual(schedule(SLEEP_AFTER + 2, {state: 'thinking', still: true}), {clip: 'idle', elapsed: 0, sleeping: false});
});
test('background transparency does not punch through the enclosed dark visor', () => {
  const pixels = new Uint8ClampedArray(7 * 7 * 4);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const i = (y * 7 + x) * 4;
    const ring = x >= 1 && x <= 5 && y >= 1 && y <= 5 && (x === 1 || x === 5 || y === 1 || y === 5);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = ring ? 200 : 0; pixels[i + 3] = 255;
  }
  keyBackground(pixels, 7, 7);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(3 * 7 + 3) * 4 + 3], 255);
  assert.equal(pixels[(1 * 7 + 1) * 4 + 3], 255);
});

test('attached popup reserves the character lane through moving, resizing, and narrow screens',()=>{
 for(const [width,height] of [[1440,960],[1920,1080],[390,844],[280,220]]) {
  for(const rect of [{x:9999,y:9999,w:9999,h:9999},{x:-10,y:-10,w:380,h:440}]) {
   const {panel,point}=attachedChat(rect,width,height);
   assert.equal(point.x,panel.x+panel.w+12);
   assert.ok(point.x+128<=width-8 && point.y+168<=height-8);
   assert.ok(panel.x>=8 && panel.y>=8 && panel.y+panel.h<=height-8);
  }
 }
});

test('preview replies are varied, topic-specific, and respect cancellation',async()=>{
 const reply=createPresetResponder();
 assert.match(await reply('How do I connect my wallet?'), /Connect Wallet/);
 assert.notEqual(await reply('hello'),await reply('hello'));
 assert.match(await reply('keep my recovery phrase safe'), /private|share/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(reply('hello',{signal:controller.signal}), {name:'AbortError'});
});

test('neighboring edge fragments are removed without erasing the character or internal decorations',()=>{
 const pixels=new Uint8ClampedArray(30*30*4);
 for(let y=5;y<25;y++)for(let x=5;x<25;x++)pixels[(y*30+x)*4+3]=255;
 for(let y=10;y<14;y++)pixels[(y*30)*4+3]=255;
 pixels[(2*30+15)*4+3]=255;
 removeEdgeFragments(pixels,30,30);
 assert.equal(pixels[(12*30)*4+3],0);
 assert.equal(pixels[(15*30+15)*4+3],255);
 assert.equal(pixels[(2*30+15)*4+3],255);
});
