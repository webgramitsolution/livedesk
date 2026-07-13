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
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useMeetingRecorder } from '@/hooks/useMeetingRecorder';
import { useVirtualBackground } from '@/hooks/useVirtualBackground';
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
  const { localStream, remoteStreams, screenStream, remoteScreenStream, getPeerStats } = useWebRTC(meetingId, screen === 'meeting');

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
  const { startRecording, stopRecording, recordingBlob, downloadRecording, clearRecording } = useMeetingRecorder();

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
      <NavigationBar />
      <div className="flex-1 flex overflow-hidden">
        <div ref={videoAreaRef} className="flex-1 relative flex flex-col min-w-0">
          <VideoGrid localStream={processedLocalStream} remoteStreams={remoteStreams} screenStream={screenStream} remoteScreenStream={remoteScreenStream} />
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
      <PerformanceHud getPeerStats={getPeerStats} />
      <AlignmentDebugOverlay />

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