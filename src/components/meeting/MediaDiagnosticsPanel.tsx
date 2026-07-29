import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, CameraOff, CheckCircle2, Download, Mic, MicOff, RefreshCw, Share2, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMeetingStore } from '@/store/meetingStore';
import { downloadWebRTCLog, shareWebRTCLog } from '@/lib/webrtcLogger';
import type { LocalDeviceSelection } from '@/hooks/useWebRTC';

interface Props {
  onSelectDevices?: (selection: LocalDeviceSelection) => void;
}

type DeviceOption = { deviceId: string; label: string; kind: MediaDeviceKind };

function statusTone(status: string) {
  if (status === 'ok') return 'text-success';
  if (status === 'off') return 'text-muted-foreground';
  if (status === 'retrying') return 'text-amber-500';
  return 'text-destructive';
}

function statusLabel(status: string) {
  if (status === 'ok') return 'Live';
  if (status === 'off') return 'Off';
  if (status === 'retrying') return 'Retrying';
  if (status === 'blocked') return 'Blocked';
  return 'Missing';
}

export function MediaDiagnosticsPanel({ onSelectDevices }: Props) {
  const meetingId = useMeetingStore((s) => s.meetingId);
  const status = useMeetingStore((s) => s.localMediaStatus);
  const selectedAudioInput = useMeetingStore((s) => s.selectedAudioInput);
  const selectedVideoInput = useMeetingStore((s) => s.selectedVideoInput);
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState(selectedAudioInput);
  const [videoDeviceId, setVideoDeviceId] = useState(selectedVideoInput);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const needsAttention = status.audio === 'missing' || status.audio === 'retrying' || status.audio === 'blocked'
    || status.video === 'missing' || status.video === 'retrying' || status.video === 'blocked';

  const audioDevices = useMemo(() => devices.filter((device) => device.kind === 'audioinput'), [devices]);
  const videoDevices = useMemo(() => devices.filter((device) => device.kind === 'videoinput'), [devices]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const loadDevices = async () => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices?.();
        if (cancelled || !list) return;
        setDevices(
          list
            .filter((device) => device.kind === 'audioinput' || device.kind === 'videoinput')
            .map((device, index) => ({
              deviceId: device.deviceId || `default-${device.kind}`,
              kind: device.kind,
              label: device.label || `${device.kind === 'audioinput' ? 'Microphone' : 'Camera'} ${index + 1}`,
            })),
        );
      } catch {
        setDevices([]);
      }
    };
    void loadDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices);
    };
  }, [open]);

  const lastRenegotiation = status.lastRenegotiationAt
    ? new Date(status.lastRenegotiationAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  const applySelection = () => {
    onSelectDevices?.({ audioDeviceId, videoDeviceId, facingMode });
    setOpen(false);
  };

  return (
    <>
      <div className="fixed left-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[70] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-border bg-background/92 px-3 py-2 text-[11px] font-medium text-foreground shadow-lg backdrop-blur-md md:left-4 md:top-20">
        <span className={`inline-flex items-center gap-1 ${statusTone(status.audio)}`} title={status.audioLabel}>
          {status.audio === 'ok' ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          {statusLabel(status.audio)}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className={`inline-flex items-center gap-1 ${statusTone(status.video)}`} title={status.videoLabel}>
          {status.video === 'ok' ? <Camera className="h-3.5 w-3.5" /> : <CameraOff className="h-3.5 w-3.5" />}
          {statusLabel(status.video)}
        </span>
        <span className="hidden text-muted-foreground sm:inline">· reneg {lastRenegotiation}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`ml-1 inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] transition-colors hover:bg-muted ${needsAttention ? 'text-amber-500' : 'text-muted-foreground'}`}
          aria-label="Open media diagnostics"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${status.audio === 'retrying' || status.video === 'retrying' ? 'animate-spin' : ''}`} />
          <span className="hidden xs:inline">Media</span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[95] flex items-end justify-center bg-background/70 p-3 backdrop-blur-sm sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Media diagnostics"
              initial={{ y: 24, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 24, scale: 0.98 }}
              className="max-h-[min(88dvh,38rem)] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Media diagnostics</h2>
                  <p className="text-xs text-muted-foreground">Last renegotiation: {lastRenegotiation}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
                  aria-label="Close media diagnostics"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[calc(min(88dvh,38rem)-4rem)] overflow-y-auto p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className={`mb-1 flex items-center gap-2 text-sm font-semibold ${statusTone(status.audio)}`}>
                      {status.audio === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                      Microphone {statusLabel(status.audio)}
                    </div>
                    <p className="truncate text-xs text-muted-foreground" title={status.audioLabel}>{status.audioLabel}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className={`mb-1 flex items-center gap-2 text-sm font-semibold ${statusTone(status.video)}`}>
                      {status.video === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                      Camera {statusLabel(status.video)}
                    </div>
                    <p className="truncate text-xs text-muted-foreground" title={status.videoLabel}>{status.videoLabel}</p>
                  </div>
                </div>

                {status.lastErrorCode && (
                  <p className="mt-3 rounded-xl border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {status.lastErrorCode} · retry {status.retryAttempt}
                  </p>
                )}

                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-semibold text-foreground">
                    Microphone
                    <select
                      value={audioDeviceId}
                      onChange={(event) => setAudioDeviceId(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Default microphone</option>
                      {audioDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-semibold text-foreground">
                    Camera
                    <select
                      value={videoDeviceId}
                      onChange={(event) => setVideoDeviceId(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Default camera</option>
                      {videoDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={facingMode === 'user' ? 'default' : 'outline'} onClick={() => setFacingMode('user')} className="h-11">
                      <Smartphone className="mr-2 h-4 w-4" /> Front
                    </Button>
                    <Button type="button" variant={facingMode === 'environment' ? 'default' : 'outline'} onClick={() => setFacingMode('environment')} className="h-11">
                      <Camera className="mr-2 h-4 w-4" /> Back
                    </Button>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Button type="button" onClick={applySelection} className="h-11 flex-1">
                    <RefreshCw className="mr-2 h-4 w-4" /> Reconnect devices
                  </Button>
                  <Button type="button" variant="outline" onClick={() => downloadWebRTCLog(meetingId || 'session')} className="h-11 sm:w-28">
                    <Download className="mr-2 h-4 w-4" /> Log
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void shareWebRTCLog(meetingId || 'session')} className="h-11 sm:w-28">
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}