import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';

interface Props {
  getPeerStats?: () => Promise<{ fps: number; packetLossPct: number; rtt: number; peers: number }>;
}

export function PerformanceHud({ getPeerStats }: Props) {
  const showPerfHud = useMeetingStore((s) => s.showPerfHud);
  const aiLatencyMs = useMeetingStore((s) => s.aiLatencyMs);
  const [stats, setStats] = useState({ fps: 0, packetLossPct: 0, rtt: 0, peers: 0 });

  useEffect(() => {
    if (!showPerfHud || !getPeerStats) return;
    let cancelled = false;
    const tick = async () => {
      const s = await getPeerStats();
      if (!cancelled) setStats(s);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showPerfHud, getPeerStats]);

  if (!showPerfHud) return null;

  const aiOk = aiLatencyMs > 0 && aiLatencyMs < 1500;
  const aiWarn = aiLatencyMs >= 1500 && aiLatencyMs < 2500;
  const aiColor = aiLatencyMs === 0
    ? 'text-muted-foreground'
    : aiOk
    ? 'text-success'
    : aiWarn
    ? 'text-amber-500'
    : 'text-destructive';

  return (
    <div className="pointer-events-none fixed top-2 left-1/2 z-[80] -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background/85 px-3 py-1.5 text-[10px] font-mono backdrop-blur-md shadow-md">
        <Activity className="h-3 w-3 text-primary" />
        <span className="text-foreground">FPS {stats.fps.toFixed(0)}</span>
        <span className="text-muted-foreground">·</span>
        <span className={stats.packetLossPct > 3 ? 'text-destructive' : 'text-foreground'}>
          Loss {stats.packetLossPct.toFixed(1)}%
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">RTT {stats.rtt.toFixed(0)}ms</span>
        <span className="text-muted-foreground">·</span>
        <span className={aiColor}>
          AI {aiLatencyMs > 0 ? `${aiLatencyMs}ms` : '—'}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{stats.peers}p</span>
      </div>
    </div>
  );
}