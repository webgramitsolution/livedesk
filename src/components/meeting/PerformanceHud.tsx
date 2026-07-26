import { useEffect, useState } from 'react';
import { Activity, Download, ChevronDown, ChevronUp, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { downloadWebRTCLog } from '@/lib/webrtcLogger';
import type { PeerDiagnostic } from '@/hooks/useWebRTC';

interface Props {
  getPeerStats?: () => Promise<{ fps: number; packetLossPct: number; rtt: number; peers: number }>;
  getPeerDiagnostics?: () => PeerDiagnostic[];
}

export function PerformanceHud({ getPeerStats, getPeerDiagnostics }: Props) {
  const showPerfHud = useMeetingStore((s) => s.showPerfHud);
  const aiLatencyMs = useMeetingStore((s) => s.aiLatencyMs);
  const meetingId = useMeetingStore((s) => s.meetingId);
  const participantsCount = useMeetingStore((s) => s.participants.length);
  const [stats, setStats] = useState({ fps: 0, packetLossPct: 0, rtt: 0, peers: 0 });
  const [diagnostics, setDiagnostics] = useState<PeerDiagnostic[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!showPerfHud) return;
    let cancelled = false;
    const tick = async () => {
      if (getPeerStats) {
        const s = await getPeerStats();
        if (!cancelled) setStats(s);
      }
      if (getPeerDiagnostics && !cancelled) {
        setDiagnostics(getPeerDiagnostics());
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showPerfHud, getPeerStats, getPeerDiagnostics]);

  if (!showPerfHud) return null;

  const aiOk = aiLatencyMs > 0 && aiLatencyMs < 1500;
  const aiWarn = aiLatencyMs >= 1500 && aiLatencyMs < 2500;
  const aiColor =
    aiLatencyMs === 0
      ? 'text-muted-foreground'
      : aiOk
      ? 'text-success'
      : aiWarn
      ? 'text-amber-500'
      : 'text-destructive';

  return (
    <div className="fixed top-2 left-1/2 z-[80] -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 max-w-[calc(100vw-1rem)]">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-[10px] font-mono backdrop-blur-md shadow-md">
        <Activity className="h-3 w-3 text-primary" />
        <span className="text-foreground">FPS {stats.fps.toFixed(0)}</span>
        <span className="text-muted-foreground">·</span>
        <span className={stats.packetLossPct > 3 ? 'text-destructive' : 'text-foreground'}>
          Loss {stats.packetLossPct.toFixed(1)}%
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">RTT {stats.rtt.toFixed(0)}ms</span>
        <span className="text-muted-foreground">·</span>
        <span className={aiColor}>AI {aiLatencyMs > 0 ? `${aiLatencyMs}ms` : '—'}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {stats.peers}p/{participantsCount}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"
          aria-label={expanded ? 'Collapse diagnostics' : 'Expand diagnostics'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => downloadWebRTCLog(meetingId || 'session')}
          className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 hover:bg-muted"
          aria-label="Download signaling log"
        >
          <Download className="h-3 w-3" />
          <span className="hidden sm:inline">Log</span>
        </button>
      </div>

      {expanded && (
        <div className="mt-2 max-h-72 w-[min(20rem,calc(100vw-1rem))] overflow-auto rounded-xl border border-border bg-background/95 p-2 text-[10px] font-mono shadow-lg backdrop-blur-md">
          <div className="mb-1 flex items-center justify-between px-1 text-muted-foreground">
            <span>Peer diagnostics</span>
            <span>{diagnostics.length} peer(s)</span>
          </div>
          {diagnostics.length === 0 ? (
            <p className="px-1 py-2 text-muted-foreground">No remote peers connected yet.</p>
          ) : (
            <ul className="space-y-1">
              {diagnostics.map((d) => {
                const audioStatus = !d.hasAudio
                  ? { label: 'No audio track', tone: 'text-destructive', Icon: VolumeX }
                  : !d.audioLive
                  ? { label: 'Audio failing', tone: 'text-destructive', Icon: VolumeX }
                  : d.audioMuted
                  ? { label: 'Muted by sender', tone: 'text-amber-500', Icon: VolumeX }
                  : !d.audioEnabled
                  ? { label: 'Audio disabled', tone: 'text-amber-500', Icon: VolumeX }
                  : { label: 'Audio OK', tone: 'text-success', Icon: Volume2 };
                const connected = d.connectionState === 'connected';
                return (
                  <li key={d.peerId} className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-foreground" title={d.peerId}>
                        {d.peerId.slice(0, 8)}
                      </span>
                      <span className={`inline-flex items-center gap-1 ${connected ? 'text-success' : 'text-amber-500'}`}>
                        {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {d.connectionState}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 ${audioStatus.tone}`}>
                        <audioStatus.Icon className="h-3 w-3" />
                        {audioStatus.label}
                      </span>
                      <span className="text-muted-foreground">
                        video: {d.hasVideo ? (d.videoLive ? 'live' : 'stalled') : 'none'}
                      </span>
                      {d.retries > 0 && <span className="text-amber-500">retry×{d.retries}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 px-1 text-muted-foreground">
            Signaling log is captured in-memory. Click "Log" to download JSON.
          </p>
        </div>
      )}
    </div>
  );
}