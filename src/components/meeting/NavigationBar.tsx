import { Wifi, WifiOff, Clock, Users, Shield, Circle, UserPlus, PictureInPicture2, Languages, Loader2, Crown } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { languageLabel } from '@/lib/translation/languages';
import { cn } from '@/lib/utils';

function TimerDisplay({ startTime, colorClass }: { startTime: number; colorClass?: string }) {
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const h = Math.floor(diff / 3600);
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setElapsed(h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return <span className={`text-xs font-bold font-mono ${colorClass || 'text-foreground'}`}>{elapsed}</span>;
}

function RecordingTimer({ startTime }: { startTime: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={useMeetingStore.getState().toggleRecording}
      title="Stop recording (saved locally on your device)"
      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 transition-colors cursor-pointer"
    >
      <Circle className="w-2.5 h-2.5 fill-destructive text-destructive animate-pulse-glow" />
      <TimerDisplay startTime={startTime} colorClass="text-destructive" />
      <span className="text-[10px] text-destructive/70 hidden sm:inline">REC</span>
    </motion.button>
  );
}

/** Truthful connection chip: derived from real RTCPeerConnection / signaling state. */
function ConnectionChip() {
  const connectionState = useMeetingStore((s) => s.session.connectionState);
  const cfg = {
    connecting: { Icon: Loader2, tone: 'text-muted-foreground', label: 'Connecting', spin: true },
    connected: { Icon: Wifi, tone: 'text-success', label: 'Connected', spin: false },
    reconnecting: { Icon: Loader2, tone: 'text-amber-500', label: 'Reconnecting', spin: true },
    failed: { Icon: WifiOff, tone: 'text-destructive', label: 'Connection failed', spin: false },
    'host-disconnected': { Icon: WifiOff, tone: 'text-destructive', label: 'Host disconnected', spin: false },
  }[connectionState];
  return (
    <div className={cn('flex items-center gap-1', cfg.tone)} data-testid="connection-chip" data-state={connectionState} title={cfg.label}>
      <cfg.Icon className={cn('w-4 h-4', cfg.spin && 'animate-spin')} />
      <span className="text-xs font-medium hidden md:inline">{cfg.label}</span>
    </div>
  );
}

export function NavigationBar() {
  const meetingId = useMeetingStore((s) => s.meetingId);
  const participants = useMeetingStore((s) => s.participants);
  const isRecording = useMeetingStore((s) => s.isRecording);
  const recordingStartTime = useMeetingStore((s) => s.recordingStartTime);
  const toggleRecording = useMeetingStore((s) => s.toggleRecording);
  const toggleInvite = useMeetingStore((s) => s.toggleInvite);
  const togglePip = useMeetingStore((s) => s.togglePip);
  const isPipActive = useMeetingStore((s) => s.isPipActive);
  const meetingJoinedAt = useMeetingStore((s) => s.meetingJoinedAt);
  const toggleRightPanel = useMeetingStore((s) => s.toggleRightPanel);
  const session = useMeetingStore((s) => s.session);
  const translation = useMeetingStore((s) => s.translation);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isHost = !!session.myUserId && session.myUserId === session.hostUserId;
  const otherLanguages = Array.from(new Set(participants.filter((p) => p.id !== '1').map((p) => p.spokenLanguage))).filter((l) => l !== translation.preferredLanguage);
  const securityLabel = isHost ? 'You are the host' : session.hostUserId ? 'Host controls permissions' : 'Waiting for host';

  return (
    <header className="h-12 flex items-center justify-between px-2 sm:px-6 border-b border-border bg-background/95 backdrop-blur-sm z-50">
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0">
          <img src="/logo.png" alt="LiveDesk" className="w-7 h-7 rounded-lg object-contain" />
          <h1 className="font-display font-bold text-foreground text-sm tracking-tight hidden md:block">LiveDesk</h1>
        </div>
        <span className="text-muted-foreground text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-secondary font-mono truncate max-w-[80px] sm:max-w-none" title="Meeting code">
          {meetingId}
        </span>

        {isRecording && recordingStartTime ? (
          <RecordingTimer startTime={recordingStartTime} />
        ) : (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={toggleRecording}
            title="Record locally (saved on your device only when you stop)"
            className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-muted transition-colors text-muted-foreground shrink-0"
          >
            <Circle className="w-3 h-3" />
            <span className="text-xs font-medium hidden sm:inline">Record</span>
          </motion.button>
        )}

        {translation.enabled && (
          <button
            type="button"
            onClick={() => toggleRightPanel('ai')}
            className="hidden lg:flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary"
            title="Open live translation"
            data-testid="nav-translation-indicator"
          >
            <Languages className="w-3.5 h-3.5" />
            {otherLanguages.length > 0
              ? `Live Translation: ${otherLanguages.map(languageLabel).join(', ')} → ${languageLabel(translation.preferredLanguage)}`
              : `Live Translation: ${languageLabel(translation.preferredLanguage)}`}
          </button>
        )}
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:gap-4 shrink-0">
        <motion.button whileTap={{ scale: 0.95 }} onClick={toggleInvite} className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-muted transition-colors text-muted-foreground">
          <UserPlus className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">Invite</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={togglePip}
          className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${isPipActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
        >
          <PictureInPicture2 className="w-4 h-4" />
          <span className="text-xs font-medium hidden md:inline">PiP</span>
        </motion.button>
        <button
          type="button"
          onClick={() => toggleRightPanel('participants')}
          className="hidden md:flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          title={securityLabel}
          data-testid="nav-security"
        >
          {isHost ? <Crown className="w-4 h-4 text-amber-500" /> : <Shield className="w-4 h-4 text-success" />}
          <span className="text-xs font-medium">{isHost ? 'Host' : 'Secured'}</span>
        </button>
        <button type="button" onClick={() => toggleRightPanel('participants')} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" title="Participants">
          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="text-xs font-medium">{participants.length}</span>
        </button>
        <ConnectionChip />
        {meetingJoinedAt && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <TimerDisplay startTime={meetingJoinedAt} colorClass="text-muted-foreground text-xs" />
          </div>
        )}
        <span className="text-xs font-medium font-mono text-muted-foreground hidden sm:inline">
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </header>
  );
}
