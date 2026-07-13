import { X, Keyboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { useMeetingStore } from '@/store/meetingStore';

const SHORTCUTS = [
  { key: 'M', label: 'Toggle microphone' },
  { key: 'V', label: 'Toggle camera' },
  { key: 'S', label: 'Toggle screen share' },
  { key: 'H', label: 'Raise / lower hand' },
  { key: 'R', label: 'Toggle recording' },
  { key: 'N', label: 'Toggle noise cancellation' },
  { key: 'T', label: 'Toggle live translation' },
  { key: 'P', label: 'Participants panel' },
  { key: 'C', label: 'Chat panel' },
  { key: 'A', label: 'AI sidebar' },
  { key: 'I', label: 'Invite participants' },
  { key: 'B', label: 'Breakout rooms' },
  { key: ',', label: 'Settings' },
  { key: 'Q', label: 'Leave meeting' },
  { key: '?', label: 'Show this help' },
];

export function KeyboardShortcutsOverlay({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md max-h-[85vh] bg-background rounded-2xl border border-border control-bar-elevated z-50 flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-foreground text-lg">Keyboard Shortcuts</h2>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-1.5">
                {SHORTCUTS.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm text-foreground">{s.label}</span>
                    <kbd className="px-2.5 py-1 rounded-lg bg-secondary border border-border text-xs font-mono font-bold text-foreground min-w-[28px] text-center">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">
                Press <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[10px] font-mono font-bold">?</kbd> anytime to toggle this overlay
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function useKeyboardShortcuts(showHelp: boolean, setShowHelp: (v: boolean) => void) {
  const store = useMeetingStore;

  useEffect(() => {
    const state = () => store.getState();
    if (state().screen !== 'meeting') return;

    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'm': state().toggleMic(); break;
        case 'v': state().toggleCamera(); break;
        case 's': state().toggleScreenShare(); break;
        case 'h': state().toggleHandRaise('1'); break;
        case 'r': state().toggleRecording(); break;
        case 'n': state().toggleNoiseCancellation(); break;
        case 't': state().toggleTranslation(); break;
        case 'p': state().toggleRightPanel('participants'); break;
        case 'c': state().toggleRightPanel('chat'); break;
        case 'a': state().toggleRightPanel('ai'); break;
        case 'i': state().toggleInvite(); break;
        case 'b': state().toggleBreakoutRooms(); break;
        case ',': state().toggleSettings(); break;
        case 'q': state().leaveMeeting(); break;
        case '?': setShowHelp(!showHelp); break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHelp, setShowHelp]);
}
