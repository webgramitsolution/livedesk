// Deterministic stress test for useRemoteControl.
//
// Everything nondeterministic — Date.now, performance.now, crypto.randomUUID,
// setTimeout scheduling, Math.random — is pinned before we mount the hook so
// two runs produce byte-identical audit logs, identical msgId sequences, and
// therefore identical grant/denial counts. If any counter drifts, the test
// fails with an exact diff instead of a flaky "queue-added: 8 got 12".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/store/meetingStore', () => ({
  useMeetingStore: (selector: (s: unknown) => unknown) =>
    selector({ meetingSessionId: 'presenter-session', userName: 'Host' }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));
vi.mock('@/lib/webrtcLogger', () => ({ logWebRTCEvent: () => {} }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: () => ({
      on: () => ({
        subscribe: (cb: (status: string) => void) => {
          cb('SUBSCRIBED');
          return { unsubscribe: () => {} };
        },
      }),
      send: () => {},
    }),
    removeChannel: () => {},
  },
}));

import { useRemoteControl } from './useRemoteControl';
import { clearRCAudit, getRCAudit } from '@/lib/remoteControl/auditLog';
import { signRC } from '@/lib/remoteControl/protocol';
import { resetRCReplayWindow } from '@/lib/remoteControl/validation';

// ---------- Deterministic seeding ----------
//
// A tiny mulberry32 PRNG. Same seed → same sequence, on every machine, on
// every run. We drive both Math.random and crypto.randomUUID off of this so
// the msgIds produced by the protocol are reproducible.
function seededPRNG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counter = 0;
function pinnedUUID(rand: () => number): string {
  counter += 1;
  const r = () => Math.floor(rand() * 0xffff).toString(16).padStart(4, '0');
  return `${r()}${r()}-${r()}-${r()}-${r()}-${r()}${r()}${counter.toString(16).padStart(4, '0')}`;
}

function wire<T extends { kind: string; from: string }>(meetingId: string, msg: T, now: number, uuid: () => string) {
  const msgId = uuid();
  const ts = now;
  const sig = signRC({ kind: msg.kind, from: msg.from, msgId, ts, meetingId });
  return { ...msg, msgId, ts, sig };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useRemoteControl — deterministic stress: exact grant/denial counts', () => {
  const FIXED_NOW = 1_785_000_000_000; // pinned wall clock (ms)
  let rand: () => number;
  let uuid: () => string;
  let realRandomUUID: typeof crypto.randomUUID | undefined;

  beforeEach(() => {
    clearRCAudit();
    resetRCReplayWindow();
    window.sessionStorage.clear();
    window.localStorage.clear();
    counter = 0;
    rand = seededPRNG(0xC0FFEE);
    uuid = () => pinnedUUID(rand);

    // Freeze the wall clock ONLY. Leaving setTimeout/queueMicrotask real
    // means renderHook effects and our own `flush` helper still tick
    // normally — we're pinning nondeterminism, not stopping time.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));

    // Replace crypto.randomUUID so the protocol's newNonce() is reproducible.
    realRandomUUID = crypto.randomUUID?.bind(crypto);
    // @ts-expect-error — DOM types mark randomUUID as `${string}-${string}-...`
    crypto.randomUUID = uuid;

    // Also pin Math.random for any code that falls back to it.
    vi.spyOn(Math, 'random').mockImplementation(() => rand());
  });

  afterEach(() => {
    if (realRandomUUID) {
      (crypto as unknown as { randomUUID: typeof crypto.randomUUID }).randomUUID = realRandomUUID;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replays identical: exactly 8 queue-added, 1 grant, 7 auto-denies after 5 flap cycles', async () => {
    const meetingId = 'stress-meeting';
    let hook = renderHook(() =>
      useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
    );
    await flush();

    // 8 unique + 4 duplicate requests — every wire() call uses the pinned
    // clock and pinned UUID source, so both runs of this test produce
    // literally identical envelopes.
    act(() => {
      for (let i = 0; i < 8; i += 1) {
        hook.result.current.__handleMessage(
          wire(
            meetingId,
            { kind: 'request', from: `viewer-${i}`, name: `Viewer ${i}`, to: 'presenter-session' },
            FIXED_NOW,
            uuid,
          ),
        );
      }
      for (let i = 0; i < 4; i += 1) {
        hook.result.current.__handleMessage(
          wire(
            meetingId,
            { kind: 'request', from: `viewer-${i}`, name: `Viewer ${i}`, to: 'presenter-session' },
            FIXED_NOW,
            uuid,
          ),
        );
      }
    });

    expect(hook.result.current.requestQueue).toHaveLength(8);
    // Queue must be in the exact order requests arrived.
    expect(hook.result.current.requestQueue.map((r) => r.from)).toEqual([
      'viewer-0', 'viewer-1', 'viewer-2', 'viewer-3',
      'viewer-4', 'viewer-5', 'viewer-6', 'viewer-7',
    ]);

    // Flap: 5 rapid unmount/remount cycles. The persisted snapshot must
    // rehydrate every cycle without duplicating audit entries.
    for (let cycle = 0; cycle < 5; cycle += 1) {
      hook.unmount();
      hook = renderHook(() =>
        useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
      );
      await flush();
      expect(hook.result.current.requestQueue).toHaveLength(8);
      // Every remount that rehydrates a non-empty queue must set the
      // restored indicator so the UI can tell the user their state survived.
      expect(hook.result.current.sessionRestored).not.toBeNull();
      expect(hook.result.current.sessionRestored?.queueSize).toBe(8);
    }

    // Grant viewer-3 → the other 7 must be auto-denied AND audit-logged.
    act(() => {
      hook.result.current.grantRequest('viewer-3', false);
    });
    expect(hook.result.current.requestQueue).toEqual([]);
    expect(hook.result.current.activeController?.id).toBe('viewer-3');

    // Final invariants — exact counts, not "at least".
    const audit = getRCAudit();
    const byAction = (a: string) => audit.filter((e) => e.action === a);
    expect(byAction('queue-added')).toHaveLength(8);
    expect(byAction('grant')).toHaveLength(1);
    expect(byAction('deny')).toHaveLength(7);

    // The 7 auto-denies are exactly the 7 non-granted viewers, in queue order.
    expect(byAction('deny').map((e) => e.targetId)).toEqual([
      'viewer-0', 'viewer-1', 'viewer-2',
      'viewer-4', 'viewer-5', 'viewer-6', 'viewer-7',
    ]);
    // The single grant is for viewer-3, mouse-only.
    const grant = byAction('grant')[0];
    expect(grant.targetId).toBe('viewer-3');
    expect(grant.mode).toBe('mouse');
  });

  it('is reproducible: two runs of the same seeded scenario produce identical audit fingerprints', async () => {
    const run = async () => {
      clearRCAudit();
      resetRCReplayWindow();
      window.sessionStorage.clear();
      counter = 0;
      rand = seededPRNG(0xC0FFEE);
      const meetingId = 'reproducible-meeting';
      const hook = renderHook(() =>
        useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
      );
      await flush();
      act(() => {
        for (let i = 0; i < 5; i += 1) {
          hook.result.current.__handleMessage(
            wire(
              meetingId,
              { kind: 'request', from: `v-${i}`, name: `V${i}`, to: 'presenter-session' },
              FIXED_NOW,
              uuid,
            ),
          );
        }
      });
      // Let React commit the queue state before invoking grantRequest —
      // otherwise the useCallback closure sees an empty queue and no-ops.
      await flush();
      act(() => {
        hook.result.current.grantRequest('v-2', true);
      });
      const fp = getRCAudit().map((e) => `${e.action}:${e.actorId ?? '_'}:${e.targetId ?? '_'}:${e.mode ?? '_'}`);
      hook.unmount();
      return fp;
    };

    const fp1 = await run();
    const fp2 = await run();
    expect(fp2).toEqual(fp1);
    // And the fingerprint itself is exactly what we expect.
    expect(fp1).toEqual([
      'queue-added:v-0:presenter-session:_',
      'queue-added:v-1:presenter-session:_',
      'queue-added:v-2:presenter-session:_',
      'queue-added:v-3:presenter-session:_',
      'queue-added:v-4:presenter-session:_',
      'deny:presenter-session:v-0:_',
      'deny:presenter-session:v-1:_',
      'deny:presenter-session:v-3:_',
      'deny:presenter-session:v-4:_',
      'grant:presenter-session:v-2:mouse+keyboard',
    ]);
  });
});