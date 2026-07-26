import { useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MousePointer2, Hand, MonitorCog, KeyRound, X } from 'lucide-react';
import type { UseRemoteControlReturn } from '@/hooks/useRemoteControl';
import type { RCInputEvent } from '@/lib/remoteControl/protocol';
import { cn } from '@/lib/utils';

interface RemoteControlOverlayProps {
  rc: UseRemoteControlReturn;
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
export function RemoteControlOverlay({ rc }: RemoteControlOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: -1, y: -1 });

  const {
    remotePresenterId,
    remotePresenterName,
    isLocalPresenter,
    remoteCursors,
    ripples,
    status,
    incomingRequest,
    activeController,
    requestControl,
    cancelRequest,
    releaseControl,
    grantIncoming,
    denyIncoming,
    sendCursor,
    sendRipple,
    sendInput,
  } = rc;

  const isControlling = status.state === 'controlling';

  // Convert client coordinates into normalized (0..1) coords relative to the overlay.
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(rect.height, 1)));
    return { x, y };
  }, []);

  // --- Live cursor broadcast (throttled ~30Hz) ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const { x, y } = toNorm(e.clientX, e.clientY);
      const now = performance.now();
      const last = lastSentRef.current;
      if (now - last.t < 33 && Math.abs(x - last.x) < 0.003 && Math.abs(y - last.y) < 0.003) return;
      lastSentRef.current = { t: now, x, y };
      sendCursor(x, y, true);
      if (isControlling) sendInput({ type: 'mousemove', x, y });
    };
    const onLeave = () => {
      const last = lastSentRef.current;
      sendCursor(last.x < 0 ? 0 : last.x, last.y < 0 ? 0 : last.y, false);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [isControlling, sendCursor, sendInput, toNorm]);

  // --- Click / mouse buttons ---
  const buttonMap = useCallback((b: number): 'left' | 'right' | 'middle' => {
    if (b === 2) return 'right';
    if (b === 1) return 'middle';
    return 'left';
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const { x, y } = toNorm(e.clientX, e.clientY);
      const btn = buttonMap(e.button);
      sendRipple(x, y, btn);
      if (isControlling) {
        sendInput({ type: 'mousedown', x, y, button: btn });
      }
    },
    [buttonMap, isControlling, sendInput, sendRipple, toNorm],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isControlling) return;
      const { x, y } = toNorm(e.clientX, e.clientY);
      const btn = buttonMap(e.button);
      sendInput({ type: 'mouseup', x, y, button: btn });
      sendInput({ type: 'click', x, y, button: btn, detail: e.detail || 1 });
    },
    [buttonMap, isControlling, sendInput, toNorm],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isControlling) return;
      const { x, y } = toNorm(e.clientX, e.clientY);
      sendInput({ type: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
    },
    [isControlling, sendInput, toNorm],
  );

  const onContext = useCallback((e: React.MouseEvent) => {
    // Prevent native context menu when interacting with overlay.
    e.preventDefault();
  }, []);

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
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onContextMenu={onContext}
      className={cn(
        'absolute inset-0 z-30',
        // Always pointer-events-auto so we can capture cursor moves for the shared pointer.
        'pointer-events-auto',
        // When controlling, use a crosshair to signal active control.
        isControlling ? 'cursor-crosshair' : 'cursor-none',
      )}
      data-testid="remote-control-overlay"
      aria-label="Remote control overlay"
    >
      {/* Remote cursors */}
      {cursorList.map((c) => (
        <div
          key={c.id}
          className="absolute pointer-events-none transition-transform duration-75 ease-linear"
          style={{
            left: `${c.x * 100}%`,
            top: `${c.y * 100}%`,
            transform: 'translate(-4px, -4px)',
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

      {/* Top-right status/request panel */}
      <div className="absolute top-3 right-3 pointer-events-auto flex flex-col items-end gap-2">
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

      {/* Incoming request prompt (presenter side) */}
      {isLocalPresenter && incomingRequest && (
        <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {incomingRequest.name} wants to control your screen
              </span>
              <span className="text-[11px] text-muted-foreground">
                Grant mouse + optionally keyboard. Press Esc anytime to reclaim.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => denyIncoming('Not now')}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" /> Deny
              </button>
              <button
                onClick={() => grantIncoming(false)}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80"
              >
                <MonitorCog className="h-3.5 w-3.5" /> Mouse only
              </button>
              <button
                onClick={() => grantIncoming(true)}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <KeyRound className="h-3.5 w-3.5" /> Mouse + Keyboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}