import { MicOff, VideoOff, Hand, Languages, Volume2 } from 'lucide-react';
import { type Participant, type FloatingReaction, useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState, useRef } from 'react';

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

function AudioLevelBars({ isMuted, isSpeaking }: { isMuted: boolean; isSpeaking: boolean }) {
  const [levels, setLevels] = useState([0, 0, 0, 0]);

  useEffect(() => {
    if (isMuted) { setLevels([0, 0, 0, 0]); return; }
    const id = setInterval(() => {
      setLevels(
        Array.from({ length: 4 }, () =>
          isSpeaking ? 30 + Math.random() * 70 : 5 + Math.random() * 20
        )
      );
    }, 150);
    return () => clearInterval(id);
  }, [isMuted, isSpeaking]);

  return (
    <div className="flex items-end gap-[2px] h-4">
      {levels.map((l, i) => (
        <motion.div
          key={i}
          className={`w-[3px] rounded-full ${isSpeaking ? 'bg-success' : 'bg-muted-foreground/60'}`}
          animate={{ height: `${Math.max(l, 8)}%` }}
          transition={{ duration: 0.1 }}
        />
      ))}
    </div>
  );
}

export function VideoTile({ participant, subtitle, compact, mediaStream }: VideoTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const gradientIndex = participant.id
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % GRADIENT_PALETTES.length;
  const allReactions = useMeetingStore((s) => s.reactions);
  const removeReaction = useMeetingStore((s) => s.removeReaction);
  const isTranslationEnabled = useMeetingStore((s) => s.isTranslationEnabled);
  const selectedLanguage = useMeetingStore((s) => s.selectedLanguage);
  const reactions = useMemo(
    () => allReactions.filter((r) => r.participantId === participant.id),
    [allReactions, participant.id]
  );

  // Attach media stream to video element
  useEffect(() => {
    if (!mediaStream) {
      setAudioBlocked(false);
      return;
    }

    setAudioBlocked(false);

    if (videoRef.current) {
      videoRef.current.srcObject = mediaStream;
    }

    if (audioRef.current && participant.id !== '1') {
      audioRef.current.srcObject = mediaStream;
    }

    const playMedia = async () => {
      const playResults = await Promise.allSettled([
        videoRef.current?.play(),
        participant.id !== '1' ? audioRef.current?.play() : Promise.resolve(),
      ]);

      if (participant.id !== '1' && playResults.some((result) => result.status === 'rejected')) {
        setAudioBlocked(true);
      }
    };

    void playMedia();
  }, [mediaStream, participant.id]);

  const handleEnableAudio = async () => {
    try {
      await Promise.all([videoRef.current?.play(), audioRef.current?.play()]);
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  };

  const LANG_FLAGS: Record<string, string> = { en: '🇬🇧', zh: '🇨🇳', es: '🇪🇸', hi: '🇮🇳', ko: '🇰🇷', ja: '🇯🇵', fr: '🇫🇷', de: '🇩🇪', ar: '🇸🇦', pt: '🇧🇷' };
  const showTranslationBadge = isTranslationEnabled && participant.spokenLanguage !== selectedLanguage && !compact;

  const hasVideoTrack = mediaStream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live');
  const showRealVideo = participant.isCameraOn && mediaStream && hasVideoTrack;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`relative rounded-xl overflow-hidden bg-video tile-elevated group w-full h-full ${
        participant.hasMouseControl ? 'glow-ring' : ''
      } ${participant.isSpeaking ? 'ring-2 ring-success' : ''}`}
    >
      {mediaStream && participant.id !== '1' ? (
        <audio ref={audioRef} autoPlay playsInline />
      ) : null}

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
            {participant.hasMouseControl && !compact && (
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
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/90 backdrop-blur-sm">
            <span className="text-[10px]">{LANG_FLAGS[participant.spokenLanguage] || '🌐'}</span>
            <Languages className="w-2.5 h-2.5 text-primary-foreground" />
            <span className="text-[10px]">{LANG_FLAGS[selectedLanguage] || '🌐'}</span>
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
