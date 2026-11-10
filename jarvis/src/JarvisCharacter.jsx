'use client';

import {useEffect, useRef, useState} from 'react';
import {RobotHead} from './vendor/RobotHead.js';
import {FullRobot} from './FullRobot.jsx';
import {JarvisSpriteCharacter} from './JarvisSpriteCharacter.jsx';
import {BLUE_ROBOT, createRobotSchedule} from './robot-state.js';

function JarvisRobotCharacter({state = 'idle', hovered = false, paused = false, activityId = 0, robotTheme = BLUE_ROBOT, headOnly = false}) {
  const schedule = useRef(null);
  if (!schedule.current) schedule.current = createRobotSchedule();
  const [expression, setExpression] = useState(state === 'idle' ? 'sleeping' : 'listening');
  const options = useRef({state, hovered, activityId});
  options.current = {state, hovered, activityId};
  useEffect(() => {
    const update = () => setExpression(schedule.current(performance.now(), options.current));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [state, hovered, activityId]);
  return <span className="jarvis-character" aria-hidden="true" data-animation={expression} data-grounded={!headOnly} style={{'--jarvis-room-light':robotTheme.trimColor}}>
    {headOnly ? <RobotHead shape="square" state={expression} size={104} color={robotTheme.color} trimColor={robotTheme.trimColor} screenColor={robotTheme.screenColor} interactive={false} paused={paused} floorShadow={false}/> : <FullRobot expression={expression} robotTheme={robotTheme} paused={paused}/>}
  </span>;
}

// Original artwork stays bundled but is inactive unless explicitly selected.
export function JarvisCharacter({characterStyle = 'robot', ...props}) {
  const legacy = {hearts: 'greeting', money: 'greeting', cool: 'greeting', 'reply-hearts': 'reply', 'reply-money': 'reply', 'reply-cool': 'reply', searching: 'thinking', working: 'thinking', listening: 'attentive', speaking: 'reply', happy: 'greeting', sleeping: 'sleep'};
  return characterStyle === 'sprite' ? <JarvisSpriteCharacter {...props} state={legacy[props.state] || props.state}/> : <JarvisRobotCharacter {...props} headOnly={characterStyle === 'head'}/>;
}
