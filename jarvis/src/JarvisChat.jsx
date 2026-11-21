'use client';

import {useEffect, useRef, useState} from 'react';
import {historyGeneration} from './history.js';
import {IconSend} from '@tabler/icons-react';
import {requestExpression, replyExpression} from './robot-state.js';

export function readPreference(key, fallback) {
  try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}
}
export function savePreference(key, value) {
  try {localStorage.setItem(key, JSON.stringify(value)); return true;} catch {return false;}
}
function allMessages(prefix) {
  try {const generation=historyGeneration(localStorage,prefix);return Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => JSON.parse(localStorage.getItem(key))).filter(m => (m?.historyGeneration===undefined?'legacy':m.historyGeneration)===generation && typeof m?.id === 'string' && typeof m.user === 'string' && typeof m.text === 'string' && Number.isFinite(m.time)).sort((a, b) => a.time - b.time).slice(-100);} catch {return [];}
}
export function activeConversation(prefix) {return readPreference(`${prefix}active-chat`, 'legacy');}
export function startNewConversation(prefix) {
  savePreference(`${prefix}active-chat`, crypto.randomUUID());
  window.dispatchEvent(new CustomEvent('jarvis-messages-changed', {detail: prefix}));
}
function storedMessages(prefix, id = activeConversation(prefix)) {
  return allMessages(prefix).filter(message => (message.conversationId || 'legacy') === id);
}
export function conversationHistory(prefix) {
  const groups = new Map();
  for (const message of allMessages(prefix)) {
    const id = message.conversationId || 'legacy';
    const group = groups.get(id) || {id, title: message.user.slice(0, 70), time: message.time, count: 0};
    group.time = Math.max(group.time, message.time); group.count++; groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => b.time - a.time);
}
export function JarvisChat({storagePrefix = 'jarvis-message:', onSend, onStateChange, welcome = "Hi! I'm Jarvis, the Synergy Network Assistant. I can answer questions or assist with tasks across the entire ecosystem. How can I help?", paused = false, showCharacter = true, conversationId, readOnly = false, robotTheme, characterStyle = 'robot'}) {
  const [chatId, setChatId] = useState(() => conversationId || activeConversation(storagePrefix));
  const [messages, setMessages] = useState(() => storedMessages(storagePrefix, conversationId || activeConversation(storagePrefix)));
  const [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const end = useRef(null), input = useRef(null), request = useRef(null), stateCallback = useRef(onStateChange),generation=useRef(null),currentChat=useRef(chatId);
  stateCallback.current = onStateChange;
  useEffect(() => {
    const refresh = event => {
      if (event.type === 'storage' && event.key && !event.key.startsWith(storagePrefix)) return;
      if (event.type === 'jarvis-messages-changed' && event.detail !== storagePrefix) return;
      const next = conversationId || activeConversation(storagePrefix);
      let nextGeneration;try{nextGeneration=historyGeneration(localStorage,storagePrefix);}catch{setStorageError(true);return;}
      if(generation.current!==nextGeneration||currentChat.current!==next){request.current?.abort();request.current=null;setBusy(false);setPrompt('');stateCallback.current?.('attentive');}
      generation.current=nextGeneration;currentChat.current=next;
      setChatId(next); setMessages(storedMessages(storagePrefix, next));
    };
    refresh({type: 'refresh'});
    window.addEventListener('storage', refresh); window.addEventListener('jarvis-messages-changed', refresh);
    return () => {window.removeEventListener('storage', refresh); window.removeEventListener('jarvis-messages-changed', refresh); request.current?.abort(); stateCallback.current?.('attentive');};
  }, [storagePrefix, conversationId]);
  useEffect(() => {end.current?.scrollIntoView({block: 'nearest'});}, [messages, busy, error]);
  const persist = message => {
    try{
      if(historyGeneration(localStorage,storagePrefix)!==message.historyGeneration)return false;
      const saved=savePreference(storagePrefix+message.id,message);
      if(historyGeneration(localStorage,storagePrefix)!==message.historyGeneration){
        const stored=readPreference(storagePrefix+message.id,null);
        if(stored?.historyGeneration===message.historyGeneration)localStorage.removeItem(storagePrefix+message.id);
        return false;
      }
      setMessages(old=>[...old.filter(value=>value.id!==message.id),message].slice(-100));
      if(!saved)setStorageError(true);else window.dispatchEvent(new CustomEvent('jarvis-messages-changed',{detail:storagePrefix}));
      return true;
    }catch{setStorageError(true);return false;}
  };
  const send = async (event, suggestion) => {
    event.preventDefault(); const text = (suggestion || prompt).trim(); if (!text || request.current || readOnly) return;
    setError(''); setPrompt('');
    let currentGeneration;try{currentGeneration=historyGeneration(localStorage,storagePrefix);}catch{setError('Conversation storage is unreadable; no message was sent.');return;}
    const message = {historyGeneration:currentGeneration,id: crypto.randomUUID(), conversationId: chatId, time: Date.now(), user: text, text: ''};
    const controller = new AbortController(); request.current = controller;
    setBusy(true); stateCallback.current?.(requestExpression(text));
    setMessages(old => [...old, message]);
    try {
      const started = performance.now();
      const reply = onSend ? await onSend(text, {messages, signal: controller.signal}) : 'Jarvis is not connected to an assistant service yet. Your message is saved here; live replies will be available when the service is connected.';
      const remaining = Math.max(0, Math.min(2200, 900 + String(reply).length * 8) - (performance.now() - started));
      await new Promise(resolve => {
        const finish = () => {clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve();};
        const timer = setTimeout(finish, remaining);
        controller.signal.addEventListener('abort', finish, {once:true});
        if (controller.signal.aborted) finish();
      });
      if (controller.signal.aborted) return;
      if (typeof reply !== 'string' || !reply.trim()) throw new Error('No reply was returned. Please try again.');
      if(persist({...message,text:reply}))stateCallback.current?.(replyExpression(text));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setMessages(old => old.filter(m => m.id !== message.id)); setPrompt(text);
      setError(cause instanceof Error ? cause.message : 'Unable to reach Jarvis. Please try again.'); stateCallback.current?.('error');
    } finally {
      if (!controller.signal.aborted) {request.current = null; setBusy(false); input.current?.focus();}
    }
  };
  return <div className="jarvis-chat">
    <div className="jarvis-messages" role="log" aria-live="polite" aria-relevant="additions text">
      {(Array.isArray(welcome) ? welcome : [welcome]).map((message, index) => <p key={index} className="jarvis-assistant-message">{message}</p>)}
      {messages.length ? messages.map(m => <div key={m.id} className="jarvis-message"><p className="jarvis-user-message">{m.user}</p>{m.text && <p className="jarvis-assistant-message">{m.text}</p>}</div>) : null}
      {busy && <p className="jarvis-pending" role="status">Jarvis is typing<span className="jarvis-typing-dots" aria-hidden="true"><i/><i/><i/></span></p>}
      {error && <p className="jarvis-error" role="alert">{error}</p>}<div ref={end}/>
    </div>
    {storageError && <p className="jarvis-service" role="status">Device storage is unavailable. Messages stay in this window.</p>}
    {!readOnly && <div className="jarvis-suggestions" aria-label="Suggested messages">{['What can you help me with?', 'How do I connect my wallet?', 'What is the network status?'].map(text => <button key={text} type="button" disabled={busy} onClick={event=>send(event,text)}>{text}</button>)}</div>}
    {readOnly ? <div className="jarvis-service">Saved conversation</div> : <form className="jarvis-input" onSubmit={send}><input ref={input} aria-label="Ask Jarvis" placeholder="Ask Jarvis anything..." value={prompt} maxLength={4000} onChange={event => {setPrompt(event.target.value); stateCallback.current?.(event.target.value ? 'typing' : 'attentive');}}/><button type="submit" aria-label="Send to Jarvis" title="Send to Jarvis" disabled={!prompt.trim() || busy}><IconSend size={18}/></button></form>}
  </div>;
}
