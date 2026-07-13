import { useEffect, useState } from 'react';

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

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9998]"
      style={{ contain: 'strict' }}
    >
      {/* Vertical center line */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: '50%',
          width: '1px',
          background: 'repeating-linear-gradient(to bottom, hsl(0 90% 55%) 0 6px, transparent 6px 12px)',
          transform: 'translateX(-0.5px)',
        }}
      />
      {/* Center crosshair */}
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
      <div className="absolute top-2 right-2 rounded bg-background/90 border border-border px-2 py-1 text-[11px] font-mono text-foreground">
        align-debug · vw={typeof window !== 'undefined' ? window.innerWidth : 0} · dpr={typeof window !== 'undefined' ? window.devicePixelRatio.toFixed(2) : '1'}
      </div>
    </div>
  );
}
