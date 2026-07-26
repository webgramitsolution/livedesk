// Session-scoped persistence for the remote-control state machine. Survives
// brief disconnects (tab reload, network blip) so the queue, active lock, and
// the local viewer's own pending request are not lost.
import type { ControlStatus, IncomingRequest, ControlLock } from '@/hooks/useRemoteControl';

export interface RCPersistedState {
  savedAt: number;
  requestQueue: IncomingRequest[];
  activeController: {
    id: string;
    name: string;
    nonce: string;
    allowKeyboard: boolean;
    since: number;
  } | null;
  controlLock: ControlLock | null;
  status: ControlStatus;
}

// State older than this is treated as stale on rehydrate.
const MAX_AGE_MS = 60_000;

const key = (meetingId: string, sessionId: string) => `rc-state:${meetingId}:${sessionId}`;

export function loadRCState(meetingId: string, sessionId: string): RCPersistedState | null {
  if (typeof window === 'undefined' || !meetingId || !sessionId) return null;
  try {
    const raw = window.sessionStorage.getItem(key(meetingId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RCPersistedState;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(key(meetingId, sessionId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveRCState(meetingId: string, sessionId: string, state: Omit<RCPersistedState, 'savedAt'>) {
  if (typeof window === 'undefined' || !meetingId || !sessionId) return;
  try {
    window.sessionStorage.setItem(
      key(meetingId, sessionId),
      JSON.stringify({ ...state, savedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function clearRCState(meetingId: string, sessionId: string) {
  if (typeof window === 'undefined' || !meetingId || !sessionId) return;
  try {
    window.sessionStorage.removeItem(key(meetingId, sessionId));
  } catch {
    /* ignore */
  }
}
