export const SLEEP_AFTER = 60000;
export const BLUE_ROBOT = Object.freeze({color: '#a9b9c8', trimColor: '#59caff', screenColor: '#59caff'});
export const GREEN_ROBOT = Object.freeze({color: '#a9b9c8', trimColor: '#54efb0', screenColor: '#54efb0'});

export function requestExpression(text) {
  if (/\b(find|search|where|browse|look up|locate|which|list)\b/i.test(text)) return 'searching';
  if (/\b(connect|pair|build|create|configure|customize|set up|install|send|transaction|deploy)\b/i.test(text)) return 'working';
  return 'thinking';
}

export function replyExpression(text) {
  if (/\b(love|thank|thanks|appreciate|adorable)\b|[❤️💕]/iu.test(text)) return 'reply-hearts';
  if (/\b(money|balance|price|rewards?|earnings?|tokens?|staking|portfolio)\b|\$/i.test(text)) return 'reply-money';
  if (/\b(cool|awesome|nice|great|perfect)\b/i.test(text)) return 'reply-cool';
  return 'reply';
}

// Only real interaction advances this clock. Moving a chat panel never does.
export function createRobotSchedule() {
  let key, lastActivity = -Infinity, started = 0, current = 'idle';
  return (now, {state = 'idle', hovered = false, activityId = 0} = {}) => {
    const nextKey = `${state}:${hovered}:${activityId}`;
    if (nextKey !== key) {
      if (key !== undefined || state !== 'idle' || hovered || activityId) lastActivity = now;
      key = nextKey; started = now; current = state;
    }
    const elapsed = now - started;
    if (current === 'sleep' || current === 'sleeping') return 'sleeping';
    if (['thinking', 'searching', 'working'].includes(current)) return current;
    if (current === 'dragging') return 'happy';
    if (now - lastActivity >= SLEEP_AFTER) return 'sleeping';
    if (current === 'error' && elapsed < 5000) return 'error';
    if (['hearts', 'money', 'cool'].includes(current)) return elapsed < 5000 ? current : 'idle';
    if (['reply', 'speaking', 'reply-hearts', 'reply-money', 'reply-cool'].includes(current)) {
      if (elapsed < 4000) return 'speaking';
      if (elapsed < 7500 && current.startsWith('reply-')) return current.slice(6);
      if (elapsed < 6500) return 'happy';
    }
    if (current === 'happy' || current === 'greeting' || hovered) return elapsed < 3000 ? 'happy' : 'idle';
    if (current === 'typing' || current === 'listening') return 'listening';
    if (current === 'attentive' && elapsed < 5000) return 'listening';
    return 'idle';
  };
}
