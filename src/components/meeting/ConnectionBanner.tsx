import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, WifiOff } from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';

/** Visible, truthful connection state. No silent failures. */
export function ConnectionBanner() {
  const state = useMeetingStore((s) => s.session.connectionState);
  const message =
    state === 'reconnecting'
      ? 'Reconnecting to the meeting. Audio and video resume automatically.'
      : state === 'failed'
        ? 'Connection failed. Check your network; LiveDesk keeps retrying.'
        : state === 'host-disconnected'
          ? 'Host disconnected. Waiting for the host to reconnect.'
          : null;
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          role="status"
          aria-live="assertive"
          data-testid="connection-banner"
          data-state={state}
          className={`flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${state === 'reconnecting' ? 'bg-amber-500/15 text-amber-700' : 'bg-destructive/10 text-destructive'}`}
        >
          {state === 'reconnecting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
