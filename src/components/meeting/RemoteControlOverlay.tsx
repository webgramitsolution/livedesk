import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MousePointer2, Hand, MonitorCog, KeyRound, X, Lock, Sliders, Activity } from 'lucide-react';
import type { UseRemoteControlReturn } from '@/hooks/useRemoteControl';
import type { RCInputEvent } from '@/lib/remoteControl/protocol';
import { RemoteControlSettingsPanel } from './RemoteControlSettingsPanel';
import { cn } from '@/lib/utils';

interface RemoteControlOverlayProps {
  rc: UseRemoteControlReturn;
  meetingId: string;
}

/**
 * Full-bleed overlay rendered on top of the shared-screen video area.
 *
 * Layers:
 * 1. Always-on cursor + click-ripple layer (visible to everyone).
 * 2. Request/Give-control UI in the top-right.
 * 3. Input capture layer that only activates when the local viewer has been
 *    granted control. Pointer + keyboard events are streamed to the presenter.
 */
export function RemoteControlOverlay({ rc, meetingId }: RemoteControlOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: -1, y: -1 });
  const [showSettings, setShowSettings] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);

  const {
    remotePresenterId,
    remotePresenterName,
    isLocalPresenter,
    remoteCursors,
    ripples,
    status,
    requestQueue,
    activeController,
    controlLock,
    metrics,
    tuning,
    requestControl,
    cancelRequest,
    releaseControl,
    grantRequest,
    denyRequest,
    sendCursor,
    sendRipple,
    sendInput,
  } = rc;

  const isControlling = status.state === 'controlling';

  // Convert client coordinates into normalized (0..1) coords relative to the overlay.
  // Returns null if the cursor is outside the shared-screen area.
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const x = (clientX - rect.left) / Math.max(rect.width, 1);
    const y = (clientY - rect.top) / Math.max(rect.height, 1);
    return { x, y };
  }, []);

  // --- Live cursor broadcast (throttled ~30Hz) via document listeners so
  // the overlay never blocks presenter controls like "Stop Sharing". ---
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const norm = toNorm(e.clientX, e.clientY);
      const now = performance.now();
      if (!norm) {
        // Cursor outside the shared area — hide our cursor for peers.
        const last = lastSentRef.current;
        if (last.x >= 0 && now - last.t > 100) {
          lastSentRef.current = { t: now, x: -1, y: -1 };
          sendCursor(Math.max(0, last.x), Math.max(0, last.y), false);
        }
        return;
      }
      const last = lastSentRef.current;
      const minMs = tuning?.cursorSendMinMs ?? 33;
      if (now - last.t < minMs && Math.abs(norm.x - last.x) < 0.003 && Math.abs(norm.y - last.y) < 0.003) return;
      lastSentRef.current = { t: now, x: norm.x, y: norm.y };
      sendCursor(norm.x, norm.y, true);
      if (isControlling) sendInput({ type: 'mousemove', x: norm.x, y: norm.y });
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
    };
  }, [isControlling, sendCursor, sendInput, toNorm, tuning?.cursorSendMinMs]);

  // --- Click / mouse buttons ---
  const buttonMap = useCallback((b: number): 'left' | 'right' | 'middle' => {
    if (b === 2) return 'right';
    if (b === 1) return 'middle';
    return 'left';
  }, []);

  // Send a ripple whenever the user clicks inside the shared area (even the
  // presenter clicking their own Stop Sharing button will produce a ripple —
  // that's fine, it just visualizes clicks for everyone in the meeting).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const norm = toNorm(e.clientX, e.clientY);
      if (!norm) return;
      const btn = buttonMap(e.button);
      sendRipple(norm.x, norm.y, btn);
      if (isControlling) sendInput({ type: 'mousedown', x: norm.x, y: norm.y, button: btn });
    };
    const onUp = (e: PointerEvent) => {
      if (!isControlling) return;
      const norm = toNorm(e.clientX, e.clientY);
      if (!norm) return;
      const btn = buttonMap(e.button);
      sendInput({ type: 'mouseup', x: norm.x, y: norm.y, button: btn });
      sendInput({ type: 'click', x: norm.x, y: norm.y, button: btn, detail: (e as PointerEvent).detail || 1 });
    };
    const onWheel = (e: WheelEvent) => {
      if (!isControlling) return;
      const norm = toNorm(e.clientX, e.clientY);
      if (!norm) return;
      sendInput({ type: 'wheel', x: norm.x, y: norm.y, deltaX: e.deltaX, deltaY: e.deltaY });
    };

    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('wheel', onWheel);
    };
  }, [buttonMap, isControlling, sendInput, sendRipple, toNorm]);

  // --- Keyboard capture while controlling ---
  useEffect(() => {
    if (!isControlling) return;
    const allowKeyboard = status.state === 'controlling' ? status.allowKeyboard : false;
    if (!allowKeyboard) return;

    const buildKey = (e: KeyboardEvent, type: 'keydown' | 'keyup'): RCInputEvent => ({
      type,
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Local escape hatch: give up control.
        releaseControl();
        return;
      }
      sendInput(buildKey(e, 'keydown'));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      sendInput(buildKey(e, 'keyup'));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isControlling, releaseControl, sendInput, status]);

  const cursorList = useMemo(
    () => Array.from(remoteCursors.values()).filter((c) => c.visible),
    [remoteCursors],
  );

  // Show a "Request Control" panel only if there IS a remote presenter and it's not us.
  const canRequest = !!remotePresenterId && !isLocalPresenter;

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute inset-0 z-10',
        // The overlay itself never blocks clicks — inner controls opt in with
        // pointer-events-auto. Document-level listeners handle cursor and
        // click capture so the presenter's Stop-Sharing / Annotate bar keeps working.
        'pointer-events-none',
      )}
      data-testid="remote-control-overlay"
      aria-label="Remote control overlay"
    >
      {/* Remote cursors */}
      {cursorList.map((c) => (
        <div
          key={c.id}
          // Smooth cursor motion — CSS transition duration is per-meeting
          // tunable so hosts can dial jitter smoothing per network condition.
          className="absolute pointer-events-none will-change-transform"
          style={{
            left: `${c.x * 100}%`,
            top: `${c.y * 100}%`,
            transform: 'translate(-4px, -4px)',
            transition: `left ${tuning?.cursorSmoothingMs ?? 150}ms ease-out, top ${tuning?.cursorSmoothingMs ?? 150}ms ease-out`,
          }}
        >
          <MousePointer2
            className="drop-shadow-md"
            style={{ color: c.color, fill: c.color }}
            size={20}
            strokeWidth={1.25}
          />
          <span
            className="ml-3 -mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white shadow"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
          </span>
        </div>
      ))}

      {/* Click ripples */}
      <AnimatePresence>
        {ripples.map((r) => (
          <motion.span
            key={r.id}
            initial={{ opacity: 0.7, scale: 0.4 }}
            animate={{ opacity: 0, scale: 2.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            className="absolute pointer-events-none rounded-full"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: 32,
              height: 32,
              marginLeft: -16,
              marginTop: -16,
              border: `2px solid ${r.color}`,
              boxShadow: `0 0 12px ${r.color}`,
            }}
          />
        ))}
      </AnimatePresence>

      {/* Persistent control-lock indicator — visible to every participant. */}
      {controlLock && (
        <div className="absolute top-3 left-3 pointer-events-auto">
          <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">
              {controlLock.controllerName} is controlling {controlLock.presenterName}'s screen
            </span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {controlLock.mode === 'mouse+keyboard' ? 'Mouse + Keyboard' : 'Mouse only'}
            </span>
          </div>
        </div>
      )}

      {/* Top-right status/request panel */}
      <div className="absolute top-3 right-3 pointer-events-auto flex flex-col items-end gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowMetrics((v) => !v)}
            title="Toggle live control metrics"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shadow hover:bg-muted backdrop-blur"
          >
            <Activity className="h-3 w-3" /> Metrics
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Tune input rate limiting & cursor smoothing"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shadow hover:bg-muted backdrop-blur"
          >
            <Sliders className="h-3 w-3" /> Tune
          </button>
        </div>

        {showMetrics && metrics && (
          <div
            data-testid="rc-metrics"
            className="rounded-xl border border-border bg-background/95 px-3 py-2 text-[10px] shadow-lg backdrop-blur w-56"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">Control session</span>
              <button onClick={() => setShowMetrics(false)} className="opacity-60 hover:opacity-100" aria-label="Hide metrics">
                <X className="h-3 w-3" />
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
              <dt className="text-muted-foreground">Requests</dt>
              <dd className="text-right">{metrics.requestsSent}</dd>
              <dt className="text-muted-foreground">Grants</dt>
              <dd className="text-right">{metrics.grantsReceived}</dd>
              <dt className="text-muted-foreground">Denied</dt>
              <dd className="text-right">{metrics.deniesReceived}</dd>
              <dt className="text-muted-foreground">Last latency</dt>
              <dd className="text-right">{metrics.lastGrantLatencyMs != null ? `${metrics.lastGrantLatencyMs} ms` : '—'}</dd>
              <dt className="text-muted-foreground">Avg latency</dt>
              <dd className="text-right">{metrics.avgGrantLatencyMs != null ? `${metrics.avgGrantLatencyMs} ms` : '—'}</dd>
              <dt className="text-muted-foreground">Throttled out</dt>
              <dd className="text-right">{metrics.throttledOutbound}</dd>
              <dt className="text-muted-foreground">Dropped (invalid)</dt>
              <dd className="text-right">{metrics.droppedInboundInvalid}</dd>
              <dt className="text-muted-foreground">Dropped (unauth)</dt>
              <dd className="text-right">{metrics.droppedInboundUnauthorized}</dd>
            </dl>
          </div>
        )}

        {isLocalPresenter && activeController && (
          <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
            <span className="inline-flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="font-medium">{activeController.name} is controlling — Esc to reclaim</span>
          </div>
        )}

        {canRequest && status.state === 'idle' && (
          <button
            onClick={requestControl}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow hover:bg-muted backdrop-blur"
          >
            <Hand className="h-3.5 w-3.5 text-primary" />
            Request Control
          </button>
        )}

        {canRequest && status.state === 'requesting' && (
          <button
            onClick={cancelRequest}
            className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-background/95 px-3 py-1.5 text-xs shadow backdrop-blur"
          >
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            Waiting for {remotePresenterName}… <span className="opacity-60">Cancel</span>
          </button>
        )}

        {status.state === 'controlling' && (
          <button
            onClick={releaseControl}
            className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary shadow backdrop-blur"
          >
            <MonitorCog className="h-3.5 w-3.5" />
            You are controlling — release
          </button>
        )}

        {status.state === 'denied' && (
          <div className="rounded-full border border-destructive/40 bg-background/95 px-3 py-1.5 text-xs text-destructive shadow backdrop-blur">
            Request denied
          </div>
        )}
      </div>

      {/* Presenter-side control request queue. All pending requesters are
          shown so the presenter can grant/deny each one predictably. Granting
          one automatically denies the rest to avoid conflicts. */}
      {isLocalPresenter && requestQueue.length > 0 && (
        <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex flex-col gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur max-w-md w-full">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                Control requests ({requestQueue.length})
              </span>
              <span className="text-[10px] text-muted-foreground">Press Esc anytime to reclaim.</span>
            </div>
            <ul className="flex flex-col gap-2">
              {requestQueue.map((req) => (
                <li
                  key={req.from}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2"
                >
                  <span className="text-xs font-medium text-foreground truncate">{req.name}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => denyRequest(req.from, 'Not now')}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] hover:bg-muted"
                    >
                      <X className="h-3 w-3" /> Deny
                    </button>
                    <button
                      onClick={() => grantRequest(req.from, false)}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium hover:bg-secondary/80"
                    >
                      <MonitorCog className="h-3 w-3" /> Mouse
                    </button>
                    <button
                      onClick={() => grantRequest(req.from, true)}
                      className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      <KeyRound className="h-3 w-3" /> Mouse+Keys
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showSettings && (
        <RemoteControlSettingsPanel meetingId={meetingId} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}