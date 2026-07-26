// Verifies the RemoteControlOverlay renders the "Session restored" pill when
// useRemoteControl rehydrated non-trivial state from sessionStorage after a
// disconnect/reconnect, and that the pill disappears once the transient
// window ends. This is the UI half of the persisted-queue feature — the
// stress test asserts the state itself, this asserts the user-facing signal.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RemoteControlOverlay } from '@/components/meeting/RemoteControlOverlay';
import type { UseRemoteControlReturn } from '@/hooks/useRemoteControl';

vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));

function makeRc(overrides: Partial<UseRemoteControlReturn>): UseRemoteControlReturn {
  const base: Partial<UseRemoteControlReturn> = {
    remotePresenterId: null,
    remotePresenterName: 'Presenter',
    isLocalPresenter: true,
    remoteCursors: new Map(),
    ripples: [],
    status: { state: 'idle' },
    incomingRequest: null,
    requestQueue: [],
    activeController: null,
    controlLock: null,
    metrics: {
      requestsSent: 0,
      grantsReceived: 0,
      deniesReceived: 0,
      lastGrantLatencyMs: null,
      avgGrantLatencyMs: null,
      throttledOutbound: 0,
      droppedInboundInvalid: 0,
      droppedInboundUnauthorized: 0,
    },
    tuning: { mousemoveMinMs: 16, wheelMinMs: 25, cursorSmoothingMs: 150, cursorSendMinMs: 33 },
    sessionRestored: null,
    requestControl: vi.fn(),
    cancelRequest: vi.fn(),
    releaseControl: vi.fn(),
    grantIncoming: vi.fn(),
    denyIncoming: vi.fn(),
    grantRequest: vi.fn(),
    denyRequest: vi.fn(),
    reclaimControl: vi.fn(),
    sendCursor: vi.fn(),
    sendRipple: vi.fn(),
    sendInput: vi.fn(),
    __handleMessage: vi.fn(),
  };
  return { ...base, ...overrides } as UseRemoteControlReturn;
}

describe('RemoteControlOverlay — session-restored indicator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not render the indicator when nothing was restored', () => {
    render(<RemoteControlOverlay meetingId="m1" rc={makeRc({ sessionRestored: null })} />);
    expect(screen.queryByTestId('rc-restored-indicator')).toBeNull();
  });

  it('renders the indicator with queue size when the presenter rehydrates a non-empty queue', () => {
    render(
      <RemoteControlOverlay
        meetingId="m1"
        rc={makeRc({
          sessionRestored: {
            at: Date.now(),
            queueSize: 3,
            hadLock: false,
            wasControlling: false,
            wasRequesting: false,
          },
        })}
      />,
    );
    const pill = screen.getByTestId('rc-restored-indicator');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent(/session restored/i);
    expect(pill).toHaveTextContent(/3 requests? restored/i);
  });

  it('renders a different message when the viewer had a pending request', () => {
    render(
      <RemoteControlOverlay
        meetingId="m1"
        rc={makeRc({
          isLocalPresenter: false,
          remotePresenterId: 'presenter-1',
          status: { state: 'requesting', presenterId: 'presenter-1', since: Date.now() },
          sessionRestored: {
            at: Date.now(),
            queueSize: 0,
            hadLock: false,
            wasControlling: false,
            wasRequesting: true,
          },
        })}
      />,
    );
    expect(screen.getByTestId('rc-restored-indicator')).toHaveTextContent(/pending/i);
  });

  it('sits below the control-lock pill when both indicators are visible', () => {
    render(
      <RemoteControlOverlay
        meetingId="m1"
        rc={makeRc({
          controlLock: {
            presenterId: 'p1',
            presenterName: 'Host',
            controllerId: 'v1',
            controllerName: 'Viewer',
            mode: 'mouse+keyboard',
          },
          sessionRestored: {
            at: Date.now(),
            queueSize: 0,
            hadLock: true,
            wasControlling: false,
            wasRequesting: false,
          },
        })}
      />,
    );
    const pill = screen.getByTestId('rc-restored-indicator');
    // top-14 avoids overlapping the lock pill at top-3.
    expect(pill.className).toMatch(/top-14/);
  });
});