import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Camera, CameraOff, Check, Loader2, Mic, MicOff, Shield, Speaker, Volume2, Wifi } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { toast } from 'sonner';

type DeviceStatus = 'checking' | 'granted' | 'denied' | 'unavailable';

interface DeviceDiagnostics {
  mic: DeviceStatus;
  camera: DeviceStatus;
  speaker: DeviceStatus;
  micLabel: string;
  cameraLabel: string;
  speakerLabel: string;
}

const steps = [
  { label: 'Establishing secure connection...', icon: Shield, delay: 0 },
  { label: 'Initializing WebRTC mesh...', icon: Wifi, delay: 800 },
  { label: 'Checking your devices...', icon: Loader2, delay: 1600 },
];

function DeviceRow({ icon: Icon, label, deviceName, status }: { icon: React.ElementType; label: string; deviceName: string; status: DeviceStatus }) {
  const statusConfig = {
    checking: { color: 'text-muted-foreground', bg: 'bg-muted', icon: Loader2, text: 'Checking…', spin: true },
    granted: { color: 'text-success', bg: 'bg-success/10', icon: Check, text: 'Ready', spin: false },
    denied: { color: 'text-destructive', bg: 'bg-destructive/10', icon: AlertCircle, text: 'Blocked', spin: false },
    unavailable: { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: AlertCircle, text: 'Not found', spin: false },
  };
  const cfg = statusConfig[status];

  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{deviceName}</p>
      </div>
      <div className={`flex items-center gap-1 ${cfg.color}`}>
        <cfg.icon className={`w-3.5 h-3.5 ${cfg.spin ? 'animate-spin' : ''}`} />
        <span className="text-xs font-medium">{cfg.text}</span>
      </div>
    </div>
  );
}

export function ConnectingScreen() {
  const { setScreen, meetingId } = useMeetingStore();
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics>({
    mic: 'checking', camera: 'checking', speaker: 'checking',
    micLabel: 'Detecting…', cameraLabel: 'Detecting…', speakerLabel: 'Detecting…',
  });
  const [allChecked, setAllChecked] = useState(false);

  const runDiagnostics = useCallback(async () => {
    let cancelled = false;

    // Check speaker first (no permission needed)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const speakers = devices.filter(d => d.kind === 'audiooutput');
      if (!cancelled) {
        setDiagnostics(prev => ({
          ...prev,
          speaker: speakers.length > 0 ? 'granted' : 'unavailable',
          speakerLabel: speakers[0]?.label || (speakers.length > 0 ? 'Default Speaker' : 'No speaker found'),
        }));
      }
    } catch {
      if (!cancelled) {
        setDiagnostics(prev => ({ ...prev, speaker: 'granted', speakerLabel: 'Default Speaker' }));
      }
    }

    // Check mic + camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      if (!cancelled) {
        setDiagnostics(prev => ({
          ...prev,
          mic: 'granted', micLabel: audioTrack?.label || 'Microphone',
          camera: 'granted', cameraLabel: videoTrack?.label || 'Camera',
        }));
      }
      stream.getTracks().forEach(t => t.stop());
    } catch {
      // Try audio only
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const audioTrack = audioStream.getAudioTracks()[0];
        if (!cancelled) {
          setDiagnostics(prev => ({
            ...prev,
            mic: 'granted', micLabel: audioTrack?.label || 'Microphone',
            camera: 'denied', cameraLabel: 'Camera access blocked',
          }));
        }
        audioStream.getTracks().forEach(t => t.stop());
      } catch {
        if (!cancelled) {
          setDiagnostics(prev => ({
            ...prev,
            mic: 'denied', micLabel: 'Mic access blocked',
            camera: 'denied', cameraLabel: 'Camera access blocked',
          }));
        }
      }
    }

    if (!cancelled) setAllChecked(true);

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cleanup = runDiagnostics();
    return () => { cleanup.then(fn => fn?.()); };
  }, [runDiagnostics]);

  // Auto-proceed after diagnostics complete
  useEffect(() => {
    if (!allChecked) return;
    const hasAudio = diagnostics.mic === 'granted';
    if (hasAudio) {
      toast.success('Devices ready — joining meeting');
    }
    const timer = setTimeout(() => setScreen('meeting'), hasAudio ? 1200 : 2500);
    return () => clearTimeout(timer);
  }, [allChecked, diagnostics.mic, setScreen]);

  const anyBlocked = diagnostics.mic === 'denied' && diagnostics.camera === 'denied';

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-background gap-6 px-4">
      {/* Logo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative"
      >
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-display font-bold text-2xl sm:text-3xl">ZC</span>
        </div>
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 border-primary"
          animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
      </motion.div>

      {/* Meeting ID */}
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="text-muted-foreground text-xs sm:text-sm font-mono"
      >
        {meetingId}
      </motion.p>

      {/* Device Diagnostics Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 space-y-1"
      >
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          Device Check
        </h3>
        <DeviceRow icon={diagnostics.mic === 'granted' ? Mic : MicOff} label="Microphone" deviceName={diagnostics.micLabel} status={diagnostics.mic} />
        <DeviceRow icon={diagnostics.camera === 'granted' ? Camera : CameraOff} label="Camera" deviceName={diagnostics.cameraLabel} status={diagnostics.camera} />
        <DeviceRow icon={Volume2} label="Speaker" deviceName={diagnostics.speakerLabel} status={diagnostics.speaker} />
      </motion.div>

      {/* Progress */}
      <div className="w-full max-w-sm h-1 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: allChecked ? '100%' : '60%' }}
          transition={{ duration: allChecked ? 0.4 : 2, ease: 'easeInOut' }}
        />
      </div>

      {/* Status message */}
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
        className="text-xs text-muted-foreground text-center max-w-xs"
      >
        {!allChecked
          ? 'Checking your devices…'
          : anyBlocked
          ? 'Mic & camera blocked. Allow permissions to be heard by others.'
          : diagnostics.camera === 'denied'
          ? 'Camera blocked — joining with audio only. You can enable camera later.'
          : 'All devices ready — joining your meeting…'}
      </motion.p>

      {/* Action buttons when blocked */}
      {allChecked && anyBlocked && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry access
          </button>
          <button
            onClick={() => setScreen('meeting')}
            className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-foreground hover:bg-muted"
          >
            Join anyway
          </button>
        </motion.div>
      )}
    </div>
  );
}
