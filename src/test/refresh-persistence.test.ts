import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'zoom-connect-active-meeting';

const seedSessionStorage = (overrides: Record<string, unknown> = {}) => {
  const snapshot = {
    screen: 'meeting',
    meetingId: 'ZC-111-222-333',
    meetingSessionId: 'sess-abc',
    userName: 'Alice',
    meetingJoinedAt: 1000,
    isMicOn: false,
    isCameraOn: true,
    isNoiseCancellationOn: false,
    selectedBackground: 'blur-light',
    selectedLanguage: 'hi',
    selectedAudioInput: 'default',
    selectedAudioOutput: 'default',
    selectedVideoInput: 'default',
    selectedAiModel: 'whisper-tiny',
    rightPanel: 'chat',
    isControlBarCollapsed: true,
    showPerfHud: true,
    ...overrides,
  };
  window.sessionStorage.setItem(KEY, JSON.stringify(snapshot));
};

describe('meeting store refresh persistence (mobile-safe)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    // Mock crypto.randomUUID for jsdom
    if (!('randomUUID' in crypto)) {
      (crypto as unknown as { randomUUID: () => string }).randomUUID = () =>
        'test-' + Math.random().toString(36).slice(2);
    }
  });

  it('restores meetingId, sessionId, mic/camera, panel and control-bar state after refresh', async () => {
    seedSessionStorage();
    const { useMeetingStore } = await import('@/store/meetingStore');
    const s = useMeetingStore.getState();
    expect(s.screen).toBe('meeting');
    expect(s.meetingId).toBe('ZC-111-222-333');
    expect(s.meetingSessionId).toBe('sess-abc');
    expect(s.userName).toBe('Alice');
    expect(s.isMicOn).toBe(false);
    expect(s.isCameraOn).toBe(true);
    expect(s.rightPanel).toBe('chat');
    expect(s.isControlBarCollapsed).toBe(true);
    expect(s.showPerfHud).toBe(true);
    // Local participant rebuilt with stored userName
    expect(s.participants[0]?.name).toBe('Alice');
  });

  it('persists state changes to sessionStorage so a refresh would survive', async () => {
    seedSessionStorage();
    const { useMeetingStore } = await import('@/store/meetingStore');
    useMeetingStore.getState().toggleMic();
    useMeetingStore.getState().setRightPanel('participants');

    const raw = window.sessionStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.isMicOn).toBe(true); // toggled from false
    expect(parsed.rightPanel).toBe('participants');
  });

  it('clears persisted state when leaving the meeting (no auto-rejoin)', async () => {
    seedSessionStorage();
    const { useMeetingStore } = await import('@/store/meetingStore');
    useMeetingStore.getState().leaveMeeting();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(useMeetingStore.getState().screen).toBe('lobby');
  });

  it('ignores stale persisted state with no meetingId', async () => {
    seedSessionStorage({ meetingId: '' });
    const { useMeetingStore } = await import('@/store/meetingStore');
    expect(useMeetingStore.getState().screen).toBe('lobby');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});