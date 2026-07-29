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
      <div className=