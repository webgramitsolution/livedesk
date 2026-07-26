// Per-meeting tunables for remote-control input rate limiting and cursor
// smoothing. Persisted in localStorage so a host can dial them in per network
// condition and keep the values across sessions.
import { useEffect, useState } from 'react';

export interface RCTuning {
  mousemoveMinMs: number; // outbound mousemove throttle
  wheelMinMs: number; // outbound wheel throttle
  cursorSmoothingMs: number; // CSS transition applied to remote cursors
  cursorSendMinMs: number; // outbound cursor broadcast throttle
}

export const DEFAULT_RC_TUNING: RCTuning = {
  mousemoveMinMs: 16,
  wheelMinMs: 16,
  cursorSmoothingMs: 150,
  cursorSendMinMs: 33,
};

const KEY = (meetingId: string) => `rc-tuning:${meetingId}`;
const CHANNEL = 'rc-tuning-change';

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalize(raw: Partial<RCTuning> | null | undefined): RCTuning {
  const r = raw ?? {};
  return {
    mousemoveMinMs: clamp(r.mousemoveMinMs, 4, 200, DEFAULT_RC_TUNING.mousemoveMinMs),
    wheelMinMs: clamp(r.wheelMinMs, 4, 200, DEFAULT_RC_TUNING.wheelMinMs),
    cursorSmoothingMs: clamp(r.cursorSmoothingMs, 0, 500, DEFAULT_RC_TUNING.cursorSmoothingMs),
    cursorSendMinMs: clamp(r.cursorSendMinMs, 8, 250, DEFAULT_RC_TUNING.cursorSendMinMs),
  };
}

export function loadRCTuning(meetingId: string): RCTuning {
  if (typeof window === 'undefined') return { ...DEFAULT_RC_TUNING };
  try {
    const raw = window.localStorage.getItem(KEY(meetingId));
    if (!raw) return { ...DEFAULT_RC_TUNING };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RC_TUNING };
  }
}

export function saveRCTuning(meetingId: string, tuning: RCTuning) {
  if (typeof window === 'undefined') return;
  const clean = normalize(tuning);
  try {
    window.localStorage.setItem(KEY(meetingId), JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: { meetingId, tuning: clean } }));
  } catch {
    /* ignore */
  }
}

export function useRCTuning(meetingId: string): [RCTuning, (next: RCTuning) => void] {
  const [tuning, setTuning] = useState<RCTuning>(() => loadRCTuning(meetingId));
  useEffect(() => {
    setTuning(loadRCTuning(meetingId));
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { meetingId: string; tuning: RCTuning } | undefined;
      if (detail && detail.meetingId === meetingId) setTuning(detail.tuning);
    };
    window.addEventListener(CHANNEL, onChange as EventListener);
    return () => window.removeEventListener(CHANNEL, onChange as EventListener);
  }, [meetingId]);

  const update = (next: RCTuning) => {
    saveRCTuning(meetingId, next);
    setTuning(normalize(next));
  };
  return [tuning, update];
}
