import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Users,
  PhoneOff,
  BrainCircuit,
  MonitorOff,
  MessageCircle,
  Hand,
  Smile,
  Settings,
  LayoutGrid,
  X,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { ReactionBar } from './ReactionBar';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Forces a re-render when the viewport is resized, the tab is zoomed, or the
 * display's devicePixelRatio changes (e.g. moving between monitors with
 * different scaling). Ensures fixed/centered elements re-lay out immediately.
 */
function useViewportSync() {
  const [, setTick] = useState(0);
  useEffect(() => {
    let cleanupDpr: (() => void) | null = null;
    const bump = () => setTick((t) => t + 1);
    const listenDpr = () => {
      cleanupDpr?.();
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => { bump(); listenDpr(); };
      mq.addEventListener?.('change', onChange);
      cleanupDpr = () => mq.removeEventListener?.('change', onChange);
    };
    window.addEventListener('resize', bump);
    window.addEventListener('orientationchange', bump);
    listenDpr();
    return () => {
      window.removeEventListener('resize', bump);
      window.removeEventListener('orientationchange', bump);
      cleanupDpr?.();
    };
  }, []);
}

function ControlButton({
  icon: Icon,
  label,
  active = false,
  danger = false,
  highlight = false,
  warning = false,
  badge,
  onClick,
  compact = false,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  danger?: boolean;
  highlight?: boolean;
  warning?: boolean;
  badge?: number;
  onClick: () => void;
  compact?: boolean;
}) {
  const size = compact ? 'h-10 min-w-10 px-2' : 'h-11 min-w-11 px-2.5';
  const iconSize = 'w-4 h-4';

  return (
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      title={label}
      className={`relative ${size} rounded-full flex items-center justify-center transition-colors shrink-0 ${
        danger
          ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
          : warning
          ? 'bg-amber-400 text-amber-900 hover:bg-amber-300'
          : highlight
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : active
          ? 'bg-secondary text-foreground hover:bg-secondary/80'
          : 'bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      <Icon className={iconSize} />
      {badge && badge > 0 ? (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
          {badge}
        </span>
      ) : null}
    </motion.button>
  );
}

export function FloatingControlBar() {
  const {
    isMicOn,
    isCameraOn,
    isScreenSharing,
    rightPanel,
    unreadChats,
    participants,
    isControlBarCollapsed,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleRightPanel,
    toggleHandRaise,
    toggleSettings,
    toggleBreakoutRooms,
    toggleControlBarCollapsed,
    leaveMeeting,
  } = useMeetingStore();

  const [showReactions, setShowReactions] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const isMobile = useIsMobile();
  useViewportSync();
  const myHandRaised = participants.find((p) => p.id === '1')?.handRaised ?? false;
  return (
    <>
      {showReactions && <ReactionBar />}
      <AnimatePresence mode="wait">
        {isControlBarCollapsed ? (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, x: -32, scale: 0.7 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -32, scale: 0.7 }}
            transition={{ type: 'spring', damping: 22, stiffness: 320 }}
            className="absolute left-4 top-1/2 z-40 -translate-y-1/2 md:left-6"
          >
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              onClick={toggleControlBarCollapsed}
              className="relative w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center control-bar-elevated border border-border"
              title="Expand controls"
            >
              <motion.span
                className="absolute inset-0 rounded-full border border-primary/40"
                animate={{ scale: [1, 1.18, 1], opacity: [0.75, 0.15, 0.75] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.92 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            data-testid="floating-control-bar"
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-0 mx-auto z-40 flex w-fit max-w-[calc(100vw-1rem)] items-center justify-center gap-1.5 overflow-x-auto rounded-[28px] border border-border bg-background/95 px-2 py-2 backdrop-blur-md control-bar-elevated sm:bottom-4 sm:px-3 sm:py-2.5"
          >
            {/* Core controls always visible */}
            <ControlButton icon={isMicOn ? Mic : MicOff} label={isMicOn ? 'Mute' : 'Unmute'} active={isMicOn} onClick={toggleMic} compact={isMobile} />
            <ControlButton icon={isCameraOn ? Video : VideoOff} label={isCameraOn ? 'Camera off' : 'Camera on'} active={isCameraOn} onClick={toggleCamera} compact={isMobile} />
            {!isMobile && (
              <ControlButton icon={isScreenSharing ? MonitorOff : Monitor} label={isScreenSharing ? 'Stop sharing' : 'Screen share'} active={isScreenSharing} highlight={isScreenSharing} onClick={toggleScreenShare} />
            )}
            <ControlButton icon={Hand} label={myHandRaised ? 'Lower hand' : 'Raise hand'} warning={myHandRaised} onClick={() => toggleHandRaise('1')} compact={isMobile} />
            <ControlButton icon={Smile} label="Reactions" active={showReactions} highlight={showReactions} onClick={() => setShowReactions(!showReactions)} compact={isMobile} />

            <div className="w-px h-6 bg-border shrink-0" />

            <ControlButton icon={Users} label="Participants" active={rightPanel === 'participants'} highlight={rightPanel === 'participants'} onClick={() => toggleRightPanel('participants')} compact={isMobile} />
            <ControlButton icon={MessageCircle} label="Chat" active={rightPanel === 'chat'} highlight={rightPanel === 'chat'} badge={rightPanel !== 'chat' ? unreadChats : 0} onClick={() => toggleRightPanel('chat')} compact={isMobile} />

            {/* More menu on mobile, inline on desktop */}
            {isMobile ? (
              <div className="relative">
                <ControlButton icon={MoreHorizontal} label="More" active={showMore} onClick={() => setShowMore(!showMore)} compact />
                <AnimatePresence>
                  {showMore && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.9 }}
                      className="absolute bottom-14 right-0 bg-background border border-border rounded-2xl p-2 flex flex-col gap-1.5 control-bar-elevated min-w-[210px]"
                    >
                      {[
                        { icon: BrainCircuit, label: 'AI Sidebar', onClick: () => { toggleRightPanel('ai'); setShowMore(false); }, highlight: rightPanel === 'ai' },
                        { icon: Monitor, label: isScreenSharing ? 'Stop sharing' : 'Screen share', onClick: () => { toggleScreenShare(); setShowMore(false); }, highlight: isScreenSharing },
                        { icon: LayoutGrid, label: 'Breakout Rooms', onClick: () => { toggleBreakoutRooms(); setShowMore(false); } },
                        { icon: Settings, label: 'Settings', onClick: () => { toggleSettings(); setShowMore(false); } },
                        { icon: X, label: 'Collapse', onClick: () => { toggleControlBarCollapsed(); setShowMore(false); } },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={item.onClick}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors w-full text-left ${
                            item.highlight ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                          }`}
                        >
                          <item.icon className="w-4 h-4 shrink-0" />
                          {item.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <>
                <ControlButton icon={BrainCircuit} label="AI Sidebar" active={rightPanel === 'ai'} highlight={rightPanel === 'ai'} onClick={() => toggleRightPanel('ai')} />
                <ControlButton icon={LayoutGrid} label="Breakout Rooms" onClick={toggleBreakoutRooms} />
                <ControlButton icon={Settings} label="Settings" onClick={toggleSettings} />
                <div className="w-px h-6 bg-border shrink-0" />
                <ControlButton icon={X} label="Collapse controls" onClick={toggleControlBarCollapsed} />
              </>
            )}

            <ControlButton icon={PhoneOff} label="Leave meeting" danger onClick={leaveMeeting} compact={isMobile} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
