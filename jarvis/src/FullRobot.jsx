'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {RobotHead} from './vendor/RobotHead.js';
import {bodyPose} from './body-motion.js';
const chestLogo = new URL('./assets/synergy-network.gif', import.meta.url).href;
const chestLogoStill = new URL('./assets/synergy-network-still.png', import.meta.url).href;

export function FullRobot({expression, robotTheme, paused}) {
  const root = useRef(null);
  const [logoAnimated, setLogoAnimated] = useState(!paused);
  const [headExpression, setHeadExpression] = useState(expression === 'sleeping' ? 'idle' : expression);
  useEffect(() => {
    if (expression !== 'sleeping' || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHeadExpression(expression); return;
    }
    setHeadExpression('idle');
    const timer = setTimeout(() => setHeadExpression('sleeping'), 2200);
    return () => clearTimeout(timer);
  }, [expression, paused]);
  const motionState = useRef({pose: null, elapsed: 0});
  const id = `jarvis-${useId().replace(/:/g, '')}`;
  const fill = name => `url(#${id}-${name})`;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const joints = Object.fromEntries(['upper','arms','leftArm','rightArm','leftElbow','rightElbow','leftLeg','rightLeg','leftKnee','rightKnee'].map(name => [name, element.querySelector(`[data-joint="${name}"]`)]));
    let frame, previous = 0, transitionAge = 0, elapsed = motionState.current.elapsed, current = motionState.current.pose;
    const apply = target => {
      // Ease pose changes instead of snapping limbs when conversation state changes.
      if (!current || paused || motion.matches) current = {...target};
      else for (const key in target) current[key] += (target[key] - current[key]) * .14;
      motionState.current = {pose: current, elapsed};
      const p = current;
      element.style.setProperty('--robot-lift', `${p.lift}px`);
      element.style.setProperty('--robot-crouch', `${p.crouch}px`);
      element.style.setProperty('--robot-lean', `${p.lean}deg`);
      joints.upper.setAttribute('transform', `translate(0 ${p.crouch}) rotate(${p.lean} 64 115)`);
      joints.arms.setAttribute('transform', `translate(0 ${p.crouch}) rotate(${p.lean} 64 115)`);
      for (const side of ['left', 'right']) {
        const x = side === 'left' ? 40 : 88;
        joints[side+'Arm'].setAttribute('transform', `rotate(${p[side+'Arm']} ${x} 88)`);
        joints[side+'Elbow'].setAttribute('transform', `rotate(${p[side+'Elbow']} ${x} 106)`);
        joints[side+'Leg'].setAttribute('transform', `translate(0 ${p.crouch}) rotate(${p[side+'Leg']} ${side === 'left' ? 54 : 74} 121)`);
        joints[side+'Knee'].setAttribute('transform', `rotate(${p[side+'Knee']} ${side === 'left' ? 54 : 74} 137)`);
      }
    };
    const tick = now => {
      if (previous) {const delta = Math.min((now - previous) / 1000, .05); elapsed += delta; transitionAge += delta;}
      previous = now;
      apply(bodyPose(expression, elapsed, paused || motion.matches, transitionAge));
      if (!paused && !motion.matches && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const restart = () => {cancelAnimationFrame(frame); setLogoAnimated(!paused && !motion.matches && !document.hidden); previous = 0; tick(performance.now());};
    restart();
    document.addEventListener('visibilitychange', restart);
    motion.addEventListener('change', restart);
    return () => {cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', restart); motion.removeEventListener('change', restart);};
  }, [expression, paused]);
  const leg = (side, x) => <g data-joint={`${side}Leg`}>
    <circle cx={x} cy="121" r="6" fill={fill('metal')}/>
    <rect x={x-5} y="122" width="10" height="15" rx="4" fill={fill('shell')} stroke="#09172a"/>
    <g data-joint={`${side}Knee`}>
      <circle cx={x} cy="137" r="5" fill={fill('metal')} stroke="#112033"/>
      <rect x={x-5} y="137" width="10" height="13" rx="4" fill={fill('shell')} stroke="#09172a"/>
      <path d={`M${x-7} 148 Q${x} 144 ${x+7} 148 L${x+9} 155 Q${x} 159 ${x-9} 155 Z`} fill={fill('metal')} stroke="#14263c"/>
      <path d={`M${x-7} 154 H${x+7}`} stroke={robotTheme.trimColor} strokeWidth="2"/>
    </g>
  </g>;
  const arm = (side, x) => <g data-joint={`${side}Arm`}>
    <circle cx={x} cy="88" r="7" fill={fill('metal')} stroke="#102439"/>
    <rect x={x-5} y="88" width="10" height="18" rx="5" fill={fill('shell')} stroke="#13253b"/>
    <g data-joint={`${side}Elbow`}>
      <circle cx={x} cy="106" r="5" fill={fill('metal')} stroke="#102439"/>
      <rect x={x-5} y="107" width="10" height="13" rx="4" fill={fill('shell')} stroke="#13253b"/>
      <rect x={x-5} y="117" width="10" height="3" rx="1" fill={robotTheme.trimColor}/>
      <rect x={x-6} y="120" width="12" height="10" rx="4" fill={fill('metal')} stroke="#152b41"/>
      {expression === 'happy' && side === 'left'
        ? [-4,-1,2].map((offset,index) => <rect key={offset} x={x+offset} y="126" width="2.6" height={index === 1 ? 10 : 8} rx="1.3" fill={fill('metal')} stroke="#20364e" strokeWidth=".5"/>)
        : <path d={`M${x-2} 126v4 M${x+2} 126v4`} stroke="#33465e" strokeWidth="1"/>}
      <g transform={`translate(${side === 'left' && expression !== 'happy' ? x+4.5 : x-4.5} 124) rotate(${side === 'left' && expression !== 'happy' ? -35 : 35})`}>
        <rect x="-1.4" y="0" width="2.8" height="6" rx="1.4" fill={fill('metal')} stroke="#20364e" strokeWidth=".5"/>
      </g>
    </g>
  </g>;
  return <span ref={root} className="jarvis-full-robot">
    <svg className="jarvis-robot-body" viewBox="0 0 128 168" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2=".7"><stop stopColor="#e2f3ff"/><stop offset=".18" stopColor={robotTheme.color}/><stop offset=".44" stopColor="#e0e8ee"/><stop offset=".65" stopColor={robotTheme.color}/><stop offset=".86" stopColor="#4c6173"/><stop offset="1" stopColor="#081323"/></linearGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#f4faff"/><stop offset=".3" stopColor="#a5bed3"/><stop offset=".53" stopColor="#344c66"/><stop offset=".75" stopColor="#90a6be"/><stop offset="1" stopColor="#182d43"/></linearGradient>
      </defs>
      {leg('left',54)}{leg('right',74)}
      <g data-joint="upper">
        <rect x="57" y="72" width="14" height="11" rx="5" fill={fill('metal')} stroke="#142439"/>
        <path d="M58 76h12 M58 79h12" stroke="#233e58" strokeWidth="2"/>
        <path d="M45 83 Q64 76 83 83 L80 109 Q78 118 64 120 Q50 118 48 109Z" fill={fill('shell')} stroke="#11253b" strokeWidth="1.5"/>
        <path d="M46 86 L49 106 M82 86 L79 106" stroke={robotTheme.trimColor} strokeOpacity=".45" strokeWidth="1.3" fill="none"/>
        <path d="M50 85 Q64 81 78 85" stroke="#d7f5ff" strokeOpacity=".65" fill="none"/>
        <path d="M54 88h20l-2 17H56Z" fill="#0b1c30" stroke="#738da4"/>
        <image href={logoAnimated ? chestLogo : chestLogoStill} x="57" y="89" width="14" height="14" aria-hidden="true"/>
        <path d="M57 111h14 M59 114h10" stroke="#071320" strokeWidth="2" strokeLinecap="round"/>
        <path d="M52 119 Q64 124 76 119" stroke={fill('metal')} strokeWidth="7" fill="none"/>
      </g>
    </svg>
    <span className="jarvis-robot-head"><RobotHead attached shape="square" state={headExpression} size={66} color={robotTheme.color} trimColor={robotTheme.trimColor} screenColor={robotTheme.screenColor} interactive={false} paused={paused} floorShadow={false}/></span>
    <svg className="jarvis-robot-arms" viewBox="0 0 128 168" aria-hidden="true">
      <g data-joint="arms">{arm('left',40)}{arm('right',88)}</g>
    </svg>
  </span>;
}
