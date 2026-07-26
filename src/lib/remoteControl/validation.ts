// Explicit validators for every remote-control message. Nothing coming in
// off the Realtime channel is trusted until it passes through here.
import type { RCMessage, RCInputEvent, RCButton } from './protocol';

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 500;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum01 = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -0.05 && v <= 1.05;
const isNumFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBtn = (v: unknown): v is RCButton => v === 'left' || v === 'right' || v === 'middle';

function validateInput(e: unknown): e is RCInputEvent {
  if (!e || typeof e !== 'object') return false;
  const ev = e as Record<string, unknown>;
  switch (ev.type) {
    case 'mousemove':
      return isNum01(ev.x) && isNum01(ev.y);
    case 'mousedown':
    case 'mouseup':
      return isNum01(ev.x) && isNum01(ev.y) && isBtn(ev.button);
    case 'click':
      return isNum01(ev.x) && isNum01(ev.y) && isBtn(ev.button) && typeof ev.detail === 'number';
    case 'wheel':
      return isNum01(ev.x) && isNum01(ev.y) && isNumFinite(ev.deltaX) && isNumFinite(ev.deltaY);
    case 'keydown':
    case 'keyup':
      return isString(ev.key) && isString(ev.code) && isBool(ev.ctrl) && isBool(ev.shift) && isBool(ev.alt) && isBool(ev.meta);
    default:
      return false;
  }
}

export function validateRCMessage(raw: unknown): RCMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!isString(m.kind) || !isString(m.from)) return null;
  switch (m.kind) {
    case 'presenter':
      if (!isString(m.name) || !isBool(m.sharing)) return null;
      return m as unknown as RCMessage;
    case 'cursor':
      if (!isString(m.name) || !isString(m.color) || !isNum01(m.x) || !isNum01(m.y) || !isBool(m.visible)) return null;
      return m as unknown as RCMessage;
    case 'ripple':
      if (!isString(m.name) || !isString(m.color) || !isNum01(m.x) || !isNum01(m.y) || !isBtn(m.button)) return null;
      return m as unknown as RCMessage;
    case 'request':
      if (!isString(m.name) || !isString(m.to)) return null;
      return m as unknown as RCMessage;
    case 'cancel':
      if (!isString(m.to)) return null;
      return m as unknown as RCMessage;
    case 'grant':
      if (!isString(m.to) || !isString(m.nonce) || !isBool(m.allowKeyboard)) return null;
      return m as unknown as RCMessage;
    case 'deny':
      if (!isString(m.to)) return null;
      if (m.reason !== undefined && typeof m.reason !== 'string') return null;
      return m as unknown as RCMessage;
    case 'revoke':
      if (!isString(m.to)) return null;
      if (m.reason !== undefined && typeof m.reason !== 'string') return null;
      return m as unknown as RCMessage;
    case 'input':
      if (!isString(m.to) || !isString(m.nonce)) return null;
      if (!validateInput(m.event)) return null;
      return m as unknown as RCMessage;
    case 'lock': {
      if (!isString(m.presenterName)) return null;
      const cid = m.controllerId;
      const cname = m.controllerName;
      const mode = m.mode;
      const nulled = cid === null && cname === null && mode === null;
      const set = isString(cid) && isString(cname) && (mode === 'mouse' || mode === 'mouse+keyboard');
      if (!nulled && !set) return null;
      return m as unknown as RCMessage;
    }
    default:
      return null;
  }
}
