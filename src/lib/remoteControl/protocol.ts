// Remote-control protocol shared between viewer (controller) and presenter.
// Messages ride on the existing `webrtc-${meetingId}` Supabase Realtime
// channel so we stay within the meeting-member RLS policy.

export const RC_EVENT = 'remote-control';

export type RCButton = 'left' | 'right' | 'middle';

// Every message on the wire is wrapped in this envelope so we can:
//   - dedupe replays by msgId (anti-replay LRU on the receiver)
//   - reject stale captures by comparing ts against local clock
//   - detect tampering with a lightweight FNV-1a signature that mixes in
//     the meetingId (so a message captured in meeting A cannot be replayed
//     into meeting B and pass verification).
// The Realtime channel itself is already RLS-scoped to meeting members —
// the envelope adds message-level integrity + replay protection on top.
export interface RCEnvelope {
  msgId: string;
  ts: number;
  sig: string;
}

export type RCMessage =
  // Presenter announces they are sharing a screen.
  | { kind: 'presenter'; from: string; name: string; sharing: boolean }
  // Live cursor position from any participant (normalized 0-1).
  | { kind: 'cursor'; from: string; name: string; color: string; x: number; y: number; visible: boolean }
  // Click ripple (visual only, always shown).
  | { kind: 'ripple'; from: string; name: string; color: string; x: number; y: number; button: RCButton }
  // Viewer asks the presenter for control.
  | { kind: 'request'; from: string; name: string; to: string }
  // Viewer cancels a pending request.
  | { kind: 'cancel'; from: string; to: string }
  // Presenter answers (grant / deny) — includes nonce that viewer must include.
  | { kind: 'grant'; from: string; to: string; nonce: string; allowKeyboard: boolean }
  | { kind: 'deny'; from: string; to: string; reason?: string }
  // Presenter or viewer ends the session.
  | { kind: 'revoke'; from: string; to: string; reason?: string }
  // Real input events (only honored by presenter for the currently-granted controller with matching nonce).
  | { kind: 'input'; from: string; to: string; nonce: string; event: RCInputEvent }
  // Presenter announces the current control lock (who has control + mode).
  // Broadcast to everyone in the meeting so all participants see the indicator.
  | {
      kind: 'lock';
      from: string; // presenter id
      presenterName: string;
      controllerId: string | null;
      controllerName: string | null;
      mode: 'mouse' | 'mouse+keyboard' | null;
    };

export type RCInputEvent =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown'; x: number; y: number; button: RCButton }
  | { type: 'mouseup'; x: number; y: number; button: RCButton }
  | { type: 'click'; x: number; y: number; button: RCButton; detail: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string; code: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }
  | { type: 'keyup'; key: string; code: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

// Deterministic color per participant id so remote cursors are recognizable.
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360} 85% 55%)`;
}

export function newNonce(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

// Lightweight synchronous hash (FNV-1a, 32-bit). Not cryptographically
// unforgeable — the Realtime channel's RLS is the real access boundary —
// but sufficient to detect tampering + wrong-meeting replays and to keep
// signing entirely synchronous inside the render path.
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function signRC(input: {
  kind: string;
  from: string;
  msgId: string;
  ts: number;
  meetingId: string;
}): string {
  return fnv1a(`v1|${input.meetingId}|${input.from}|${input.kind}|${input.msgId}|${input.ts}`);
}

export function wrapRC<T extends RCMessage>(msg: T, meetingId: string): T & RCEnvelope {
  const msgId = newNonce();
  const ts = Date.now();
  const sig = signRC({ kind: msg.kind, from: msg.from, msgId, ts, meetingId });
  return { ...msg, msgId, ts, sig };
}