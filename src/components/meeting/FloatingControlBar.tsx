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
  PenSquare,
  PenLine,
  MousePointerClick,
  BarChart3,
  Circle,
  Image as ImageIcon,
  UserPlus,
  Activity,
  Keyboard,
  Info,
} from 'lucide-react';
import { useMeetingStore } from '@/store/meetingStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { ReactionBar } from './ReactionBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { openMobileSubmenu, isRealMobileDevice, isChromeDevtoolsEmulation } from './MobileSubmenus';

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
  disabled = false,
  testId,
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
  disabled?: boolean;
  testId?: string;
}) {
  const size = compact ? 'h-10 min-w-10 px-2' : 'h-11 min-w-11 px-2.5';
  const iconSize = 'w-4 h-4';

  return (
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      className={`relative ${size} rounded-full flex items-center justify-center transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
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
    isRecording,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleRightPanel,
    toggleHandRaise,
    toggleSettings,
    toggleBreakoutRooms,
    toggleControlBarCollapsed,
    toggleRecording,
    toggleInvite,
    leaveMeeting,
  } = useMeetingStore();

  const [showReactions, setShowReactions] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const isMobile = useIsMobile();
  useViewportSync();
  const myHandRaised = participants.find((p) => p.id === '1')?.handRaised ?? false;

  // Permission-aware controls: the host's decisions disable the local buttons
  // (the media tracks are disabled by the session manager and useWebRTC).
  const session = useMeetingStore((s) => s.session);
  const isAnnotating = useMeetingStore((s) => s.isAnnotating);
  const toggleAnnotating = useMeetingStore((s) => s.toggleAnnotating);
  const myPermission = useMeetingStore.getState().myPermission();
  const isHost = !!session.myUserId && session.myUserId === session.hostUserId;
  const hasPresentation = !!session.presenterId;
  const canAnnotate = hasPresentation && myPermission.canAnnotate && (session.meetingControls.annotationEnabled || isHost);
  const rcState = session.rcViewerState;
  const micBlocked = !myPermission.canSpeak;
  const cameraBlocked = !myPermission.canUseCamera;
  const shareBlocked = !myPermission.canShareScreen;
  const requestControlToggle = () => window.dispatchEvent(new CustomEvent('livedesk:rc-toggle'));

  // Keyboard shortcut: Ctrl/Cmd+/ focuses the taskbar (accessible entry point)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        const bar = document.querySelector<HTMLElement>('[data-testid="floating-control-bar"]');
        const first = bar?.querySelector<HTMLElement>('button');
        if (first) {
          e.preventDefault();
          first.focus();
          const region = document.getElementById('control-bar-live');
          if (region) region.textContent = 'Meeting controls focused. Use Tab to move.';
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Announced region for screen readers */}
      <div
        id="control-bar-live"
        role="status"
        aria-live="polite"
        className="sr-only"
      />
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
            <ControlButton icon={isMicOn ? Mic : MicOff} label={micBlocked ? 'Muted by host' : isMicOn ? 'Mute' : 'Unmute'} active={isMicOn} disabled={micBlocked} onClick={toggleMic} compact={isMobile} />
            <ControlButton icon={isCameraOn ? Video : VideoOff} label={cameraBlocked ? 'Camera disabled by host' : isCameraOn ? 'Camera off' : 'Camera on'} active={isCameraOn} disabled={cameraBlocked} onClick={toggleCamera} compact={isMobile} />
            {!isMobile && (
              <ControlButton icon={isScreenSharing ? MonitorOff : Monitor} label={shareBlocked ? 'Screen sharing disabled by host' : isScreenSharing ? 'Stop sharing' : 'Screen share'} active={isScreenSharing} highlight={isScreenSharing} disabled={shareBlocked && !isScreenSharing} onClick={toggleScreenShare} />
            )}
            {!isMobile && hasPresentation && (
              <ControlButton
                icon={PenLine}
                label={canAnnotate ? (isAnnotating ? 'Stop annotating' : 'Annotate') : 'Annotation not allowed'}
                active={isAnnotating}
                highlight={isAnnotating}
                disabled={!canAnnotate}
                onClick={toggleAnnotating}
                testId="control-annotate"
              />
            )}
            {!isMobile && rcState !== 'unavailable' && (
              <ControlButton
                icon={MousePointerClick}
                label={rcState === 'controlling' ? 'Release control' : rcState === 'requesting' ? 'Cancel control request' : 'Request control'}
                active={rcState !== 'idle'}
                highlight={rcState === 'controlling'}
                warning={rcState === 'requesting'}
                onClick={requestControlToggle}
                testId="control-remote"
              />
            )}
            <ControlButton icon={Hand} label={myHandRaised ? 'Lower hand' : 'Raise hand'} warning={myHandRaised} onClick={() => toggleHandRaise('1')} compact={isMobile} />
            <ControlButton icon={Smile} label="Reactions" active={showReactions} highlight={showReactions} onClick={() => setShowReactions(!showReactions)} compact={isMobile} />

            <div className="w-px h-6 bg-border shrink-0" />

            <ControlButton icon={Users} label="Participants" active={rightPanel === 'participants'} highlight={rightPanel === 'participants'} onClick={() => toggleRightPanel('participants')} compact={isMobile} />
            <ControlButton icon={MessageCircle} label="Chat" active={rightPanel === 'chat'} highlight={rightPanel === 'chat'} badge={rightPanel !== 'chat' ? unreadChats : 0} onClick={() => toggleRightPanel('chat')} compact={isMobile} />

            {/* More menu on mobile, inline on desktop */}
            {isMobile ? (
              <ControlButton icon={MoreHorizontal} label="More" active={showMore} onClick={() => setShowMore(true)} compact />
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

      {/* Mobile "More" Bottom Sheet */}
      <AnimatePresence>
        {isMobile && showMore && (
          <>
            <motion.div
              key="more-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowMore(false)}
              className="fixed inset-0 z-[70] bg-background/60 backdrop-blur-sm"
              aria-hidden="true"
            />
            <motion.div
              key="more-sheet"
              role="dialog"
              aria-label="More meeting options"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 500) setShowMore(false);
              }}
              className="fixed inset-x-0 bottom-0 z-[71] h-[82vh] rounded-t-3xl border-t border-border bg-background shadow-2xl flex flex-col"
            >
              <div className="pt-3 pb-2 flex flex-col items-center shrink-0">
                <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
                <h2 className="mt-3 text-base font-semibold text-foreground">More options</h2>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { icon: Settings, label: 'Settings', onClick: () => toggleSettings() },
                    { icon: LayoutGrid, label: 'Breakout', onClick: () => toggleBreakoutRooms() },
                    { icon: PenSquare, label: 'Whiteboard', onClick: () => openMobileSubmenu('whiteboard') },
                    { icon: BarChart3, label: 'Polls', onClick: () => openMobileSubmenu('polls') },
                    { icon: Circle, label: isRecording ? 'Stop Rec' : 'Record', onClick: () => toggleRecording(), highlight: isRecording },
                    { icon: ImageIcon, label: 'Background', onClick: () => openMobileSubmenu('background') },
                    { icon: UserPlus, label: 'Invite', onClick: () => openMobileSubmenu('invite') },
                    {
                      icon: Monitor,
                      label: isScreenSharing ? 'Stop Share' : 'Share',
                      onClick: () => {
                        // Already sharing → stop normally
                        if (isScreenSharing) { toggleScreenShare(); return; }
                        // Chrome DevTools mobile emulation → show informational sheet, never open desktop picker
                        if (isChromeDevtoolsEmulation()) { openMobileSubmenu('screen-share-unsupported'); return; }
                        // Real mobile device without getDisplayMedia support → unsupported sheet
                        const hasApi = typeof navigator !== 'undefined'
                          && !!navigator.mediaDevices
                          && typeof navigator.mediaDevices.getDisplayMedia === 'function';
                        if (isRealMobileDevice() && !hasApi) { openMobileSubmenu('screen-share-unsupported'); return; }
                        // Supported (e.g. Chrome Android with the API) → proceed
                        toggleScreenShare();
                      },
                      highlight: isScreenSharing,
                    },
                    { icon: BrainCircuit, label: 'AI Assistant', onClick: () => openMobileSubmenu('ai'), highlight: rightPanel === 'ai' },
                    { icon: Activity, label: 'Stats', onClick: () => openMobileSubmenu('stats') },
                    { icon: Keyboard, label: 'Shortcuts', onClick: () => openMobileSubmenu('shortcuts') },
                    { icon: Info, label: 'About', onClick: () => openMobileSubmenu('about') },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { item.onClick(); setShowMore(false); }}
                      className="flex flex-col items-center gap-2 rounded-2xl p-3 transition-colors hover:bg-muted active:bg-muted/70"
                    >
                      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                        item.highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                      }`}>
                        <item.icon className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] font-medium text-foreground text-center leading-tight">{item.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setShowMore(false); leaveMeeting(); }}
                  className="mt-6 w-full h-12 rounded-2xl bg-destructive text-destructive-foreground font-semibold flex items-center justify-center gap-2"
                >
                  <PhoneOff className="w-4 h-4" /> Leave Meeting
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
