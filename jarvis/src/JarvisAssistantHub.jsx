'use client';

import {useEffect, useRef, useState} from 'react';
import {clearHistory,reviewHistory} from './history.js';
import {JarvisConversation} from './JarvisConversation.jsx';
import {activeConversation, conversationHistory, startNewConversation} from './JarvisChat.jsx';

export function JarvisAssistantHub({storagePrefix = 'jarvis-message:', ...props}) {
  const [history, setHistory] = useState(() => conversationHistory(storagePrefix));
  const [review,setReview]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),clearButton=useRef(null),cancelButton=useRef(null);
  useEffect(()=>{if(review)cancelButton.current?.focus();},[review]);
  const [selected, setSelected] = useState(null), [active, setActive] = useState(() => activeConversation(storagePrefix));
  useEffect(() => {
    const refresh = () => {setHistory(conversationHistory(storagePrefix)); setActive(activeConversation(storagePrefix));};
    window.addEventListener('storage', refresh); window.addEventListener('jarvis-messages-changed', refresh);
    return () => {window.removeEventListener('storage', refresh); window.removeEventListener('jarvis-messages-changed', refresh);};
  }, [storagePrefix]);
  return <div className="jarvis-assistant-hub">
    <aside className="jarvis-history" aria-label="Chat history"><h2>Chat history</h2>
      <button onClick={() => {startNewConversation(storagePrefix); setSelected(null);}}>New chat</button>
      <button ref={clearButton} onClick={()=>{try{setReview({count:reviewHistory(localStorage,storagePrefix).length});setError('');setNotice('');}catch(error){setError(error.message);}}}>Clear conversation history</button>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {review&&<section aria-label="Review history clearing"><h3>Clear local conversation history?</h3><p>Remove {review.count} stored message records for this assistant and cancel pending replies. This cannot be undone. Wallet, Vault and host data are outside this conversation store.</p><button ref={cancelButton} onClick={()=>{setReview(null);clearButton.current?.focus();}}>Cancel clearing</button><button onClick={()=>{try{const count=clearHistory(localStorage,storagePrefix);setSelected(null);setNotice(`${count} message records removed.`);setReview(null);clearButton.current?.focus();}catch(error){setError(error.message);}}}>Confirm clear history</button></section>}
      <button className={!selected ? 'selected' : ''} onClick={() => setSelected(null)}>Current chat</button>
      {history.length ? history.map(chat => <button key={chat.id} className={selected === chat.id ? 'selected' : ''} onClick={() => setSelected(chat.id)}><span>{chat.title}</span><small>{new Date(chat.time).toLocaleDateString()} · {chat.count} {chat.count === 1 ? 'message' : 'messages'}</small></button>) : <p>No saved conversations yet.</p>}
    </aside>
    <JarvisConversation key={selected || active} {...props} storagePrefix={storagePrefix} conversationId={selected || undefined} readOnly={!!selected && selected !== active}/>
  </div>;
}
