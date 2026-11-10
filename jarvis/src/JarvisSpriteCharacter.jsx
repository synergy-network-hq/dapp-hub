'use client';

import {useEffect, useRef, useState} from 'react';
import {IconRobot} from '@tabler/icons-react';
import {sheets, frames, frameAt, createAnimationSchedule, keyBackground, removeEdgeFragments} from './sprites.js';

let artwork;
function loadArtwork() {
  if (artwork) return artwork;
  artwork = Promise.all(sheets.map(src => new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => reject(new Error('Jarvis artwork timed out')), 10000);
    image.onload = () => {clearTimeout(timeout); resolve(image);};
    image.onerror = () => {clearTimeout(timeout); reject(new Error('Jarvis artwork unavailable'));};
    image.src = src;
  }))).then(images => {
    const prepared = {};
    for (const [name, [sheet, x, y, width, height]] of Object.entries(frames)) {
      const cell = document.createElement('canvas'); cell.width = width; cell.height = height;
      const context = cell.getContext('2d', {willReadFrequently: true});
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(images[sheet], x, y, width, height, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      keyBackground(pixels.data, width, height); removeEdgeFragments(pixels.data, width, height); context.putImageData(pixels, 0, 0);
      prepared[name] = {cell, scale: sheet === 0 ? .82 : 1.02};
    }
    return prepared;
  }).catch(error => {artwork = undefined; throw error;});
  return artwork;
}

export function JarvisSpriteCharacter({state = 'idle', hovered = false, paused = false, activityId = 0}) {
  const canvas = useRef(null), current = useRef({state, hovered, paused, activityId});
  const restart = useRef(() => {});
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    current.current = {state, hovered, paused, activityId}; restart.current();
  }, [state, hovered, paused, activityId]);
  useEffect(() => {
    let disposed = false, timer, prepared;
    const born = performance.now(), schedule = createAnimationSchedule();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const target = canvas.current, context = target?.getContext('2d');
    if (!context) {setFailed(true); return;}
    function draw() {
      clearTimeout(timer);
      if (disposed || document.hidden || !prepared) return;
      const now = performance.now(), options = current.current;
      const still = reduced.matches || options.paused;
      const {clip, elapsed, sleeping} = schedule(now, {...options, still});
      const name = still ? sleeping ? 'sleep1' : 'idle' : frameAt(clip, elapsed);
      const {cell, scale} = prepared[name];
      context.clearRect(0, 0, 256, 336);
      const breath = still || clip === 'dragging' ? 0 : Math.sin((now - born) / 800) * 1.3;
      const fit = Math.min(scale, 116 / cell.width, 146 / cell.height);
      const width = cell.width * fit, height = cell.height * fit;
      context.drawImage(cell, (128 - width) / 2 * 2, (158 - height + breath) * 2, width * 2, height * 2);
      target.dataset.animation = clip; target.dataset.frame = name;
      target.dataset.ready = 'true';
      if (!still) timer = setTimeout(draw, 1000 / 12);
    }
    restart.current = draw;
    const visibility = () => {clearTimeout(timer); draw();};
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', draw);
    loadArtwork().then(result => {if (!disposed) {prepared = result; draw();}}).catch(() => {if (!disposed) setFailed(true);});
    return () => {disposed = true; clearTimeout(timer); restart.current = () => {}; document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', draw);};
  }, []);
  return <span className="jarvis-character jarvis-sprite-character" aria-hidden="true">{failed ? <IconRobot size={72}/> : <canvas ref={canvas} width={256} height={336}/>}</span>;
}
