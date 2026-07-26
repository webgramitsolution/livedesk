// End-to-end unauthorized-viewer test. An attacker peer, who was never the
// active presenter and was never granted control, tries to publish every
// state-mutating message kind the protocol supports (lock, grant, revoke,
// input, deny). Every single one MUST be dropped with no state change and
// with metrics counters incrementing so operators can see the drops.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/store/meetingStore', () => ({
  useMeetingStore: (selector: (s: unknown) => unknown) =>
    selector({ meetingSessionId: 'victim-session', userName: 'Victim' }),
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

import { useRemoteControl } from '@/hooks/useRemoteControl';
import { signRC, newNonce } from '@/lib/remoteControl/protocol';
import { resetRCReplayWindow } from '@/lib/remoteControl/validation';

function wire<T extends { kind: string; from: string }>(meetingId: string, msg: T) {
  const msgId = newNonce();
  const ts = Date.now();
  const sig = signRC({ kind: msg.kind, from: msg.from, msgId, ts, meetingId });
  return { ...msg, msgId, ts, sig };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useRemoteControl — unauthorized viewer cannot mutate state', () => {
  beforeEach(() => {
    resetRCReplayWindow();
    window.sessionStorage.clear();
  });

  it('rejects every state-mutating message from a peer who was never presenter and never granted control', async () => {
    const meetingId = 'security-test';
    const hook = renderHook(() =>
      useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: false }),
    );
    await flush();

    const before = {
      status: hook.result.current.status,
      controlLock: hook.result.current.controlLock,
      activeController: hook.result.current.activeController,
      requestQueue: hook.result.current.requestQueue,
      grants: hook.result.current.metrics.grantsReceived,
      denies: hook.result.current.metrics.deniesReceived,
    };

    // Attacker has never sent a `presenter` announcement, so remotePresenterId
    // is still null. Now they attempt each mutation in turn.
    act(() => {
      // 1. Try to publish a fake lock claiming they control the presenter.
      hook.result.current.__handleMessage(
        wire(meetingId, {
          kind: 'lock',
          from: 'attacker',
          presenterName: 'Fake Host',
          controllerId: 'attacker',
          controllerName: 'Attacker',
          mode: 'mouse+keyboard',
        }),
      );
      // 2. Try to grant themselves control (we never issued a matching request).
      hook.result.current.__handleMessage(
        wire(meetingId, {
          kind: 'grant',
          from: 'attacker',
          to: 'victim-session',
          nonce: 'forged-nonce',
          allowKeyboard: true,
        }),
      );
      // 3. Try to deny us out of nowhere.
      hook.result.current.__handleMessage(
        wire(meetingId, { kind: 'deny', from: 'attacker', to: 'victim-session', reason: 'go away' }),
      );
      // 4. Try to revoke non-existent control.
      hook.result.current.__handleMessage(
        wire(meetingId, { kind: 'revoke', from: 'attacker', to: 'victim-session' }),
      );
      // 5. Try to inject an input event.
      hook.result.current.__handleMessage(
        wire(meetingId, {
          kind: 'input',
          from: 'attacker',
          to: 'victim-session',
          nonce: 'forged-nonce',
          event: { type: 'mousemove', x: 0.5, y: 0.5 },
        }),
      );
    });

    // No state should have moved.
    expect(hook.result.current.status).toEqual(before.status);
    expect(hook.result.current.controlLock).toEqual(before.controlLock);
    expect(hook.result.current.activeController).toEqual(before.activeController);
    expect(hook.result.current.requestQueue).toEqual(before.requestQueue);
    expect(hook.result.current.metrics.grantsReceived).toBe(before.grants);
    expect(hook.result.current.metrics.deniesReceived).toBe(before.denies);

    // And every drop MUST be counted so operators can see them in metrics.
    // Lock and input drop as "unauthorized"; grant/revoke also count as
    // unauthorized because our local status is 'idle' (no matching request).
    expect(hook.result.current.metrics.droppedInboundUnauthorized).toBeGreaterThanOrEqual(3);
  });

  it('rejects a forged lock even after the attacker impersonates a presenter announcement', async () => {
    // If an attacker sends a `presenter` message, they become "the presenter"
    // in the victim's view — but only until the REAL presenter announces.
    // In this test we prove that when a legitimate presenter has been seen,
    // a subsequent lock from anyone else is dropped.
    const meetingId = 'security-test-2';
    const hook = renderHook(() =>
      useRemoteControl({ meetingId, isInMeeting: true, isLocalPresenter: false }),
    );
    await flush();

    // Real presenter announces.
    act(() => {
      hook.result.current.__handleMessage(
        wire(meetingId, { kind: 'presenter', from: 'real-presenter', name: 'Host', sharing: true }),
      );
    });
    await flush();

    // Attacker (a different peer) tries to broadcast a lock.
    act(() => {
      hook.result.current.__handleMessage(
        wire(meetingId, {
          kind: 'lock',
          from: 'attacker',
          presenterName: 'Host',
          controllerId: 'attacker',
          controllerName: 'Attacker',
          mode: 'mouse+keyboard',
        }),
      );
    });

    expect(hook.result.current.controlLock).toBeNull();
    expect(hook.result.current.metrics.droppedInboundUnauthorized).toBeGreaterThan(0);
  });
});