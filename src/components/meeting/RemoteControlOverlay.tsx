import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MousePointer2,
  MonitorCog,
  KeyRound,
  X,
  Lock,
  Sliders,
  Activity,
  RefreshCw,
  Layers,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MonitorUp,
} from 'lucide-react';
import type { UseRemoteControlReturn } from '@/hooks/useRemoteControl';
import type { RCInputEvent } from '@/lib/remoteControl/protocol';
import { RemoteControlSettingsPanel } from './RemoteControlSettingsPanel';
import { cn } from '@/lib/utils';
import { useVideoContentBox } from '@/hooks/useVideoContentBox';
import { clientToNormalized } from '@/lib/annotation/geometry';

interface RemoteControlOverlayProps {
  rc: UseRemoteControlReturn;
  meetingId: string;
  /** True only when a live screen-share video track is playing. */
  screenTrackLive?: boolean;
  /** Peer id of the presenter whose screen track we are receiving. */
  presenterPeerId?: string | null;
  /** Collects per-peer transceiver/SSRC mapping for the validation panel. */
  getDiagnosticsSnapshot?: () => Promise<unknown>;
  /** The shared-screen <video>; coordinates are normalized to its painted content box. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** True while the annotation layer owns the pointer (no cursor/input is sent). */
  suspended?: boolean;
}

interface PeerMappingRow {
  peerId: string;
  connectionState: string;
  screenVideoSsrc: string | null;
  screenMid: string | null;
  screenDirection: string | null;
  faceVideoSsrc: string | null;
  audioSsrc: string | null;
  hasScreenTrack: boolean;
  isControlPeer: boolean;
}

/** Flattens a diagnostics snapshot into per-peer screen/control mapping rows. */
function buildMappingRows(snapshot: unknown, presenterPeerId?: string | null): PeerMappingRow[] {
  const peers = (snapshot as { peers?: unknown[] } | null)?.peers;
  if (!Array.isArray(peers)) return [];
  return peers.map((raw) => {
    const peer = raw as {
      peerId: string;
      connectionState?: string;
      routing?: { screenTracks?: Array<{ id: string }>; faceTracks?: Array<{ id: string; kind: string }> };
      transceivers?: Array<{
        mid: string | null;
        direction?: string;
        currentDirection?: string | null;
        receiver?: { kind?: string | null; trackId?: string | null };
      }>;
      stats?: Array<Record<string, unknown>>;
    };
    const inbound = (peer.stats ?? []).filter((s) => s.type === 'inbound-rtp');
    const videoInbound = inbound.filter((s) => s.kind === 'video' || s.mediaType === 'video');
    const audioInbound = inbound.filter((s) => s.kind === 'audio' || s.mediaType === 'audio');
    const screenTrackIds = new Set((peer.routing?.screenTracks ?? []).map((t) => t.id));
    const screenTransceiver = (peer.transceivers ?? []).find(
      (t) => t.receiver?.kind === 'video' && t.receiver?.trackId && screenTrackIds.has(t.receiver.trackId),
    );
    const ssrcOf = (report: Record<string, unknown> | undefined) =>
      report && report.ssrc != null ? String(report.ssrc) : null;

    return {
      peerId: peer.peerId,
      connectionState: peer.connectionState ?? 'unknown',
      screenVideoSsrc: ssrcOf(videoInbound[videoInbound.length - 1]),
      screenMid: screenTransceiver?.mid ?? null,
      screenDirection: screenTransceiver?.currentDirection ?? screenTransceiver?.direction ?? null,
      faceVideoSsrc: ssrcOf(videoInbound[0]),
      audioSsrc: ssrcOf(audioInbound[0]),
      hasScreenTrack: screenTrackIds.size > 0,
      isControlPeer: !!presenterPeerId && peer.peerId === presenterPeerId,
    };
  });
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
export function RemoteControlOverlay({
  rc,
  meetingId,
  screenTrackLive = false,
  presenterPeerId = null,
  getDiagnosticsSnapshot,
  videoRef,
  suspended = false,
}: RemoteControlOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackVideoRef = useRef<HTMLVideoElement | null>(null);
  // Painted content box of the shared video (letterbox/pillarbox aware).
  const { box: contentBox } = useVideoContentBox(videoRef ?? fallbackVideoRef);
  const lastSentRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: -1, y: -1 });
  const [showSettings, setShowSettings] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [mappingRows, setMappingRows] = useState<PeerMappingRow[] | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

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
    sessionRestored,
    requestControl,
    cancelRequest,
    releaseControl,
    grantRequest,
    denyRequest,
    sendCursor,
    sendRipple,
    sendInput,
    lastFailureReason,
    reattachInfo,
    reattachSession,
  } = rc;

  const loadMapping = useCallback(async () => {
    if (!getDiagnosticsSnapshot) {
      setMappingError('Mapping data is not available in this view.');
      return;
    }
    setMappingLoading(true);
    setMappingError(null);
    try {
      const snapshot = await getDiagnosticsSnapshot();
      setMappingRows(buildMappingRows(snapshot, presenterPeerId));
    } catch (error) {
      setMappingError(String(error));
    } finally {
      setMappingLoading(false);
    }
  }, [getDiagnosticsSnapshot, presenterPeerId]);

  useEffect(() => {
    if (showMapping) void loadMapping();
  }, [showMapping, loadMapping]);

  const isControlling = status.state === 'controlling' && !suspended;

  // Convert client coordinates into normalized (0..1) coords relative to the
  // *painted presentation* (the video content box), so a 16:10 viewer looking
  // at a 16:9 screen still maps onto the right presenter pixel. Falls back to
  // the overlay box when no video element is available.
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const video = videoRef?.current;
    if (video && contentBox.width > 0 && contentBox.height > 0) {
      const rect = video.getBoundingClientRect();
      return clientToNormalized(clientX, clientY, { left: rect.left, top: rect.top }, contentBox, false);
    }
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
  }, [videoRef, contentBox]);

  // Remote cursors and ripples are positioned inside the same content box.
  const cursorStyle = useCallback(
    (x: number, y: number) => {
      const video = videoRef?.current;
      const el = containerRef.current;
      if (video && el && contentBox.width > 0) {
        const vr = video.getBoundingClientRect();
        const cr = el.getBoundingClientRect();
        return {
          left: vr.left - cr.left + contentBox.x + x * contentBox.width,
          top: vr.top - cr.top + contentBox.y + y * contentBox.height,
        };
      }
      return { left: `${x * 100}%`, top: `${y * 100}%` };
    },
    [videoRef, contentBox],
  );

  // --- Live cursor broadcast (throttled ~30Hz) via document listeners so
  // the overlay never blocks presenter controls like "Stop Sharing". ---
  useEffect(() => {
    if (suspended) return;
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
  }, [isControlling, sendCursor, sendInput, toNorm, tuning?.cursorSendMinMs, suspended]);

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
    if (suspended) return;
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
  }, [buttonMap, isControlling, sendInput, sendRipple, toNorm, suspended]);

  // --- Keyboard capture while controlling ---
  useEffect(() => {
    if (status.state !== 'controlling') return;
    const allowKeyboard = status.allowKeyboard;

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
        // Emergency release works in every mode, keyboard permission or not.
        e.preventDefault();
        releaseControl();
        return;
      }
      if (!allowKeyboard || suspended) return;
      e.preventDefault();
      sendInput(buildKey(e, 'keydown'));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!allowKeyboard || suspended) return;
      e.preventDefault();
      sendInput(buildKey(e, 'keyup'));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [releaseControl, sendInput, status, suspended]);

  const cursorList = useMemo(
    () => Array.from(remoteCursors.values()).filter((c) => c.visible),
    [remoteCursors],
  );

  // Remote Desktop is only offered when a live screen-share track is playing
  // AND we are linked to the presenter peer that is sending it.
  const presenterLinked = !!remotePresenterId && (!presenterPeerId || presenterPeerId === remotePresenterId);
  const canRequest = !isLocalPresenter && presenterLinked && screenTrackLive;

  const handshake: { tone: 'pending' | 'granted' | 'denied'; label: string } | null =
    status.state === 'requesting'
      ? { tone: 'pending', label: `Permission pending — waiting for ${remotePresenterName}` }
      : status.state === 'controlling'
        ? { tone: 'granted', label: `Permission granted${status.allowKeyboard ? ' (mouse + keyboard)' : ' (mouse only)'}` }
        : status.state === 'denied'
          ? { tone: 'denied', label: 'Permission denied' }
          : lastFailureReason
            ? { tone: 'denied', label: 'Permission not applied' }
            : null;

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
            ...cursorStyle(c.x, c.y),
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
              ...cursorStyle(r.x, r.y),
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

      {/* Transient "Session restored" pill — shown for ~6s after a
          reconnect if useRemoteControl rehydrated non-trivial queue/lock/
          pending-request state from sessionStorage. Sits below the lock
          indicator so both remain visible when they coincide. */}
      {sessionRestored && (
        <div
          data-testid="rc-restored-indicator"
          className={cn(
            'absolute left-3 pointer-events-auto',
            controlLock ? 'top-14' : 'top-3',
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 shadow-lg backdrop-blur">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="font-medium">Session restored</span>
            <span className="text-[10px] opacity-80">
              {sessionRestored.wasControlling
                ? 'Your control resumed'
                : sessionRestored.wasRequesting
                  ? 'Your request is still pending'
                  : sessionRestored.queueSize > 0
                    ? `${sessionRestored.queueSize} request${sessionRestored.queueSize === 1 ? '' : 's'} restored`
                    : sessionRestored.hadLock
                      ? 'Control lock restored'
                      : 'State restored'}
            </span>
          </div>
        </div>
      )}

      {/* Top-right status/request panel */}
      <div className="absolute top-3 right-3 pointer-events-auto flex flex-col items-end gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowDiagnostics((v) => !v)}
            title="Remote control diagnostics"
            aria-label="Remote control diagnostics"
            aria-expanded={showDiagnostics}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/70 text-muted-foreground shadow hover:bg-muted backdrop-blur"
          >
            <Activity className="h-3 w-3" />
          </button>
          {showDiagnostics && (
          <>
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
          <button
            data-testid="rc-mapping-toggle"
            onClick={() => setShowMapping((v) => !v)}
            title="Validate which SSRC / transceiver carries the shared screen and desktop control"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shadow hover:bg-muted backdrop-blur"
          >
            <Layers className="h-3 w-3" /> Mapping
          </button>
          </>
          )}
        </div>

        {/* Permission handshake status + exact failure reason */}
        {handshake && (
          <div
            data-testid="rc-handshake-status"
            role="status"
            aria-live="polite"
            className={cn(
              'w-64 rounded-xl border px-3 py-2 text-[11px] shadow-lg backdrop-blur',
              handshake.tone === 'granted'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : handshake.tone === 'pending'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              {handshake.tone === 'granted' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : handshake.tone === 'pending' ? (
                <Clock className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              <span>{handshake.label}</span>
            </div>
            {handshake.tone !== 'granted' && lastFailureReason && (
              <p className="mt-1 leading-snug opacity-90" data-testid="rc-failure-reason">
                Reason: {lastFailureReason}
              </p>
            )}
            {reattachInfo && (
              <p className="mt-1 text-[10px] opacity-70">
                Re-attached {reattachInfo.count}× · last: {reattachInfo.reason}
              </p>
            )}
          </div>
        )}

        {/* Per-peer SSRC / transceiver mapping validation */}
        {showMapping && (
          <div
            data-testid="rc-mapping-panel"
            className="w-80 max-h-64 overflow-y-auto rounded-xl border border-border bg-background/95 p-3 text-[10px] shadow-lg backdrop-blur"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-foreground">Screen / control mapping</span>
              <div className="flex items-center gap-1">
                <button onClick={() => void loadMapping()} className="opacity-60 hover:opacity-100" aria-label="Refresh mapping">
                  <RefreshCw className={cn('h-3 w-3', mappingLoading && 'animate-spin')} />
                </button>
                <button onClick={() => setShowMapping(false)} className="opacity-60 hover:opacity-100" aria-label="Hide mapping">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            {mappingError && <p className="text-destructive">{mappingError}</p>}
            {!mappingError && (mappingRows?.length ?? 0) === 0 && !mappingLoading && (
              <p className="text-muted-foreground">No connected peers yet.</p>
            )}
            <ul className="flex flex-col gap-2">
              {(mappingRows ?? []).map((row) => (
                <li key={row.peerId} className="rounded-lg border border-border/60 bg-muted/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{row.peerId.slice(0, 12)}…</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[9px] font-semibold',
                        row.isControlPeer ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {row.isControlPeer ? 'Control peer' : row.connectionState}
                    </span>
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-2 tabular-nums">
                    <dt className="text-muted-foreground">Screen track</dt>
                    <dd className={cn('text-right', row.hasScreenTrack ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                      {row.hasScreenTrack ? 'present' : 'missing'}
                    </dd>
                    <dt className="text-muted-foreground">Screen SSRC</dt>
                    <dd className="text-right">{row.screenVideoSsrc ?? '—'}</dd>
                    <dt className="text-muted-foreground">Screen mid / dir</dt>
                    <dd className="text-right">
                      {row.screenMid ?? '—'} / {row.screenDirection ?? '—'}
                    </dd>
                    <dt className="text-muted-foreground">Camera SSRC</dt>
                    <dd className="text-right">{row.faceVideoSsrc ?? '—'}</dd>
                    <dt className="text-muted-foreground">Audio SSRC</dt>
                    <dd className="text-right">{row.audioSsrc ?? '—'}</dd>
                  </dl>
                  {row.isControlPeer && !row.hasScreenTrack && (
                    <p className="mt-1 text-destructive">
                      Control peer has no screen video — Remote Desktop stays hidden until the share track arrives.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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
          <div className="flex items-center gap-1">
            <button
              data-testid="rc-remote-desktop-button"
              onClick={requestControl}
              title={`Request desktop control of ${remotePresenterName}'s shared screen`}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              <MonitorUp className="h-3.5 w-3.5" />
              Remote Desktop
            </button>
            <button
              onClick={() => reattachSession('manual')}
              title="Re-attach the remote control session"
              className="inline-flex items-center rounded-full border border-border bg-background/80 p-1.5 text-muted-foreground shadow hover:bg-muted backdrop-blur"
              aria-label="Re-attach remote control session"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
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
        <div className="absolute inset-x-0 top-14 flex justify-center pointer-events-none">
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