import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JarvisWidget, createPresetResponder} from '../src/index.jsx';
import {FullRobot} from '../src/FullRobot.jsx';
import {BLUE_ROBOT,GREEN_ROBOT} from '../src/robot-state.js';
import './preview.css';
const respond=createPresetResponder();
const states=['idle','listening','thinking','searching','working','speaking','happy','error','sleeping'];
function Preview(){const [green,setGreen]=useState(false);const [paused,setPaused]=useState(false);return <main>
<header><div><small>SYNERGY NETWORK · JARVIS</small><h1>A little more human.<br/>Still entirely robot.</h1><p>Full-body companion · articulated hands, arms, legs and feet.</p></div><div><button onClick={()=>setGreen(!green)}>{green?'Switch to blue Portal':'Switch to developer green'}</button><button onClick={()=>setPaused(!paused)}>{paused?'Animate':'Pause preview'}</button></div></header>
<section>{states.map(state=><article key={state}><div className="figure"><FullRobot expression={state} robotTheme={green?GREEN_ROBOT:BLUE_ROBOT} paused={paused}/></div><h2>{state}</h2></article>)}</section>
<footer>Click Jarvis in the corner to try the chat. Drag him or the chat panel to check placement.</footer>
<JarvisWidget storageKey="jarvis-full-body-preview" robotTheme={green?GREEN_ROBOT:BLUE_ROBOT} onSend={respond} serviceLabel="Preset replies"/>
</main>};createRoot(document.getElementById('root')).render(<Preview/>);
