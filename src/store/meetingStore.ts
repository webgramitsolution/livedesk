import { create } from 'zustand';

export interface Participant {
  id: string;
  name: string;
  isMuted: boolean;
  isCameraOn: boolean;
  isSpeaking: boolean;
  hasMouseControl: boolean;
  mouseControlRequested: boolean;
  handRaised: boolean;
  handRaisedAt: number | null;
  avatar: string;
  spokenLanguage: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  isActive: boolean;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isOwn: boolean;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  participantId: string;
  createdAt: number;
}

export interface BreakoutRoom {
  id: string;
  name: string;
  participantIds: string[];
}

type LatencyStatus = 'good' | 'medium' | 'poor';
type AppScreen = 'lobby' | 'connecting' | 'meeting' | 'waiting';
type RightPanel = 'ai' | 'participants' | 'chat' | null;

interface MeetingState {
  screen: AppScreen;
  meetingId: string;
  meetingSessionId: string;
  userName: string;
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isSelfCapture: boolean;
  isRecording: boolean;
  recordingStartTime: number | null;
  meetingJoinedAt: number | null;
  isTranslationEnabled: boolean;
  isNoiseCancellationOn: boolean;
  isPipActive: boolean;
  isSettingsOpen: boolean;
  rightPanel: RightPanel;
  latency: LatencyStatus;
  participants: Participant[];
  transcript: TranscriptEntry[];
  chatMessages: ChatMessage[];
  unreadChats: number;
  reactions: FloatingReaction[];
  showSummary: boolean;
  summaryPoints: string[];
  showBreakoutRooms: boolean;
  breakoutRooms: BreakoutRoom[];
  breakoutActive: boolean;
  selectedBackground: string;
  showInvite: boolean;
  isControlBarCollapsed: boolean;
  showPerfHud: boolean;
  pendingJoinRequestId: string | null;
  aiLatencyMs: number;

  // Settings state
  selectedLanguage: string;
  selectedAudioInput: string;
  selectedAudioOutput: string;
  selectedVideoInput: string;
  selectedAiModel: string;

  setScreen: (screen: AppScreen) => void;
  setMeetingId: (id: string) => void;
  setUserName: (name: string) => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
  setSelfCapture: (v: boolean) => void;
  toggleRecording: () => void;
  toggleTranslation: () => void;
  toggleNoiseCancellation: () => void;
  togglePip: () => void;
  toggleSettings: () => void;
  setRightPanel: (panel: RightPanel) => void;
  toggleRightPanel: (panel: 'ai' | 'participants' | 'chat') => void;
  requestMouseControl: (participantId: string) => void;
  grantMouseControl: (participantId: string) => void;
  revokeMouseControl: () => void;
  toggleHandRaise: (participantId: string) => void;
  sendChatMessage: (text: string) => void;
  sendReaction: (emoji: string, participantId: string) => void;
  removeReaction: (reactionId: string) => void;
  setSelectedLanguage: (lang: string) => void;
  setSelectedAudioInput: (device: string) => void;
  setSelectedAudioOutput: (device: string) => void;
  setSelectedVideoInput: (device: string) => void;
  setSelectedAiModel: (model: string) => void;
  setSelectedBackground: (bg: string) => void;
  dismissSummary: () => void;
  toggleBreakoutRooms: () => void;
  toggleInvite: () => void;
  toggleControlBarCollapsed: () => void;
  togglePerfHud: () => void;
  setPendingJoinRequestId: (id: string | null) => void;
  setAiLatencyMs: (ms: number) => void;
  setBreakoutRooms: (rooms: BreakoutRoom[]) => void;
  startBreakoutSession: () => void;
  endBreakoutSession: () => void;
  joinMeeting: () => void;
  joinExistingMeeting: (meetingId: string, userName: string) => void;
  addSimulatedParticipant: (name: string) => void;
  leaveMeeting: () => void;
}

const INITIAL_PARTICIPANTS: Participant[] = [
  { id: '1', name: 'You', isMuted: false, isCameraOn: true, isSpeaking: false, hasMouseControl: false, mouseControlRequested: false, handRaised: false, handRaisedAt: null, avatar: 'Y', spokenLanguage: 'en' },
];

const createLocalParticipant = (name: string): Participant => ({
  id: '1',
  name: name || 'You',
  isMuted: false,
  isCameraOn: true,
  isSpeaking: false,
  hasMouseControl: false,
  mouseControlRequested: false,
  handRaised: false,
  handRaisedAt: null,
  avatar: (name || 'Y')[0]?.toUpperCase() || 'Y',
  spokenLanguage: 'en',
});

const ACTIVE_MEETING_SESSION_KEY = 'zoom-connect-active-meeting';

type PersistedMeetingState = {
  screen: AppScreen;
  meetingId: string;
  meetingSessionId: string;
  userName: string;
  meetingJoinedAt: number | null;
  isMicOn: boolean;
  isCameraOn: boolean;
  isNoiseCancellationOn: boolean;
  selectedBackground: string;
  selectedLanguage: string;
  selectedAudioInput: string;
  selectedAudioOutput: string;
  selectedVideoInput: string;
  selectedAiModel: string;
  rightPanel: RightPanel;
  isControlBarCollapsed: boolean;
  showPerfHud: boolean;
};

const readPersistedMeetingState = (): PersistedMeetingState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(ACTIVE_MEETING_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedMeetingState;

    if (!parsed.meetingId || (parsed.screen !== 'connecting' && parsed.screen !== 'meeting')) {
      window.sessionStorage.removeItem(ACTIVE_MEETING_SESSION_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.sessionStorage.removeItem(ACTIVE_MEETING_SESSION_KEY);
    return null;
  }
};

const persistMeetingState = (state: MeetingState) => {
  if (typeof window === 'undefined') return;

  if (state.screen !== 'connecting' && state.screen !== 'meeting') {
    window.sessionStorage.removeItem(ACTIVE_MEETING_SESSION_KEY);
    return;
  }

  const snapshot: PersistedMeetingState = {
    screen: state.screen,
    meetingId: state.meetingId,
    meetingSessionId: state.meetingSessionId,
    userName: state.userName,
    meetingJoinedAt: state.meetingJoinedAt,
    isMicOn: state.isMicOn,
    isCameraOn: state.isCameraOn,
    isNoiseCancellationOn: state.isNoiseCancellationOn,
    selectedBackground: state.selectedBackground,
    selectedLanguage: state.selectedLanguage,
    selectedAudioInput: state.selectedAudioInput,
    selectedAudioOutput: state.selectedAudioOutput,
    selectedVideoInput: state.selectedVideoInput,
    selectedAiModel: state.selectedAiModel,
    rightPanel: state.rightPanel,
    isControlBarCollapsed: state.isControlBarCollapsed,
    showPerfHud: state.showPerfHud,
  };

  window.sessionStorage.setItem(ACTIVE_MEETING_SESSION_KEY, JSON.stringify(snapshot));
};

const persistedMeetingState = readPersistedMeetingState();

export const useMeetingStore = create<MeetingState>((set) => ({
  screen: persistedMeetingState?.screen ?? 'lobby',
  meetingId: persistedMeetingState?.meetingId ?? '',
  meetingSessionId: persistedMeetingState?.meetingSessionId ?? '',
  userName: persistedMeetingState?.userName ?? '',
  isMicOn: persistedMeetingState?.isMicOn ?? true,
  isCameraOn: persistedMeetingState?.isCameraOn ?? true,
  isScreenSharing: false,
  isRecording: false,
  recordingStartTime: null,
  meetingJoinedAt: persistedMeetingState?.meetingJoinedAt ?? null,
  isTranslationEnabled: true,
  isNoiseCancellationOn: persistedMeetingState?.isNoiseCancellationOn ?? false,
  isPipActive: false,
  isSettingsOpen: false,
  rightPanel: persistedMeetingState?.rightPanel ?? 'ai',
  latency: 'good',
  participants: persistedMeetingState?.meetingId ? [createLocalParticipant(persistedMeetingState.userName || 'You')] : INITIAL_PARTICIPANTS,
  transcript: [],
  chatMessages: [],
  isControlBarCollapsed: persistedMeetingState?.isControlBarCollapsed ?? false,
  unreadChats: 0,
  reactions: [],
  showSummary: false,
  summaryPoints: [],
  showBreakoutRooms: false,
  breakoutRooms: [],
  breakoutActive: false,
  selectedBackground: persistedMeetingState?.selectedBackground ?? 'none',
  showInvite: false,
  showPerfHud: persistedMeetingState?.showPerfHud ?? false,
  pendingJoinRequestId: null,
  aiLatencyMs: 0,
  selectedLanguage: persistedMeetingState?.selectedLanguage ?? 'en',
  selectedAudioInput: persistedMeetingState?.selectedAudioInput ?? 'default',
  selectedAudioOutput: persistedMeetingState?.selectedAudioOutput ?? 'default',
  selectedVideoInput: persistedMeetingState?.selectedVideoInput ?? 'default',
  selectedAiModel: persistedMeetingState?.selectedAiModel ?? 'whisper-tiny',

  setScreen: (screen) => set({ screen }),
  setMeetingId: (meetingId) => set({ meetingId }),
  setUserName: (userName) => set({ userName }),
  toggleMic: () => set((s) => ({ isMicOn: !s.isMicOn })),
  toggleCamera: () => set((s) => ({ isCameraOn: !s.isCameraOn })),
  toggleScreenShare: () => set((s) => ({ isScreenSharing: !s.isScreenSharing })),
  toggleRecording: () =>
    set((s) => ({
      isRecording: !s.isRecording,
      recordingStartTime: !s.isRecording ? Date.now() : null,
    })),
  toggleTranslation: () => set((s) => ({ isTranslationEnabled: !s.isTranslationEnabled })),
  toggleNoiseCancellation: () => set((s) => ({ isNoiseCancellationOn: !s.isNoiseCancellationOn })),
  togglePip: () => set((s) => ({ isPipActive: !s.isPipActive })),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  toggleRightPanel: (panel) =>
    set((s) => ({
      rightPanel: s.rightPanel === panel ? null : panel,
      unreadChats: panel === 'chat' ? 0 : s.unreadChats,
    })),
  requestMouseControl: (participantId) =>
    set((s) => ({
      participants: s.participants.map((p) => ({
        ...p,
        mouseControlRequested: p.id === participantId ? !p.mouseControlRequested : p.mouseControlRequested,
      })),
    })),
  grantMouseControl: (participantId) =>
    set((s) => ({
      participants: s.participants.map((p) => ({
        ...p,
        hasMouseControl: p.id === participantId,
        mouseControlRequested: p.id === participantId ? false : p.mouseControlRequested,
      })),
    })),
  revokeMouseControl: () =>
    set((s) => ({
      participants: s.participants.map((p) => ({ ...p, hasMouseControl: false })),
    })),
  toggleHandRaise: (participantId) =>
    set((s) => ({
      participants: s.participants.map((p) =>
        p.id === participantId
          ? { ...p, handRaised: !p.handRaised, handRaisedAt: !p.handRaised ? Date.now() : null }
          : p
      ),
    })),
  sendChatMessage: (text) =>
    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        {
          id: String(Date.now()),
          sender: 'You',
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isOwn: true,
        },
      ],
    })),
  sendReaction: (emoji, participantId) =>
    set((s) => ({
      reactions: [
        ...s.reactions,
        { id: String(Date.now()) + Math.random(), emoji, participantId, createdAt: Date.now() },
      ],
    })),
  removeReaction: (reactionId) =>
    set((s) => ({ reactions: s.reactions.filter((r) => r.id !== reactionId) })),
  setSelectedLanguage: (selectedLanguage) => set({ selectedLanguage }),
  setSelectedAudioInput: (selectedAudioInput) => set({ selectedAudioInput }),
  setSelectedAudioOutput: (selectedAudioOutput) => set({ selectedAudioOutput }),
  setSelectedVideoInput: (selectedVideoInput) => set({ selectedVideoInput }),
  setSelectedAiModel: (selectedAiModel) => set({ selectedAiModel }),
  setSelectedBackground: (selectedBackground) => set({ selectedBackground }),
  dismissSummary: () => set({ showSummary: false, summaryPoints: [] }),
  toggleBreakoutRooms: () => set((s) => ({ showBreakoutRooms: !s.showBreakoutRooms })),
  toggleInvite: () => set((s) => ({ showInvite: !s.showInvite })),
  toggleControlBarCollapsed: () => set((s) => ({ isControlBarCollapsed: !s.isControlBarCollapsed })),
  togglePerfHud: () => set((s) => ({ showPerfHud: !s.showPerfHud })),
  setPendingJoinRequestId: (pendingJoinRequestId) => set({ pendingJoinRequestId }),
  setAiLatencyMs: (aiLatencyMs) => set({ aiLatencyMs }),
  setBreakoutRooms: (breakoutRooms) => set({ breakoutRooms }),
  startBreakoutSession: () => set({ breakoutActive: true, showBreakoutRooms: false }),
  endBreakoutSession: () => set({ breakoutActive: false, breakoutRooms: [], showBreakoutRooms: false }),
  joinMeeting: () =>
    set((s) => ({
      screen: 'connecting',
      meetingJoinedAt: Date.now(),
      meetingSessionId: crypto.randomUUID(),
      participants: [createLocalParticipant(s.userName || 'You')],
    })),
  joinExistingMeeting: (meetingId, userName) => {
    set({
      meetingId,
      userName,
      screen: 'connecting',
      meetingJoinedAt: Date.now(),
      meetingSessionId: crypto.randomUUID(),
      participants: [createLocalParticipant(userName || 'You')],
    });
    // Play join sound
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  },
  addSimulatedParticipant: (name) =>
    set((s) => {
      // Play notification sound
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.setValueAtTime(900, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } catch {}
      const newId = `p-${Date.now()}`;
      return {
        participants: [
          ...s.participants,
          {
            id: newId,
            name,
            isMuted: false,
            isCameraOn: true,
            isSpeaking: false,
            hasMouseControl: false,
            mouseControlRequested: false,
            handRaised: false,
            handRaisedAt: null,
            avatar: name.split(' ').map((n: string) => n[0]).join(''),
            spokenLanguage: 'en',
          },
        ],
      };
    }),
  leaveMeeting: () => {
    // Clear meeting URL param so user is not auto-rejoined on return to lobby
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('meeting')) {
          url.searchParams.delete('meeting');
          window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
        }
      } catch {}
    }
    set({
      screen: 'lobby',
      meetingId: '',
      meetingSessionId: '',
      isScreenSharing: false,
      isRecording: false,
      recordingStartTime: null,
      meetingJoinedAt: null,
      isControlBarCollapsed: false,
      rightPanel: 'ai',
      reactions: [],
      breakoutActive: false,
      breakoutRooms: [],
      showSummary: false,
      summaryPoints: [],
    });
  },
}));

useMeetingStore.subscribe((state) => {
  persistMeetingState(state);
});
