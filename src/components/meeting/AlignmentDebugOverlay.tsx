import { useEffect, useRef, useState } from 'react';

interface DiagnosticEntry {
  t: number;
  kind: 'resize' | 'dpr' | 'orientation' | 'delta';
  detail: string;
}

/**
 * Dev-only overlay showing vertical center line + bounding boxes for the
 * floating control bar and inline bars. Enable via ?debug=align URL param
 * or localStorage.setItem('lovable:debug-align','1').
 */
export function AlignmentDebugOverlay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const check = () => {
      const url = new URLSearchParams(window.location.search);
      const flag = url.get('debug') === 'align' || localStorage.getItem('lovable:debug-align') === '1';
      setEnabled(flag);
    };
    check();
    window.addEventListener('popstate', check);
    return () => window.removeEventListener('popstate', check);
  }, []);

  if (!enabled) return null;

  return <DebugOverlayInner />;
}

function DebugOverlayInner() {
  const [log, setLog] = useState<DiagnosticEntry[]>([]);
  const [dims, setDims] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  });
  const [delta, setDelta] = useState<number | null>(null);
  const logRef = useRef(log);
  logRef.current = log;

  const push = (entry: Omit<DiagnosticEntry, 't'>) => {
    const next = [{ t: Date.now(), ...entry }, ...logRef.current].slice(0, 20);
    logRef.current = next;
    setLog(next);
  };

  useEffect(() => {
    // Throttle high-frequency events (resize/orientation) via rAF coalescing
    // + trailing setTimeout, so logging never spams during drag-resize.
    let resizeScheduled = false;
    let lastResizeLog = 0;
    const RESIZE_MIN_MS = 150;
    const onResize = () => {
      if (resizeScheduled) return;
      resizeScheduled = true;
      requestAnimationFrame(() => {
        resizeScheduled = false;
        const w = window.innerWidth;
        const h = window.innerHeight;
        setDims((d) => ({ ...d, w, h }));
        const now = performance.now();
        if (now - lastResizeLog >= RESIZE_MIN_MS) {
          lastResizeLog = now;
          push({ kind: 'resize', detail: `${w}×${h}` });
        }
      });
    };
    let orientScheduled = false;
    const onOrient = () => {
      if (orientScheduled) return;
      orientScheduled = true;
      requestAnimationFrame(() => {
        orientScheduled = false;
        push({ kind: 'orientation', detail: screen.orientation?.type ?? 'unknown' });
      });
    };
    let cleanupDpr: (() => void) | null = null;
    const listenDpr = () => {
      cleanupDpr?.();
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => {
        setDims((d) => ({ ...d, dpr: window.devicePixelRatio }));
        push({ kind: 'dpr', detail: `→ ${window.devicePixelRatio.toFixed(2)}` });
        listenDpr();
      };
      mq.addEventListener?.('change', onChange);
      cleanupDpr = () => mq.removeEventListener?.('change', onChange);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrient);
    listenDpr();

    // Sample centering delta of the floating control bar
    const sampleDelta = () => {
      const bar = document.querySelector<HTMLElement>('[data-testid="floating-control-bar"]');
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const d = Math.round((rect.left + rect.width / 2 - window.innerWidth / 2) * 100) / 100;
      setDelta((prev) => {
        if (prev !== null && Math.abs((prev ?? 0) - d) < 0.5) return prev;
        push({ kind: 'delta', detail: `${d > 0 ? '+' : ''}${d}px` });
        return d;
      });
    };
    sampleDelta();
    const interval = window.setInterval(sampleDelta, 750);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrient);
      cleanupDpr?.();
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9998]"
      style={{ contain: 'strict' }}
    >
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: '50%',
          width: '1px',
          background: 'repeating-linear-gradient(to bottom, hsl(0 90% 55%) 0 6px, transparent 6px 12px)',
          transform: 'translateX(-0.5px)',
        }}
      />
      <div
        className="absolute"
        style={{
          left: '50%',
          bottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + 22px)',
          transform: 'translateX(-50%)',
          width: '16px',
          height: '16px',
          borderRadius: '9999px',
          border: '1px solid hsl(0 90% 55%)',
        }}
      />
      <div className="pointer-events-auto absolute top-2 right-2 max-w-[280px] rounded-lg border border-border bg-background/95 p-2 text-[11px] font-mono text-foreground shadow-lg">
        <div className="mb-1 flex items-center justify-between gap-2 font-bold">
          <span>
          align-debug · {dims.w}×{dims.h} · dpr {dims.dpr.toFixed(2)}
          {delta !== null && (
            <span className={delta > 2 || delta < -2 ? 'text-destructive' : 'text-primary'}> · Δ {delta}px</span>
          )}
          </span>
          <button
            type="button"
            onClick={() => {
              const payload = {
                capturedAt: new Date().toISOString(),
                userAgent: navigator.userAgent,
                viewport: { w: dims.w, h: dims.h, dpr: dims.dpr },
                currentDeltaPx: delta,
                events: logRef.current,
              };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `align-debug-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-muted"
          >
            Save JSON
          </button>
        </div>
        <div className="max-h-[220px] overflow-y-auto space-y-0.5 text-muted-foreground">
          {log.map((e, i) => (
            <div key={i}>
              <span className="opacity-60">{new Date(e.t).toLocaleTimeString().slice(3)}</span>{' '}
              <span className="text-foreground">{e.kind}</span> {e.detail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
