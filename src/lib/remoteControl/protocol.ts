// Remote-control protocol shared between viewer (controller) and presenter.
// Messages ride on the existing `webrtc-${meetingId}` Supabase Realtime
// channel so we stay within the meeting-member RLS policy.

export const RC_EVENT = 'remote-control';

export type RCButton = 'left' | 'right' | 'middle';

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
  | { kind: 'input'; from: string; to: string; nonce: string; event: RCInputEvent };

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