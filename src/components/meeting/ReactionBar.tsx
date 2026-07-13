import { useMeetingStore } from '@/store/meetingStore';
import { motion } from 'framer-motion';

const EMOJIS = ['👍', '👏', '❤️', '😂', '🎉', '🔥'];

export function ReactionBar() {
  const { sendReaction } = useMeetingStore();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-md px-3 py-2 rounded-full flex items-center gap-1 border border-border z-30 control-bar-elevated"
    >
      {EMOJIS.map((emoji) => (
        <motion.button
          key={emoji}
          whileHover={{ scale: 1.3 }}
          whileTap={{ scale: 0.8 }}
          onClick={() => sendReaction(emoji, '1')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-lg hover:bg-muted transition-colors"
        >
          {emoji}
        </motion.button>
      ))}
    </motion.div>
  );
}
