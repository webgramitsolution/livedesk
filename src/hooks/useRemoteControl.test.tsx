import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Mock the meeting store to provide a stable sessionId.
vi.mock('@/store/meetingStore', () => ({
  useMeetingStore: (selector: (s: unknown) => unknown) =>
    selector({ meetingSessionId: 'presenter-session', userName: 'Host' }),
}));

// Toasts and WebRTC event logger are no-ops in tests.
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }) }));
vi.mock('@/lib/webrtcLogger', () => ({ logWebRTCEvent: () => {} }));

// Minimal fake Supabase channel — we don't exercise real broadcast in the
// unit test; the hook exposes `__handleMessage` for deterministic injection.
vi.mock('@/integrations/supabase/client', () => {
  return {
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
  };
});

import { useRemoteControl } from './useRemoteControl';
import { clearRCAudit, getRCAudit } from '@/lib/remoteControl/auditLog';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useRemoteControl — multi-viewer queue, audit log, lock', () => {
  beforeEach(() => {
    clearRCAudit();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('queues multiple requesters, grants one, and denies the rest deterministically', async () => {
    const { result } = renderHook(() =>
      useRemoteControl({
        meetingId: 'meeting-A',
        isInMeeting: true,
        isLocalPresenter: true,
      }),
    );

    await flush();

    // Simulate two viewers requesting control at different times.
    act(() => {
      result.current.__handleMessage({
        kind: 'request',
        from: 'viewer-1',
        name: 'Alice',
        to: 'presenter-session',
      });
      result.current.__handleMessage({
        kind: 'request',
        from: 'viewer-2',
        name: 'Bob',
        to: 'presenter-session',
      });
      // Duplicate request from viewer-1 must be deduped.
      result.current.__handleMessage({
        kind: 'request',
        from: 'viewer-1',
        name: 'Alice',
        to: 'presenter-session',
      });
    });

    expect(result.current.requestQueue.map((r) => r.from)).toEqual(['viewer-1', 'viewer-2']);

    // Grant control to viewer-2 with mouse+keyboard.
    act(() => {
      result.current.grantRequest('viewer-2', true);
    });

    // Queue drains, active controller is viewer-2, lock indicator reflects them.
    expect(result.current.requestQueue).toEqual([]);
    expect(result.current.activeController?.id).toBe('viewer-2');
    expect(result.current.activeController?.allowKeyboard).toBe(true);

    // Audit log records the queue-add, grant, and implicit denials.
    const audit = getRCAudit();
    const actions = audit.map((e) => e.action);
    expect(actions).toContain('queue-added');
    expect(actions).toContain('grant');

    // Simulate the presenter having broadcast the lock — a lock message from
    // the actual presenter session should update every peer's indicator.
    // (When we ARE the presenter the lock is set directly by grantRequest;
    //  when we are a viewer, lock messages arrive on the wire.)
    const viewer = renderHook(() =>
      useRemoteControl({
        meetingId: 'meeting-A',
        isInMeeting: true,
        isLocalPresenter: false,
      }),
    );
    await flush();
    act(() => {
      // Viewer must first learn who the presenter is, otherwise lock messages
      // are rejected as unauthorized.
      viewer.result.current.__handleMessage({
        kind: 'presenter',
        from: 'presenter-session',
        name: 'Host',
        sharing: true,
      });
      viewer.result.current.__handleMessage({
        kind: 'lock',
        from: 'presenter-session',
        presenterName: 'Host',
        controllerId: 'viewer-2',
        controllerName: 'Bob',
        mode: 'mouse+keyboard',
      });
    });
    expect(viewer.result.current.controlLock).toEqual({
      presenterId: 'presenter-session',
      presenterName: 'Host',
      controllerId: 'viewer-2',
      controllerName: 'Bob',
      mode: 'mouse+keyboard',
    });
  });

  it('rejects lock messages from unauthorized (non-presenter) senders', async () => {
    const { result } = renderHook(() =>
      useRemoteControl({ meetingId: 'meeting-B', isInMeeting: true, isLocalPresenter: false }),
    );
    await flush();

    act(() => {
      // No presenter registered yet — a random peer trying to claim the lock is dropped.
      result.current.__handleMessage({
        kind: 'lock',
        from: 'impostor',
        presenterName: 'Fake',
        controllerId: 'x',
        controllerName: 'Y',
        mode: 'mouse',
      });
    });

    expect(result.current.controlLock).toBeNull();
    expect(result.current.metrics.droppedInboundUnauthorized).toBeGreaterThan(0);
  });

  it('validates message shape and drops malformed payloads', async () => {
    const { result } = renderHook(() =>
      useRemoteControl({ meetingId: 'meeting-C', isInMeeting: true, isLocalPresenter: true }),
    );
    await flush();

    act(() => {
      // Missing required fields.
      result.current.__handleMessage({ kind: 'request', from: 'viewer-9' });
      result.current.__handleMessage(null);
      result.current.__handleMessage({ foo: 'bar' });
    });

    expect(result.current.requestQueue).toEqual([]);
    expect(result.current.metrics.droppedInboundInvalid).toBeGreaterThanOrEqual(3);
  });
});
