import { Wifi, WifiOff, Clock, Users, Shield, Circle, UserPlus, PictureInPicture2, Waves } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

function TimerDisplay({ startTime, label, colorClass }: { startTime: number; label?: string; colorClass?: string }) {
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

  return (
    <span className={`text-xs font-bold font-mono ${colorClass || 'text-foreground'}`}>{elapsed}</span>
  );
}

function RecordingTimer({ startTime }: { startTime: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={useMeetingStore.getState().toggleRecording}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 transition-colors cursor-pointer"
    >
      <Circle className="w-2.5 h-2.5 fill-destructive text-destructive animate-pulse-glow" />
      <TimerDisplay startTime={startTime} colorClass="text-destructive" />
      <span className="text-[10px] text-destructive/70 hidden sm:inline">REC</span>
    </motion.button>
  );
}

export function NavigationBar() {
  const { meetingId, latency, participants, isRecording, recordingStartTime, toggleRecording, toggleInvite, togglePip, isPipActive, isNoiseCancellationOn, meetingJoinedAt } =
    useMeetingStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const latencyColor = {
    good: 'text-success',
    medium: 'text-yellow-500',
    poor: 'text-destructive',
  }[latency];

  const LatencyIcon = latency === 'poor' ? WifiOff : Wifi;

  return (
    <header className="h-12 flex items-center justify-between px-2 sm:px-6 border-b border-border bg-background/95 backdrop-blur-sm z-50">
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-display font-bold text-xs">ZC</span>
          </div>
          <h1 className="font-display font-bold text-foreground text-sm tracking-tight hidden md:block">
            Zoom Connect
          </h1>
        </div>
        <span className="text-muted-foreground text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-secondary font-mono truncate max-w-[80px] sm:max-w-none">
          {meetingId}
        </span>

        {isRecording && recordingStartTime ? (
          <RecordingTimer startTime={recordingStartTime} />
        ) : (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={toggleRecording}
            title="Start recording"
            className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-muted transition-colors text-muted-foreground shrink-0"
          >
            <Circle className="w-3 h-3" />
            <span className="text-xs font-medium hidden sm:inline">Record</span>
          </motion.button>
        )}
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:gap-4 shrink-0">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={toggleInvite}
          className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-muted transition-colors text-muted-foreground"
        >
          <UserPlus className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">Invite</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={togglePip}
          className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-full transition-colors ${
            isPipActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground'
          }`}
        >
          <PictureInPicture2 className="w-4 h-4" />
          <span className="text-xs font-medium hidden md:inline">PiP</span>
        </motion.button>
        {isNoiseCancellationOn && (
          <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-full bg-success/10 border border-success/20">
            <Waves className="w-3.5 h-3.5 text-success" />
            <span className="text-[10px] font-medium text-success">NC</span>
          </div>
        )}
        <div className="hidden md:flex items-center gap-1.5 text-muted-foreground">
          <Shield className="w-4 h-4 text-success" />
          <span className="text-xs font-medium">E2E</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="text-xs font-medium">{participants.length}</span>
        </div>
        <div className={`hidden sm:flex items-center gap-1 ${latencyColor}`}>
          <LatencyIcon className="w-4 h-4" />
          <span className="text-xs font-medium hidden md:inline">
            {latency === 'good' ? '< 200ms' : latency === 'medium' ? '< 500ms' : '> 1s'}
          </span>
        </div>
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
