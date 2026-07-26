// Explicit validators for every remote-control message. Nothing coming in
// off the Realtime channel is trusted until it passes through here.
import { signRC, type RCMessage, type RCInputEvent, type RCButton } from './protocol';

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

// Anti-replay window: reject messages whose ts is more than this many ms
// away from local clock, in either direction, to bound clock skew and to
// invalidate previously-captured payloads.
export const RC_MAX_SKEW_MS = 15_000;

// Bounded LRU of recently-seen msgIds. Any duplicate within the window is
// silently dropped so a captured message can't be replayed to trigger the
// same grant/revoke/input twice.
const seenIds = new Set<string>();
const seenOrder: string[] = [];
const SEEN_MAX = 2000;
function markSeen(id: string): boolean {
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  seenOrder.push(id);
  if (seenOrder.length > SEEN_MAX) {
    const drop = seenOrder.shift();
    if (drop) seenIds.delete(drop);
  }
  return true;
}
export function resetRCReplayWindow() {
  seenIds.clear();
  seenOrder.length = 0;
}

export interface RCValidationContext {
  /** Current meeting id — mixed into signatures so cross-meeting replays fail. */
  meetingId: string;
  /** Optional clock override for deterministic tests. */
  now?: () => number;
}

export function validateRCMessage(raw: unknown, ctx: RCValidationContext): RCMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!isString(m.kind) || !isString(m.from)) return null;

  // Envelope: msgId + ts + sig are required on every wire message. This
  // enforces per-message nonces (so replays can be dropped) and integrity
  // (so a mutated payload fails the signature check).
  if (!isString(m.msgId) || typeof m.ts !== 'number' || !Number.isFinite(m.ts) || !isString(m.sig)) {
    return null;
  }
  const now = ctx.now ? ctx.now() : Date.now();
  if (Math.abs(now - (m.ts as number)) > RC_MAX_SKEW_MS) return null;
  const expected = signRC({
    kind: m.kind,
    from: m.from,
    msgId: m.msgId,
    ts: m.ts as number,
    meetingId: ctx.meetingId,
  });
  if (expected !== m.sig) return null;
  if (!markSeen(m.msgId)) return null;

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
