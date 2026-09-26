import { NavigationBar } from './NavigationBar';
import { VideoGrid } from './VideoGrid';
import { FloatingControlBar } from './FloatingControlBar';
import { AISidebar } from './AISidebar';
import { ParticipantPanel } from './ParticipantPanel';
import { ChatPanel } from './ChatPanel';
import { SettingsModal } from './SettingsModal';
import { BreakoutRoomsModal } from './BreakoutRoomsModal';
import { InviteModal } from './InviteModal';
import { KeyboardShortcutsOverlay, useKeyboardShortcuts } from './KeyboardShortcuts';
import { PipOverlay } from './PipOverlay';
import { MeetingPresenceManager } from './MeetingPresenceManager';
import { JoinRequestNotifier } from './JoinRequestNotifier';
import { PerformanceHud } from './PerformanceHud';
import { AlignmentDebugOverlay } from './AlignmentDebugOverlay';
import { MobileSubmenus } from './MobileSubmenus';
import { MediaDiagnosticsPanel } from './MediaDiagnosticsPanel';
import { ElectronSourcePicker } from './ElectronSourcePicker';
import { RoomSync } from './RoomSync';
import { ConnectionBanner } from './ConnectionBanner';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useMeetingRecorder } from '@/hooks/useMeetingRecorder';
import { useVirtualBackground } from '@/hooks/useVirtualBackground';
import { useTranslationPipeline } from '@/hooks/useTranslationPipeline';
import { recoverRemoteAudioPlayback } from '@/lib/remoteAudioRecovery';
import { getDataBus } from '@/lib/dataPlane';
import { useMeetingStore } from '@/store/meetingStore';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';

export function MeetingRoom() {
  const [showHelp, setShowHelp] = useState(false);
  useKeyboardShortcuts(showHelp, setShowHelp);

  const meetingId = useMeetingStore((s) => s.meetingId);
  const screen = useMeetingStore((s) => s.screen);
  const isRecording = useMeetingStore((s) => s.isRecording);
  const rightPanel = useMeetingStore((s) => s.rightPanel);
  const setRightPanel = useMeetingStore((s) => s.setRightPanel);
  const isMobile = useIsMobile();
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const { localStream, remoteStreams, screenStream, remoteScreenStream, remoteScreenPeerId, peerStates, connectionSummary, getPeerStats, getPeerDiagnostics, getDiagnosticsSnapshot, selectLocalDevices } = useWebRTC(meetingId, screen === 'meeting');
  const setSession = useMeetingStore((s) => s.setSession);

  // Mirror the media-plane connection state into the central session state
  // so the top bar and participant panel show real connection status.
  const hostSessionId = useMeetingStore((s) => s.session.hostSessionId);
  const meetingSessionId = useMeetingStore((s) => s.meetingSessionId);
  useEffect(() => {
    const states: Record<string, string> = {};
    peerStates.forEach((state, peerId) => {
      states[peerId] = state;
    });
    const hostState = hostSessionId && hostSessionId !== meetingSessionId ? states[hostSessionId] : undefined;
    const hostDown = hostState === 'disconnected' || hostState === 'failed';
    setSession({ peerConnectionStates: states, connectionState: hostDown ? 'host-disconnected' : connectionSummary });
  }, [peerStates, connectionSummary, setSession, hostSessionId, meetingSessionId]);

  const PANEL_CYCLE: Array<'ai' | 'participants' | 'chat'> = ['ai', 'participants', 'chat'];
  useSwipeGesture(videoAreaRef, {
    enabled: isMobile && screen === 'meeting',
    onSwipeLeft: () => {
      if (!rightPanel) {
        setRightPanel('ai');
      } else {
        const idx = PANEL_CYCLE.indexOf(rightPanel);
        const next = PANEL_CYCLE[(idx + 1) % PANEL_CYCLE.length];
        setRightPanel(next);
      }
    },
    onSwipeRight: () => {
      if (rightPanel) setRightPanel(null);
    },
  });
  const processedLocalStream = useVirtualBackground(localStream);
  useTranslationPipeline({ enabled: screen === 'meeting', localStream, remoteStreams });

  // Settings modal device changes are applied by useWebRTC (track replacement).
  useEffect(() => {
    const onSelect = (e: Event) => {
      const detail = (e as CustomEvent<{ audioDeviceId?: string; videoDeviceId?: string }>).detail;
      if (detail) selectLocalDevices(detail);
    };
    window.addEventListener('livedesk:select-devices', onSelect);
    return () => window.removeEventListener('livedesk:select-devices', onSelect);
  }, [selectLocalDevices]);
  const { startRecording, stopRecording, recordingBlob, downloadRecording, clearRecording } = useMeetingRecorder();
  const [soundUnlockVisible, setSoundUnlockVisible] = useState(false);

  useEffect(() => {
    if (screen !== 'meeting') return;

    const unlockAudio = () => {
      void recoverRemoteAudioPlayback('global-unlock').then((result) => {
        setSoundUnlockVisible(result.blocked > 0);
      });
    };

    const onBlocked = () => setSoundUnlockVisible(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') unlockAudio();
    };
    window.addEventListener('remote-audio-blocked', onBlocked);
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('touchend', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('online', unlockAudio);
    window.addEventListener('pageshow', unlockAudio);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('remote-audio-blocked', onBlocked);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('touchend', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('online', unlockAudio);
      window.removeEventListener('pageshow', unlockAudio);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [screen]);

  useEffect(() => {
    if (import.meta.env.PROD || typeof window === 'undefined') return;

    const e2eWindow = window as typeof window & {
      __ZOOM_CONNECT_E2E__?: {
        addBreakoutParticipants: (names: string[]) => void;
        assignAllToFirstRoom?: () => void;
        simulateSelfCaptureShare?: (on: boolean) => void;
      };
      __LIVEDESK_DEBUG__?: Record<string, unknown>;
    };

    // Development-only introspection for the real-media browser tests.
    e2eWindow.__LIVEDESK_DEBUG__ = {
      store: useMeetingStore,
      bus: getDataBus(),
      getDiagnosticsSnapshot,
      executedInputs: () => (window as typeof window & { __livedeskExecutedInputs?: number }).__livedeskExecutedInputs ?? 0,
    };

    e2eWindow.__ZOOM_CONNECT_E2E__ = {
      addBreakoutParticipants: (names) => {
        names.forEach((name) => useMeetingStore.getState().addSimulatedParticipant(name));
      },
      assignAllToFirstRoom: () => {
        const state = useMeetingStore.getState();
        const rooms = state.breakoutRooms.length
          ? state.breakoutRooms
          : [
              { id: '1', name: 'Room 1', participantIds: [] as string[] },
              { id: '2', name: 'Room 2', participantIds: [] as string[] },
            ];
        const [first, ...rest] = rooms;
        state.setBreakoutRooms([
          { ...first, participantIds: state.participants.map((p) => p.id) },
          ...rest.map((r) => ({ ...r, participantIds: [] as string[] })),
        ]);
      },
      simulateSelfCaptureShare: (on) => {
        const state = useMeetingStore.getState();
        state.setSelfCapture(on);
        if (on && !state.isScreenSharing) state.toggleScreenShare();
        if (!on && state.isScreenSharing) state.toggleScreenShare();
      },
    };

    return () => {
      delete e2eWindow.__ZOOM_CONNECT_E2E__;
      delete e2eWindow.__LIVEDESK_DEBUG__;
    };
  }, [getDiagnosticsSnapshot]);

  // Sync store recording toggle with actual MediaRecorder
  useEffect(() => {
    if (isRecording && processedLocalStream) {
      const streams: MediaStream[] = [processedLocalStream];
      if (screenStream) streams.push(screenStream);
      if (remoteScreenStream) streams.push(remoteScreenStream);
      remoteStreams?.forEach((s) => streams.push(s));
      startRecording(streams);
    } else if (!isRecording) {
      stopRecording();
    }
  }, [isRecording, processedLocalStream, remoteScreenStream, remoteStreams, screenStream, startRecording, stopRecording]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <MeetingPresenceManager />
      <RoomSync />
      <NavigationBar />
      <ConnectionBanner />
      <div className="flex-1 flex overflow-hidden">
        <div ref={videoAreaRef} className="flex-1 relative flex flex-col min-w-0">
          <VideoGrid localStream={processedLocalStream} remoteStreams={remoteStreams} screenStream={screenStream} remoteScreenStream={remoteScreenStream} remoteScreenPeerId={remoteScreenPeerId} getDiagnosticsSnapshot={getDiagnosticsSnapshot} />
          <FloatingControlBar />
        </div>
        <AISidebar />
        <ParticipantPanel />
        <ChatPanel />
      </div>
      <SettingsModal />
      <BreakoutRoomsModal />
      <InviteModal />
      <KeyboardShortcutsOverlay isOpen={showHelp} onClose={() => setShowHelp(false)} />
      <PipOverlay />
      <JoinRequestNotifier />
      <PerformanceHud getPeerStats={getPeerStats} getPeerDiagnostics={getPeerDiagnostics} getDiagnosticsSnapshot={getDiagnosticsSnapshot} />
      <MediaDiagnosticsPanel onSelectDevices={selectLocalDevices} getDiagnosticsSnapshot={getDiagnosticsSnapshot} />
      <AlignmentDebugOverlay />
      <MobileSubmenus />
      <ElectronSourcePicker />

      {soundUnlockVisible && (
        <button
          type="button"
          onClick={() => {
            void recoverRemoteAudioPlayback('tap-to-enable').then((result) => {
              setSoundUnlockVisible(result.blocked > 0);
            });
          }}
          className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[80] -translate-x-1/2 rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-semibold text-foreground shadow-lg backdrop-blur-md md:hidden"
        >
          Tap to enable sound
        </button>
      )}

      {/* Recording download prompt after meeting */}
      {recordingBlob && screen === 'lobby' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 right-6 bg-background border border-border rounded-2xl p-4 shadow-lg z-50 flex flex-col gap-3 max-w-xs"
        >
          <p className="text-sm font-medium text-foreground">Meeting recording ready!</p>
          <p className="text-xs text-muted-foreground">Your recording is available for download.</p>
          <div className="flex gap-2">
            <button
              onClick={downloadRecording}
              className="flex-1 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Download
            </button>
            <button
              onClick={clearRecording}
              className="px-3 py-2 rounded-xl border border-border text-foreground text-sm hover:bg-muted transition-colors"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}