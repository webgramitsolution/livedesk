import { useMeetingStore } from '@/store/meetingStore';
import { VideoTile } from './VideoTile';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Minimize2 } from 'lucide-react';
import { useState } from 'react';

export function PipOverlay() {
  const { isPipActive, togglePip, participants, transcript, isTranslationEnabled } = useMeetingStore();
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });

  const activeSpeaker = participants.find((p) => p.isSpeaking) || participants[0];

  if (!isPipActive) return null;

  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      className="fixed bottom-24 right-6 w-72 rounded-2xl overflow-hidden border border-border control-bar-elevated z-[60] cursor-move"
    >
      <div className="aspect-video relative">
        <VideoTile participant={activeSpeaker} compact />
      </div>
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={togglePip}
          className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors"
        >
          <X className="w-3 h-3 text-foreground" />
        </button>
      </div>
      {/* Participant count */}
      <div className="absolute bottom-1 left-2 px-2 py-0.5 rounded-full bg-background/80 backdrop-blur-sm">
        <span className="text-[10px] font-medium text-foreground">{participants.length} participants</span>
      </div>
    </motion.div>
  );
}
