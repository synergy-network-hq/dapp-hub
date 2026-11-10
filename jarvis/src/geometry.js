export const CHARACTER = {width: 128, height: 168};
const clamp = (n, min, max) => Math.max(min, Math.min(Math.max(min, max), n));
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;

export function boundPoint(point, width, height) {
  return {
    x: Math.round(clamp(finite(point?.x, width - CHARACTER.width - 24), 8, width - CHARACTER.width - 8)),
    y: Math.round(clamp(finite(point?.y, height - CHARACTER.height - 24), 8, height - CHARACTER.height - 8)),
  };
}
export function pointAnchor(point, width, height) {
  const right = width - point.x - CHARACTER.width, bottom = height - point.y - CHARACTER.height;
  return {horizontal: point.x <= right ? 'left' : 'right', vertical: point.y <= bottom ? 'top' : 'bottom', x: Math.max(8, Math.min(point.x, right)), y: Math.max(8, Math.min(point.y, bottom))};
}
export function anchoredPoint(anchor, width, height, bottom = 24) {
  const a = anchor || {horizontal: 'right', vertical: 'bottom', x: 24, y: bottom};
  return boundPoint({x: a.horizontal === 'left' ? a.x : width - CHARACTER.width - a.x, y: a.vertical === 'top' ? a.y : height - CHARACTER.height - a.y}, width, height);
}
export function boundPanel(rect, width, height) {
  const w = clamp(finite(rect?.w, 380), Math.min(280, width - 16), width - 16);
  const h = clamp(finite(rect?.h, 440), Math.min(240, height - 16), height - 16);
  return {x: clamp(finite(rect?.x, width - w - 24), 8, width - w - 8), y: clamp(finite(rect?.y, height - h - 24), 8, height - h - 8), w, h};
}
export function besideCharacter(point, panel, width, height) {
  const rect = boundPanel(panel, width, height);
  const left = point.x - rect.w - 12;
  const right = point.x + CHARACTER.width + 12;
  if (left >= 8) return boundPanel({...rect, x: left, y: point.y + CHARACTER.height - rect.h}, width, height);
  if (right + rect.w <= width - 8) return boundPanel({...rect, x: right, y: point.y + CHARACTER.height - rect.h}, width, height);
  const roomAbove = point.y - 20;
  if (roomAbove >= 180) return {...boundPanel({...rect, x: 8, y: 8}, width, height), h: Math.min(rect.h, roomAbove), y: Math.max(8, point.y - Math.min(rect.h, roomAbove) - 12)};
  return boundPanel({...rect, x: 8, y: 8}, width, height);
}

// Reserve a dedicated lane on the right. Even on narrow windows the character
// never overlaps the message area or switches to the left of the popup.
export function attachedChat(panel, width, height) {
  const rect = boundPanel(panel, Math.max(32, width - CHARACTER.width - 12), height);
  return {panel: rect, point: boundPoint({x: rect.x + rect.w + 12, y: rect.y + rect.h - CHARACTER.height}, width, height)};
}
