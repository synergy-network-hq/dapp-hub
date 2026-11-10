'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {IconX, IconExternalLink, IconArrowsMaximize, IconGripVertical, IconArrowsDiagonal, IconMinus} from '@tabler/icons-react';
import {JarvisCharacter} from './JarvisCharacter.jsx';
import {JarvisChat, readPreference, savePreference, startNewConversation} from './JarvisChat.jsx';
import {CHARACTER, boundPoint, boundPanel, pointAnchor, anchoredPoint, besideCharacter, attachedChat} from './geometry.js';

export function JarvisWidget({onSend, onOpenPage, onPopOut, hidden = false, storageKey = 'jarvis', messagePrefix = `${storageKey}-message:`, accent = '#47cfff', welcome, serviceLabel, mobileBottomOffset = 24, robotTheme, characterStyle = 'robot', paused = false}) {
  const [open, setOpen] = useState(false), [point, setPoint] = useState(null), [panel, setPanel] = useState(null);
  const [activityId, setActivityId] = useState(0), [hovered, setHovered] = useState(false), [state, setState] = useState('idle');
  const [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const gesture = useRef(null), moved = useRef(false), launcher = useRef(null), popup = useRef(null), anchor = useRef(null), reactionTimer = useRef(null), openRef = useRef(open);
  openRef.current = open;
  const panelId = useId();
  const prefix = `${storageKey}-character`;
  useEffect(() => {
    anchor.current = readPreference(`${prefix}-anchor`, null);
    setPoint(anchoredPoint(anchor.current, innerWidth, innerHeight, innerWidth <= 800 ? mobileBottomOffset : 24));
    setPanel(boundPanel(readPreference(`${prefix}-panel`, null), innerWidth, innerHeight));
    const resize = () => {
      const next = anchoredPoint(anchor.current, innerWidth, innerHeight, innerWidth <= 800 ? mobileBottomOffset : 24);
      if (openRef.current) setPanel(old => {const pair = attachedChat(besideCharacter(next, old, innerWidth, innerHeight), innerWidth, innerHeight); setPoint(pair.point); return pair.panel;});
      else setPoint(next);
    };
    window.addEventListener('resize', resize);
    return () => {window.removeEventListener('resize', resize); clearTimeout(reactionTimer.current);};
  }, [prefix, mobileBottomOffset]);
  useEffect(() => {if (open && !hidden) popup.current?.querySelector('input')?.focus();}, [open, hidden]);
  useEffect(() => {if (hidden) {setOpen(false); setHovered(false); setState('idle'); gesture.current = null; setDragging(false);}}, [hidden]);
  const activity = next => {
    clearTimeout(reactionTimer.current); setState(next); setActivityId(value => value + 1);
  };
  const applyPanel = rect => {
    const pair = attachedChat(rect, innerWidth, innerHeight);
    setPanel(pair.panel); setPoint(pair.point);
    anchor.current = pointAnchor(pair.point, innerWidth, innerHeight);
    savePreference(`${prefix}-panel`, pair.panel);
  };
  useEffect(()=>{const quick=()=>{if(!hidden&&!open){applyPanel(besideCharacter(point,panel,innerWidth,innerHeight));activity('attentive');setOpen(true);}};window.addEventListener('portal-jarvis-quick',quick);return()=>window.removeEventListener('portal-jarvis-quick',quick);},[hidden,open,point,panel]);
  const place = next => {
    if (open) applyPanel(besideCharacter(next, panel, innerWidth, innerHeight));
    else {
      anchor.current = pointAnchor(next, innerWidth, innerHeight);
      savePreference(`${prefix}-anchor`, anchor.current); setPoint(next);
    }
  };
  const close = () => {
    setActivityId(value => value + 1); setOpen(false); clearTimeout(reactionTimer.current); setState('idle');
    anchor.current = null; savePreference(`${prefix}-anchor`, null);
    setPoint(anchoredPoint(null, innerWidth, innerHeight, innerWidth <= 800 ? mobileBottomOffset : 24));
    launcher.current?.focus();
  };
  const start = (event, kind) => {
    if (event.button !== 0 || (kind === 'panel' && event.target.closest('button'))) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    gesture.current = {kind, x: event.clientX, y: event.clientY, point, panel};
  };
  const move = event => {
    const g = gesture.current; if (!g) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) moved.current = true;
    if (!moved.current) return;
    if (g.kind === 'character') {if (!g.carried) {g.carried = true; setActivityId(value => value + 1); clearTimeout(reactionTimer.current);}
      setDragging(true); place(boundPoint({x: g.point.x + dx, y: g.point.y + dy}, innerWidth, innerHeight));}
    else applyPanel(g.kind === 'resize' ? {...g.panel, w: g.panel.w + dx, h: g.panel.h + dy} : {...g.panel, x: g.panel.x + dx, y: g.panel.y + dy});
  };
  const end = event => {
    if (event?.type === 'pointercancel') moved.current = true;
    if (gesture.current?.carried) setActivityId(value => value + 1);
    gesture.current = null; setDragging(false);
    if (panel) savePreference(`${prefix}-panel`, panel);
  };
  const keyboard = (event, kind) => {
    const delta = {ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16]}[event.key];
    if (!delta) return;
    event.preventDefault(); moved.current = false;
    if (kind === 'character') place(boundPoint({x: point.x + delta[0], y: point.y + delta[1]}, innerWidth, innerHeight));
    else applyPanel({...panel, w: panel.w + delta[0], h: panel.h + delta[1]});
  };
  if (hidden || !point || !panel) return null;
  const theme = {'--jarvis-accent': accent};
  return <div className="jarvis-widget" style={theme}>
    <div className="jarvis-companion" data-label-below={point.y < 40} style={{left: point.x, top: point.y, width: CHARACTER.width, height: CHARACTER.height}}>
      <button ref={launcher} type="button" className="jarvis-launcher" aria-label="Chat with Jarvis" aria-expanded={open} aria-controls={open ? panelId : undefined} title="Chat with Jarvis" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)} onPointerDown={event => start(event, 'character')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') moved.current = false; keyboard(event, 'character');}} onClick={() => {if (moved.current) {moved.current = false; return;} if (!open) {applyPanel(besideCharacter(point, panel, innerWidth, innerHeight)); activity('attentive'); setOpen(true);}}}>
        <JarvisCharacter state={dragging ? 'dragging' : open ? state : 'idle'} hovered={open || dragging ? false : hovered} activityId={activityId} robotTheme={robotTheme} characterStyle={characterStyle} paused={paused}/>
        <span className="jarvis-tooltip">Jarvis</span>
      </button>
    </div>
    {open && <section ref={popup} id={panelId} className="jarvis-popup" role="dialog" aria-label="Jarvis chat" style={{left: panel.x, top: panel.y, width: panel.w, height: panel.h}} onKeyDown={event => {if (event.key === 'Escape') {event.stopPropagation(); close();}}}>
      <header onPointerDown={event => start(event, 'panel')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}><IconGripVertical size={17}/><div className="jarvis-heading"><strong>Jarvis</strong><small>Synergy Network's Helpful Assistant</small></div><div>
        {onOpenPage && <button type="button" aria-label="Open Assistant Hub" title="Open Assistant Hub" onClick={() => {close(); onOpenPage();}}><IconArrowsMaximize size={17}/></button>}
        {onPopOut && <button type="button" aria-label="Open Jarvis in a new window" title="Open in new window" onClick={() => Promise.resolve().then(onPopOut).then(close).catch(cause => setError(String(cause)))}><IconExternalLink size={17}/></button>}
        <button type="button" aria-label="Minimize Jarvis chat" title="Minimize chat" onClick={close}><IconMinus size={18}/></button>
        <button type="button" aria-label="Close Jarvis chat" title="Close chat and start a new conversation" onClick={() => {startNewConversation(messagePrefix); close();}}><IconX size={18}/></button>
      </div></header>
      {error && <p role="alert" className="jarvis-error">{error}</p>}
      <JarvisChat showCharacter={false} storagePrefix={messagePrefix} onSend={onSend} onStateChange={activity} welcome={welcome} serviceLabel={serviceLabel}/>
      <button type="button" className="jarvis-resize" aria-label="Resize Jarvis chat" title="Resize chat" onPointerDown={event => start(event, 'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={event => keyboard(event, 'resize')}><IconArrowsDiagonal size={14}/></button>
    </section>}
  </div>;
}
