import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Camera, CameraOff, Check, Loader2, Mic, MicOff, Shield, Volume2 } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { setPreflightStream, queryMediaPermissions, requestMeetingMedia } from '@/lib/mediaPreflight';
import { toast } from 'sonner';

type DeviceStatus = 'idle' | 'checking' | 'granted' | 'denied' | 'unavailable';

interface DeviceDiagnostics {
  mic: DeviceStatus;
  camera: DeviceStatus;
  speaker: DeviceStatus;
  micLabel: string;
  cameraLabel: string;
  speakerLabel: string;
}

const IDLE_DIAGNOSTICS: DeviceDiagnostics = {
  mic: 'idle', camera: 'idle', speaker: 'checking',
  micLabel: 'Permission needed', cameraLabel: 'Permission needed', speakerLabel: 'Detecting…',
};

function DeviceRow({ icon: Icon, label, deviceName, status }: { icon: React.ElementType; label: string; deviceName: string; status: DeviceStatus }) {
  const statusConfig = {
    idle: { color: 'text-muted-foreground', bg: 'bg-muted', icon: Shield, text: 'Waiting', spin: false },
    checking: { color: 'text-muted-foreground', bg: 'bg-muted', icon: Loader2, text: 'Checking…', spin: true },
    granted: { color: 'text-success', bg: 'bg-success/10', icon: Check, text: 'Ready', spin: false },
    denied: { color: 'text-destructive', bg: 'bg-destructive/10', icon: AlertCircle, text: 'Blocked', spin: false },
    unavailable: { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: AlertCircle, text: 'Not found', spin: false },
  } as const;
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
  const { setScreen, meetingId, isMicOn, isCameraOn, toggleMic, toggleCamera } = useMeetingStore();
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics>(IDLE_DIAGNOSTICS);
  const [consentAsked, setConsentAsked] = useState(false);
  const [allChecked, setAllChecked] = useState(false);

  // Speakers need no permission — detect them right away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const speakers = devices.filter((d) => d.kind === 'audiooutput');
        if (cancelled) return;
        setDiagnostics((prev) => ({
          ...prev,
          speaker: speakers.length > 0 ? 'granted' : 'unavailable',
          speakerLabel: speakers[0]?.label || (speakers.length > 0 ? 'Default Speaker' : 'No speaker found'),
        }));
      } catch {
        if (!cancelled) setDiagnostics((prev) => ({ ...prev, speaker: 'granted', speakerLabel: 'Default Speaker' }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // If the browser already remembers a grant, skip the extra click.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { mic, camera } = await queryMediaPermissions();
      if (cancelled) return;
      if (mic === 'granted' || camera === 'granted') setConsentAsked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const requestAccess = useCallback(async () => {
    setConsentAsked(true);
    setAllChecked(false);
    setDiagnostics((prev) => ({
      ...prev,
      mic: 'checking', camera: 'checking',
      micLabel: 'Requesting access…', cameraLabel: 'Requesting access…',
    }));

    const result = await requestMeetingMedia();
    const micStatus = result.mic;
    const camStatus = result.camera;
    const micLabel = result.micLabel;
    const camLabel = result.cameraLabel;

    if (micStatus === 'granted' && !isMicOn) toggleMic();
    if (camStatus === 'granted' && !isCameraOn) toggleCamera();

    // Keep granted tracks alive and hand them to the meeting so the browser is
    // never asked for the same devices twice.
    setPreflightStream(result.stream);
    setDiagnostics((prev) => ({
      ...prev,
      mic: micStatus, micLabel,
      camera: camStatus, cameraLabel: camLabel,
    }));
    setAllChecked(true);
  }, [isCameraOn, isMicOn, toggleCamera, toggleMic]);

  // Auto-run once consent is implied by an existing browser grant.
  useEffect(() => {
    if (consentAsked && diagnostics.mic === 'idle') void requestAccess();
  }, [consentAsked, diagnostics.mic, requestAccess]);

  // Join automatically once at least one device is ready.
  useEffect(() => {
    if (!allChecked) return;
    const hasAny = diagnostics.mic === 'granted' || diagnostics.camera === 'granted';
    if (!hasAny) return;
    toast.success(
      diagnostics.mic === 'granted' ? 'Devices ready — joining meeting' : 'Joining with camera only'
    );
    const timer = setTimeout(() => setScreen('meeting'), 900);
    return () => clearTimeout(timer);
  }, [allChecked, diagnostics.mic, diagnostics.camera, setScreen]);

  const anyBlocked =
    allChecked && diagnostics.mic !== 'granted' && diagnostics.camera !== 'granted';
  const waitingForConsent = !consentAsked;

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-background gap-6 px-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative"
      >
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-display font-bold text-2xl sm:text-3xl">LD</span>
        </div>
        {!waitingForConsent && (
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-primary"
            animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </motion.div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
        className="text-muted-foreground text-xs sm:text-sm font-mono"
      >
        {meetingId}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
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

      {waitingForConsent ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 max-w-sm text-center">
          <p className="text-sm text-foreground font-medium">Allow camera &amp; microphone to join</p>
          <p className="text-xs text-muted-foreground">
            We ask before joining so others can see and hear you. Your browser will show a permission prompt — choose “Allow”.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void requestAccess()}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Allow &amp; continue
            </button>
            <button
              onClick={() => setScreen('meeting')}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Join without devices
            </button>
          </div>
        </motion.div>
      ) : (
        <>
          <div className="w-full max-w-sm h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: '0%' }}
              animate={{ width: allChecked ? '100%' : '60%' }}
              transition={{ duration: allChecked ? 0.4 : 2, ease: 'easeInOut' }}
            />
          </div>

          <p className="text-xs text-muted-foreground text-center max-w-xs">
            {!allChecked
              ? 'Waiting for your permission…'
              : anyBlocked
              ? 'Mic & camera are blocked in your browser. Open the lock icon in the address bar, allow them, then retry.'
              : diagnostics.mic === 'denied' || diagnostics.mic === 'unavailable'
              ? 'Microphone unavailable — joining with camera only.'
              : diagnostics.camera === 'denied'
              ? 'Camera blocked — joining with audio only. You can enable camera later.'
              : 'All devices ready — joining your meeting…'}
          </p>

          {anyBlocked && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
              <button
                onClick={() => void requestAccess()}
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
        </>
      )}
    </div>
  );
}
