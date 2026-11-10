'use client';

import {useState} from 'react';
import {JarvisCharacter} from './JarvisCharacter.jsx';
import {JarvisChat} from './JarvisChat.jsx';

// A separate character lane keeps all conversation content unobstructed.
export function JarvisConversation(props) {
  const [state, setState] = useState('attentive'), [activityId, setActivityId] = useState(0);
  return <div className="jarvis-conversation">
    <JarvisChat {...props} showCharacter={false} onStateChange={next => {setState(next); setActivityId(value => value + 1); props.onStateChange?.(next);}}/>
    <div className="jarvis-conversation-companion"><JarvisCharacter state={state} activityId={activityId} robotTheme={props.robotTheme} characterStyle={props.characterStyle}/></div>
  </div>;
}
