import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Same lightweight mocks as the primary suite — the stress test focuses on
// the state machine, not real Realtime transport.
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
import { signRC, newNonce } from '@/lib/remoteControl/protocol';
import { resetRCReplayWindow } from '@/lib/remoteControl/validation';

function wire<T extends { kind: string; from: string }>(meetingId: string, msg: T) {
  const msgId = newNonce();
  const ts = Date.now();
  const sig = signRC({ kind: msg.kind, from: msg.from, msgId, ts, meetingId });
  return { ...msg, msgId, ts, sig };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useRemoteControl — stress: rapid disconnect/reconnect + concurrent requests', () => {
  beforeEach(() => {
    clearRCAudit();
    resetRCReplayWindow();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('resumes persisted queue across many remount cycles without duplicating grants or denies', async () => {
    const meetingId = 'stress-meeting';
    // 1) Mount → 8 concurrent viewer requests arrive. Half repeat to prove dedup.
    let hook = renderHook(() =>
      useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
    );
    await flush();

    act(() => {
      for (let i = 0; i < 8; i += 1) {
        hook.result.current.__handleMessage(
          wire(meetingId, {
            kind: 'request',
            from: `viewer-${i}`,
            name: `Viewer ${i}`,
            to: 'presenter-session',
          }),
        );
      }
      // Duplicates: same senders again.
      for (let i = 0; i < 4; i += 1) {
        hook.result.current.__handleMessage(
          wire(meetingId, {
            kind: 'request',
            from: `viewer-${i}`,
            name: `Viewer ${i}`,
            to: 'presenter-session',
          }),
        );
      }
    });

    expect(hook.result.current.requestQueue).toHaveLength(8);

    // 2) Rapidly disconnect/reconnect the hook 5 times — simulates a viewer
    //    (or in this case, the presenter's own tab) flapping. Each remount
    //    reads the persisted snapshot from sessionStorage.
    for (let cycle = 0; cycle < 5; cycle += 1) {
      // eslint-disable-next-line no-console
      console.log('cycle', cycle, 'before-unmount storage=', window.sessionStorage.getItem('rc-state:stress-meeting:presenter-session')?.slice(0, 60));
      hook.unmount();
      // eslint-disable-next-line no-console
      console.log('cycle', cycle, 'after-unmount  storage=', window.sessionStorage.getItem('rc-state:stress-meeting:presenter-session')?.slice(0, 60));
      hook = renderHook(() =>
        useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
      );
      await flush();
      // eslint-disable-next-line no-console
      console.log('cycle', cycle, 'after-remount  queue=', hook.result.current.requestQueue.length);
      // Queue must survive every reconnect exactly as it was.
      expect(hook.result.current.requestQueue).toHaveLength(8);
    }

    // 3) Grant one viewer. The rest MUST be auto-denied, and a subsequent
    //    remount must not re-add them (persistence should reflect the final
    //    drained queue + active controller).
    act(() => {
      hook.result.current.grantRequest('viewer-3', false);
    });
    expect(hook.result.current.requestQueue).toEqual([]);
    expect(hook.result.current.activeController?.id).toBe('viewer-3');

    hook.unmount();
    hook = renderHook(() =>
      useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
    );
    await flush();
    expect(hook.result.current.requestQueue).toEqual([]);
    expect(hook.result.current.activeController?.id).toBe('viewer-3');

    // 4) Audit log invariants: exactly one grant recorded, and no duplicate
    //    queue-added entries beyond the original 8 unique senders (replays
    //    dropped by the msgId LRU + the queue's own dedup).
    const audit = getRCAudit();
    const grants = audit.filter((e) => e.action === 'grant');
    expect(grants).toHaveLength(1);
    const queueAdds = audit.filter((e) => e.action === 'queue-added');
    expect(queueAdds).toHaveLength(8);
  });

  it('replayed captured messages are dropped by the msgId LRU', async () => {
    const meetingId = 'replay-meeting';
    const hook = renderHook(() =>
      useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: true }),
    );
    await flush();

    const captured = wire(meetingId, {
      kind: 'request',
      from: 'attacker',
      name: 'Attacker',
      to: 'presenter-session',
    });

    act(() => {
      hook.result.current.__handleMessage(captured);
      // Same envelope replayed 20 times — must all be dropped after the first.
      for (let i = 0; i < 20; i += 1) {
        hook.result.current.__handleMessage(captured);
      }
    });

    expect(hook.result.current.requestQueue).toHaveLength(1);
    expect(hook.result.current.metrics.droppedInboundInvalid).toBeGreaterThanOrEqual(20);
  });
});