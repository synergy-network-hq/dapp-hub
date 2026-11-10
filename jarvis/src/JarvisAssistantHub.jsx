'use client';

import {useEffect, useState} from 'react';
import {JarvisConversation} from './JarvisConversation.jsx';
import {activeConversation, conversationHistory, startNewConversation} from './JarvisChat.jsx';

export function JarvisAssistantHub({storagePrefix = 'jarvis-message:', ...props}) {
  const [history, setHistory] = useState(() => conversationHistory(storagePrefix));
  const [selected, setSelected] = useState(null), [active, setActive] = useState(() => activeConversation(storagePrefix));
  useEffect(() => {
    const refresh = () => {setHistory(conversationHistory(storagePrefix)); setActive(activeConversation(storagePrefix));};
    window.addEventListener('storage', refresh); window.addEventListener('jarvis-messages-changed', refresh);
    return () => {window.removeEventListener('storage', refresh); window.removeEventListener('jarvis-messages-changed', refresh);};
  }, [storagePrefix]);
  return <div className="jarvis-assistant-hub">
    <aside className="jarvis-history" aria-label="Chat history"><h2>Chat history</h2>
      <button onClick={() => {startNewConversation(storagePrefix); setSelected(null);}}>New chat</button>
      <button className={!selected ? 'selected' : ''} onClick={() => setSelected(null)}>Current chat</button>
      {history.length ? history.map(chat => <button key={chat.id} className={selected === chat.id ? 'selected' : ''} onClick={() => setSelected(chat.id)}><span>{chat.title}</span><small>{new Date(chat.time).toLocaleDateString()} · {chat.count} {chat.count === 1 ? 'message' : 'messages'}</small></button>) : <p>No saved conversations yet.</p>}
    </aside>
    <JarvisConversation key={selected || active} {...props} storagePrefix={storagePrefix} conversationId={selected || undefined} readOnly={!!selected && selected !== active}/>
  </div>;
}
