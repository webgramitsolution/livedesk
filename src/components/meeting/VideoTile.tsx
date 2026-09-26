import { MicOff, VideoOff, Hand, Languages, Volume2, VolumeX, AlertTriangle } from 'lucide-react';
import { type Participant, type FloatingReaction, useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { originalAudioVolume } from '@/lib/translation/pipeline';
import { languageLabel } from '@/lib/translation/languages';

interface VideoTileProps {
  participant: Participant;
  subtitle?: string;
  compact?: boolean;
  mediaStream?: MediaStream | null;
}

const GRADIENT_PALETTES = [
  'from-blue-600 to-indigo-800',
  'from-emerald-600 to-teal-800',
  'from-orange-500 to-rose-700',
  'from-violet-600 to-purple-800',
  'from-cyan-500 to-blue-700',
  'from-pink-500 to-fuchsia-800',
];

function FloatingEmoji({ reaction, onDone }: { reaction: FloatingReaction; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2000);
    return () => clearTimeout(timer);
  }, [onDone]);

  const xOffset = Math.random() * 60 - 30;

  return (
    <motion.div
      initial={{ opacity: 1, y: 0, x: xOffset, scale: 0.5 }}
      animate={{ opacity: 0, y: -120, scale: 1.4 }}
      transition={{ duration: 2, ease: 'easeOut' }}
      className="absolute bottom-12 left-1/2 text-2xl pointer-events-none z-20"
    >
      {reaction.emoji}
    </motion.div>
  );
}

// Driven by the real voice-activity detector (see useTranslationPipeline).
function AudioLevelBars({ isMuted, isSpeaking }: { isMuted: boolean; isSpeaking: boolean }) {
  const heights = isMuted ? [8, 8, 8, 8] : isSpeaking ? [55, 90, 70, 100] : [12, 16, 12, 16];
  return (
    <div className="flex items-end gap-[2px] h-4" aria-hidden="true">
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className={`w-[3px] rounded-full ${isSpeaking ? 'bg-success' : 'bg-muted-foreground/60'}`}
          animate={{ height: `${h}%` }}
          transition={{ duration: 0.15, repeat: isSpeaking ? Infinity : 0, repeatType: 'reverse' }}
        />
      ))}
    </div>
  );
}

export function VideoTile({ participant, subtitle, compact, mediaStream }: VideoTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioStreamRef = useRef<MediaStream | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const markAudioBlocked = useCallback(() => {
    setAudioBlocked(true);
    window.dispatchEvent(new CustomEvent('remote-audio-blocked'));
  }, []);
  const gradientIndex = participant.id
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % GRADIENT_PALETTES.length;
  const allReactions = useMeetingStore((s) => s.reactions);
  const removeReaction = useMeetingStore((s) => s.removeReaction);
  const isTranslationEnabled = useMeetingStore((s) => s.isTranslationEnabled);
  const selectedLanguage = useMeetingStore((s) => s.selectedLanguage);
  const translation = useMeetingStore((s) => s.translation);
  const ttsAvailable = useMeetingStore((s) => s.translationStatus.ttsAvailable);
  const selectedAudioOutput = useMeetingStore((s) => s.selectedAudioOutput);
  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el || participant.id === '1' || typeof el.setSinkId !== 'function') return;
    void el.setSinkId(selectedAudioOutput === 'default' ? '' : selectedAudioOutput).catch(() => undefined);
  }, [selectedAudioOutput, participant.id, mediaStream]);
  // Original voice stays on the media plane; only local playback volume follows the audio mode.
  const originalVolume = participant.id === '1' ? 1 : originalAudioVolume(participant.spokenLanguage, { ...translation, ttsAvailable });
  useEffect(() => {
    if (participant.id === '1' || !audioRef.current) return;
    audioRef.current.volume = originalVolume;
  }, [originalVolume, participant.id, mediaStream]);
  // Receiver-side permission enforcement: a participant the host muted is not
  // played back here even if their client keeps sending audio.
  const permissionRows = useMeetingStore((s) => s.session.permissionRows);
  const meetingControls = useMeetingStore((s) => s.session.meetingControls);
  const hostSessionId = useMeetingStore((s) => s.session.hostSessionId);
  const participantPermission = useMemo(() => {
    return useMeetingStore.getState().permissionFor(participant.id === '1' ? useMeetingStore.getState().meetingSessionId : participant.sessionId);
    // permissionRows / meetingControls / hostSessionId are the inputs of permissionFor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant.id, participant.sessionId, permissionRows, meetingControls, hostSessionId]);
  const remoteCanSpeak = participant.id === '1' ? true : participantPermission.canSpeak;
  const hasControl = participantPermission.remoteControlGranted;
  useEffect(() => {
    if (participant.id === '1' || !audioRef.current) return;
    audioRef.current.muted = !remoteCanSpeak;
    audioRef.current.dataset.forceMuted = remoteCanSpeak ? 'false' : 'true';
  }, [remoteCanSpeak, participant.id, mediaStream]);
  const reactions = useMemo(
    () => allReactions.filter((r) => r.participantId === participant.id),
    [allReactions, participant.id]
  );

  // Attach media stream to video element and keep remote audio playback
  // separate so muted video preview never suppresses participant voice.
  useEffect(() => {
    if (!mediaStream) {
      setAudioBlocked(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      remoteAudioStreamRef.current = null;
      return;
    }

    setAudioBlocked(false);

    if (videoRef.current) {
      videoRef.current.srcObject = mediaStream;
    }

    if (audioRef.current && participant.id !== '1') {
      const audioOnlyStream = new MediaStream(mediaStream.getAudioTracks());
      remoteAudioStreamRef.current = audioOnlyStream;
      audioRef.current.srcObject = audioOnlyStream;
      audioRef.current.muted = !remoteCanSpeak;
      audioRef.current.volume = originalVolume;
    }

    const playMedia = async () => {
      const playResults = await Promise.allSettled([
        videoRef.current?.play(),
        participant.id !== '1' ? audioRef.current?.play() : Promise.resolve(),
      ]);

      if (participant.id !== '1' && playResults.some((result) => result.status === 'rejected')) {
        markAudioBlocked();
      }
    };

    void playMedia();

    const retryAudio = () => {
      if (participant.id === '1') return;
      void audioRef.current?.play().then(() => setAudioBlocked(false)).catch(markAudioBlocked);
    };

    const audioTracks = mediaStream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.addEventListener('unmute', retryAudio);
      track.addEventListener('ended', retryAudio);
    });
    window.addEventListener('pointerdown', retryAudio, { passive: true });
    window.addEventListener('keydown', retryAudio);

    return () => {
      audioTracks.forEach((track) => {
        track.removeEventListener('unmute', retryAudio);
        track.removeEventListener('ended', retryAudio);
      });
      window.removeEventListener('pointerdown', retryAudio);
      window.removeEventListener('keydown', retryAudio);
      if (participant.id !== '1') {
        remoteAudioStreamRef.current = null;
        if (audioRef.current) audioRef.current.srcObject = null;
      }
    };
    // remoteCanSpeak is applied by its own effect; re-attaching on change is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markAudioBlocked, mediaStream, participant.id]);

  const handleEnableAudio = async () => {
    try {
      await Promise.all([videoRef.current?.play(), audioRef.current?.play()]);
      setAudioBlocked(false);
    } catch {
      markAudioBlocked();
    }
  };

  const showTranslationBadge = isTranslationEnabled && participant.id !== '1' && participant.spokenLanguage !== selectedLanguage && !compact;

  const hasVideoTrack = mediaStream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  const showRealVideo = participant.isCameraOn && mediaStream && hasVideoTrack;

  // Audio subscription diagnostic (remote peers only).
  const audioDiagnostic = useMemo(() => {
    if (participant.id === '1' || !mediaStream) return null;
    const tracks = mediaStream.getAudioTracks();
    if (tracks.length === 0) return { tone: 'text-destructive', Icon: VolumeX, label: 'No audio' };
    const t = tracks[0];
    if (t.readyState !== 'live') return { tone: 'text-destructive', Icon: AlertTriangle, label: 'Audio failing' };
    if (t.muted) return { tone: 'text-amber-400', Icon: VolumeX, label: 'Muted by sender' };
    if (!t.enabled) return { tone: 'text-amber-400', Icon: VolumeX, label: 'Audio disabled' };
    return { tone: 'text-success', Icon: Volume2, label: 'Audio OK' };
  }, [mediaStream, participant.id]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`relative rounded-xl overflow-hidden bg-video tile-elevated group w-full h-full ${
        hasControl ? 'glow-ring' : ''
      } ${participant.isSpeaking ? 'ring-2 ring-success' : ''}`}
    >
      {mediaStream && participant.id !== '1' ? (
        <audio ref={audioRef} autoPlay playsInline preload="auto" data-remote-audio="true" />
      ) : null}

      {audioDiagnostic && !compact && (
        <div
          className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 backdrop-blur-sm"
          title={audioDiagnostic.label}
          aria-label={`${participant.name} — ${audioDiagnostic.label}`}
        >
          <audioDiagnostic.Icon className={`h-3 w-3 ${audioDiagnostic.tone}`} />
          <span className={`text-[9px] font-medium ${audioDiagnostic.tone}`}>
            {audioDiagnostic.label}
          </span>
        </div>
      )}

      {showRealVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${compact ? 'min-h-0' : 'min-h-[100px]'} ${participant.id === '1' ? 'scale-x-[-1]' : ''}`}
        />
      ) : participant.isCameraOn ? (
        <div className={`w-full h-full bg-gradient-to-br ${GRADIENT_PALETTES[gradientIndex]} flex items-center justify-center ${compact ? 'min-h-0' : 'min-h-[100px]'}`}>
          <span className={`font-display font-bold text-primary-foreground/80 ${compact ? 'text-lg' : 'text-4xl'}`}>
            {participant.avatar}
          </span>
        </div>
      ) : (
        <div className={`w-full h-full bg-video flex items-center justify-center ${compact ? 'min-h-0' : 'min-h-[100px]'}`}>
          <div className={`rounded-full bg-muted flex items-center justify-center ${compact ? 'w-8 h-8' : 'w-16 h-16'}`}>
            <span className={`font-display font-bold text-muted-foreground ${compact ? 'text-xs' : 'text-lg'}`}>
              {participant.avatar}
            </span>
          </div>
          {!compact && <VideoOff className="absolute top-3 right-3 w-4 h-4 text-muted-foreground" />}
        </div>
      )}

      {/* Hand raise indicator */}
      {participant.handRaised && !compact && (
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          className="absolute top-3 right-3 z-10"
        >
          <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center shadow-lg">
            <Hand className="w-4 h-4 text-amber-900" />
          </div>
        </motion.div>
      )}
      {participant.handRaised && compact && (
        <div className="absolute top-1 right-1 text-sm">✋</div>
      )}

      {/* Floating reactions */}
      <AnimatePresence>
        {reactions.map((r) => (
          <FloatingEmoji key={r.id} reaction={r} onDone={() => removeReaction(r.id)} />
        ))}
      </AnimatePresence>

      {/* Name badge */}
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent ${compact ? 'px-2 py-1' : 'px-3 py-2'}`}>
        <div className="flex items-center justify-between">
          <span className={`font-medium text-primary-foreground truncate ${compact ? 'text-[10px]' : 'text-sm'}`}>
            {participant.name}
          </span>
          <div className="flex items-center gap-1">
            {hasControl && !compact && (
              <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                CTRL
              </span>
            )}
            {participant.isMuted && (
              <MicOff className={`text-destructive ${compact ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5'}`} />
            )}
          </div>
        </div>
      </div>

      {/* Translation language badge */}
      {showTranslationBadge && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute bottom-10 right-2 z-10"
        >
          <div className="flex items-center gap-1 rounded-full bg-primary/90 px-1.5 py-0.5 text-[10px] text-primary-foreground backdrop-blur-sm" title={`Live Translation: ${languageLabel(participant.spokenLanguage)} → ${languageLabel(selectedLanguage)}`}>
            <span>{languageLabel(participant.spokenLanguage)}</span>
            <Languages className="h-2.5 w-2.5" />
            <span>{languageLabel(selectedLanguage)}</span>
          </div>
        </motion.div>
      )}

      {/* Subtitle overlay */}
      {subtitle && !compact && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-10 left-2 right-2 glass-surface rounded-md px-3 py-1.5"
        >
          <p className="text-xs text-primary-foreground leading-relaxed">{subtitle}</p>
        </motion.div>
      )}

      {/* Speaking indicator with audio bars */}
      {!compact && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <AudioLevelBars isMuted={participant.isMuted} isSpeaking={participant.isSpeaking} />
          {participant.isSpeaking && (
            <>
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              <span className="text-[10px] font-medium text-success">Speaking</span>
            </>
          )}
        </div>
      )}

      {audioBlocked && participant.id !== '1' && !compact && (
        <div className="absolute inset-x-3 bottom-16 z-10 flex justify-center">
          <button
            onClick={handleEnableAudio}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-2 text-xs font-medium text-foreground backdrop-blur-sm hover:bg-muted"
          >
            <Volume2 className="h-3.5 w-3.5 text-primary" />
            Tap to hear {participant.name}
          </button>
        </div>
      )}
    </motion.div>
  );
}
