import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore, type LocalMediaStatus } from '@/store/meetingStore';
import { createNoiseCancelledStream } from '@/lib/audio/noiseCancellation';
import { toast } from 'sonner';
import { logWebRTCEvent } from '@/lib/webrtcLogger';
import { requestMeetingMedia, takePreflightStream, type MediaErrorReason } from '@/lib/mediaPreflight';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

interface PeerConnection {
  pc: RTCPeerConnection;
  peerId: string;
}

export interface PeerDiagnostic {
  peerId: string;
  connectionState: RTCPeerConnectionState;
  iceState: RTCIceConnectionState;
  hasAudio: boolean;
  audioMuted: boolean;
  audioEnabled: boolean;
  audioLive: boolean;
  hasVideo: boolean;
  videoLive: boolean;
  retries: number;
}

export interface LocalDeviceSelection {
  audioDeviceId?: string;
  videoDeviceId?: string;
  facingMode?: 'user' | 'environment';
}

type MediaKind = 'audio' | 'video';

const LOCAL_MEDIA_MAX_RETRIES = 5;
const PEER_RESTART_MAX_RETRIES = 4;

function backoffDelay(attempt: number, base = 1000, max = 15000) {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

function reasonCode(prefix: string, reason?: MediaErrorReason | string) {
  return reason ? `${prefix}:${reason}` : prefix;
}

export function useWebRTC(meetingId: string, isInMeeting: boolean) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawLocalStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const noiseCancellationCleanupRef = useRef<(() => void) | null>(null);
  const mediaAcquireInFlightRef = useRef(false);
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const retryStateRef = useRef<Map<string, { count: number; timer: ReturnType<typeof setTimeout> | null }>>(new Map());
  const peerRestartStateRef = useRef<Map<string, { count: number; timer: ReturnType<typeof setTimeout> | null }>>(new Map());
  const localMediaRetryTimersRef = useRef<{ audio: ReturnType<typeof setTimeout> | null; video: ReturnType<typeof setTimeout> | null }>({ audio: null, video: null });
  const localMediaRetryAttemptsRef = useRef<{ audio: number; video: number }>({ audio: 0, video: 0 });
  const selectedDevicesRef = useRef<LocalDeviceSelection>({ facingMode: 'user' });
  const acquireMissingLocalMediaRef = useRef<(needsAudio: boolean, needsVideo: boolean, selection?: LocalDeviceSelection, reason?: string) => void>(() => {});
  const myPeerIdRef = useRef<string>(crypto.randomUUID());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const {
    isMicOn,
    isCameraOn,
    isScreenSharing,
    toggleScreenShare,
    isNoiseCancellationOn,
    meetingSessionId,
    selectedAudioInput,
    selectedVideoInput,
    setSelfCapture,
    setMicOn,
    setCameraOn,
    setSelectedAudioInput,
    setSelectedVideoInput,
    setLocalMediaStatus,
    setLastRenegotiationAt,
  } = useMeetingStore();

  useEffect(() => {
    selectedDevicesRef.current = {
      audioDeviceId: selectedAudioInput,
      videoDeviceId: selectedVideoInput,
      facingMode: selectedDevicesRef.current.facingMode ?? 'user',
    };
  }, [selectedAudioInput, selectedVideoInput]);

  const updateLocalMediaStatusFromStream = useCallback((stream: MediaStream | null, extra?: { retryAttempt?: number; errorCode?: string | null }) => {
    const { isMicOn: micEnabled, isCameraOn: cameraEnabled } = useMeetingStore.getState();
    const audioTrack = stream?.getAudioTracks().find((track) => track.readyState === 'live') ?? null;
    const videoTrack = stream?.getVideoTracks().find((track) => track.readyState === 'live') ?? null;
    setLocalMediaStatus({
      audio: !micEnabled ? 'off' : audioTrack ? 'ok' : 'missing',
      video: !cameraEnabled ? 'off' : videoTrack ? 'ok' : 'missing',
      audioLabel: !micEnabled ? 'Microphone off' : audioTrack?.label || 'Microphone not connected',
      videoLabel: !cameraEnabled ? 'Camera off' : videoTrack?.label || 'Camera not connected',
      lastErrorCode: extra?.errorCode ?? null,
      retryAttempt: extra?.retryAttempt ?? 0,
    });
  }, [setLocalMediaStatus]);

  const ensurePresenceReady = useCallback(async () => {
    if (!meetingId || !meetingSessionId) return false;

    const db = supabase as typeof supabase & {
      from: (table: string) => {
        select: (columns: string, options?: { head?: boolean; count?: 'exact' }) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<{ count: number | null; error: unknown }>;
          };
        };
      };
    };

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { count, error } = await db
        .from('meeting_presence')
        .select('id', { head: true, count: 'exact' })
        .eq('meeting_code', meetingId)
        .eq('session_id', meetingSessionId);

      if (!error && (count ?? 0) > 0) {
        logWebRTCEvent('presence', 'ready-for-signaling', { attempt });
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    logWebRTCEvent('presence', 'signaling-started-before-presence-confirmed');
    return true;
  }, [meetingId, meetingSessionId]);

  // Unique capture-handle so we can detect if the user picks the meeting tab itself
  const captureHandleRef = useRef<string>(`zoom-connect-${myPeerIdRef.current}`);
  useEffect(() => {
    captureHandleRef.current = `zoom-connect-${myPeerIdRef.current}`;
    try {
      (navigator.mediaDevices as MediaDevices & {
        setCaptureHandleConfig?: (cfg: {
          handle: string;
          exposeOrigin?: boolean;
          permittedOrigins?: string[];
        }) => void;
      }).setCaptureHandleConfig?.({
        handle: captureHandleRef.current,
        exposeOrigin: true,
        permittedOrigins: ['*'],
      });
    } catch {
      /* not supported – runtime fallback still works via displaySurface */
    }
  }, [meetingSessionId]);

  useEffect(() => {
    if (meetingSessionId) {
      myPeerIdRef.current = meetingSessionId;
    }
  }, [meetingSessionId]);

  const getPeerStats = useCallback(async () => {
    const result = { fps: 0, packetLossPct: 0, rtt: 0, peers: 0 };
    let fpsCount = 0;
    let lossCount = 0;
    let lossSum = 0;
    let rttCount = 0;
    let rttSum = 0;
    for (const [, peer] of peersRef.current) {
      result.peers++;
      try {
        const stats = await peer.pc.getStats();
        let packetsLost = 0;
        let packetsReceived = 0;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (typeof report.framesPerSecond === 'number') {
              result.fps += report.framesPerSecond;
              fpsCount++;
            }
            if (typeof report.packetsLost === 'number') packetsLost += report.packetsLost;
            if (typeof report.packetsReceived === 'number') packetsReceived += report.packetsReceived;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
            rttSum += report.currentRoundTripTime * 1000;
            rttCount++;
          }
        });
        const total = packetsLost + packetsReceived;
        if (total > 0) {
          lossSum += (packetsLost / total) * 100;
          lossCount++;
        }
      } catch {
        // ignore
      }
    }
    if (fpsCount > 0) result.fps = result.fps / fpsCount;
    if (lossCount > 0) result.packetLossPct = lossSum / lossCount;
    if (rttCount > 0) result.rtt = rttSum / rttCount;
    return result;
  }, []);

  const getPeerDiagnostics = useCallback((): PeerDiagnostic[] => {
    const list: PeerDiagnostic[] = [];
    peersRef.current.forEach((peer, id) => {
      const receivers = peer.pc.getReceivers();
      const audioReceiver = receivers.find((r) => r.track?.kind === 'audio');
      const videoReceivers = receivers.filter((r) => r.track?.kind === 'video');
      const audioTrack = audioReceiver?.track ?? null;
      const videoTrack = videoReceivers[0]?.track ?? null;
      list.push({
        peerId: id,
        connectionState: peer.pc.connectionState,
        iceState: peer.pc.iceConnectionState,
        hasAudio: !!audioTrack,
        audioMuted: audioTrack ? audioTrack.muted : true,
        audioEnabled: audioTrack ? audioTrack.enabled : false,
        audioLive: audioTrack ? audioTrack.readyState === 'live' : false,
        hasVideo: !!videoTrack,
        videoLive: videoTrack ? videoTrack.readyState === 'live' : false,
        retries: retryStateRef.current.get(id)?.count ?? 0,
      });
    });
    return list;
  }, []);

  const isLikelyScreenTrack = useCallback((track: MediaStreamTrack | null | undefined) => {
    if (!track || track.kind !== 'video') return false;
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
    const label = track.label.toLowerCase();
    return settings.displaySurface !== undefined || /screen|window|tab/.test(label);
  }, []);

  const updateRemoteStreams = useCallback(() => {
    const streams = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, id) => {
      const receivers = peer.pc.getReceivers();
      if (receivers.length > 0) {
        const stream = new MediaStream();
        receivers.forEach((r) => {
          if (r.track && !isLikelyScreenTrack(r.track)) stream.addTrack(r.track);
        });
        if (stream.getTracks().length > 0) {
          streams.set(id, stream);
        }
      }
    });
    setRemoteStreams(new Map(streams));
  }, [isLikelyScreenTrack]);

  const isPolitePeer = useCallback((peerId: string) => {
    return myPeerIdRef.current.localeCompare(peerId) > 0;
  }, []);

  // Schedule a re-subscribe / renegotiation if inbound tracks don't arrive.
  const scheduleTrackRetryRef = useRef<(peerId: string) => void>(() => {});
  const schedulePeerRestartRef = useRef<(peerId: string, reason: string) => void>(() => {});

  const createPeerConnection = useCallback(
    (peerId: string): RTCPeerConnection => {
      const existing = peersRef.current.get(peerId);
      if (existing && existing.pc.connectionState !== 'closed') {
        return existing.pc;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);

      const localStream = localStreamRef.current;
      const localAudioTracks = localStream?.getAudioTracks() ?? [];
      const localVideoTracks = localStream?.getVideoTracks() ?? [];

      // Add local camera/mic tracks when available. If the phone joins before
      // media is ready (or joins anyway), add receive-only transceivers so the
      // peer connection still negotiates incoming host/member audio and video.
      localAudioTracks.forEach((track) => {
        if (localStream) pc.addTrack(track, localStream);
      });
      localVideoTracks.forEach((track) => {
        if (localStream) pc.addTrack(track, localStream);
      });
      if (localAudioTracks.length === 0) pc.addTransceiver('audio', { direction: 'recvonly' });
      if (localVideoTracks.length === 0) pc.addTransceiver('video', { direction: 'recvonly' });

      // Add screen share tracks if active
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          const screenStream = screenStreamRef.current;
          if (screenStream) pc.addTrack(track, screenStream);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && channelRef.current) {
          logWebRTCEvent('ice', 'local-candidate', { type: event.candidate.type }, peerId);
          channelRef.current.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: {
              candidate: event.candidate.toJSON(),
              from: myPeerIdRef.current,
              to: peerId,
            },
          });
        }
      };

      pc.ontrack = (event) => {
        const track = event.track;
        const incomingStream = event.streams[0];
        logWebRTCEvent(
          'track',
          'remote-track',
          { kind: track.kind, muted: track.muted, enabled: track.enabled, readyState: track.readyState },
          peerId,
        );
        const videoReceiverCount = pc
          .getReceivers()
          .filter((receiver) => receiver.track?.kind === 'video').length;

        if (incomingStream && (videoReceiverCount > 1 || isLikelyScreenTrack(track))) {
          setRemoteScreenStream(incomingStream);
          track.addEventListener('ended', () => setRemoteScreenStream((current) => (current === incomingStream ? null : current)));
        }
        track.addEventListener('mute', () =>
          logWebRTCEvent('track', 'remote-track-muted', { kind: track.kind }, peerId),
        );
        track.addEventListener('unmute', () => {
          logWebRTCEvent('track', 'remote-track-unmuted', { kind: track.kind }, peerId);
          updateRemoteStreams();
        });
        track.addEventListener('ended', () => {
          logWebRTCEvent('track', 'remote-track-ended', { kind: track.kind }, peerId);
          updateRemoteStreams();
        });
        updateRemoteStreams();
      };

      pc.onconnectionstatechange = () => {
        logWebRTCEvent('peer', 'connection-state', { state: pc.connectionState }, peerId);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          schedulePeerRestartRef.current(peerId, `connection-${pc.connectionState}`);
        } else if (pc.connectionState === 'connected') {
          // Verify tracks arrived; if not, kick a retry.
          const restart = peerRestartStateRef.current.get(peerId);
          if (restart?.timer) clearTimeout(restart.timer);
          peerRestartStateRef.current.delete(peerId);
          scheduleTrackRetryRef.current(peerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        logWebRTCEvent('ice', 'state', { state: pc.iceConnectionState }, peerId);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          schedulePeerRestartRef.current(peerId, `ice-${pc.iceConnectionState}`);
        }
      };

      peersRef.current.set(peerId, { pc, peerId });
      logWebRTCEvent('peer', 'created', undefined, peerId);
      scheduleTrackRetryRef.current(peerId);
      return pc;
    },
    [isLikelyScreenTrack, updateRemoteStreams]
  );

  const handleOffer = useCallback(
    async (from: string, offer: RTCSessionDescriptionInit) => {
      const pc = createPeerConnection(from);
      const offerCollision = makingOfferRef.current.get(from) || pc.signalingState !== 'stable';

      if (offerCollision && !isPolitePeer(from)) {
        return;
      }

      if (offerCollision && pc.signalingState !== 'stable') {
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch {
          return;
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      setLastRenegotiationAt();

      logWebRTCEvent('signal', 'send-answer', undefined, from);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'answer',
        payload: {
          answer: answer,
          from: myPeerIdRef.current,
          to: from,
        },
      });
    },
    [createPeerConnection, isPolitePeer, setLastRenegotiationAt]
  );

  const handleAnswer = useCallback(
    async (from: string, answer: RTCSessionDescriptionInit) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        setLastRenegotiationAt();
      }
    },
    [setLastRenegotiationAt]
  );

  const handleIceCandidate = useCallback(
    async (from: string, candidate: RTCIceCandidateInit) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('Failed to add ICE candidate', e);
        }
      }
    },
    []
  );

  const sendOfferToPeer = useCallback(
    async (peerId: string) => {
      const pc = createPeerConnection(peerId);

      if (pc.signalingState !== 'stable') {
        return;
      }

      makingOfferRef.current.set(peerId, true);

      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') {
          return;
        }

        await pc.setLocalDescription(offer);
        setLastRenegotiationAt();

        logWebRTCEvent('signal', 'send-offer', undefined, peerId);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'offer',
          payload: {
            offer,
            from: myPeerIdRef.current,
            to: peerId,
          },
        });
      } finally {
        makingOfferRef.current.set(peerId, false);
      }
    },
    [createPeerConnection, setLastRenegotiationAt]
  );

  // Auto-retry / resubscribe: if inbound audio+video haven't arrived within
  // 1.5s after a peer becomes known, renegotiate. Retries up to 3 times.
  const scheduleTrackRetry = useCallback(
    (peerId: string) => {
      const existing = retryStateRef.current.get(peerId);
      if (existing?.timer) clearTimeout(existing.timer);
      const state = existing ?? { count: 0, timer: null };
      state.timer = setTimeout(() => {
        const peer = peersRef.current.get(peerId);
        if (!peer) return;
        const receivers = peer.pc.getReceivers();
        const hasAudio = receivers.some((r) => r.track?.kind === 'audio' && r.track.readyState === 'live');
        const hasVideo = receivers.some((r) => r.track?.kind === 'video' && r.track.readyState === 'live');
        if (hasAudio && hasVideo) {
          logWebRTCEvent('retry', 'tracks-ok', { hasAudio, hasVideo }, peerId);
          return;
        }
        if (state.count >= 3) {
          logWebRTCEvent('retry', 'give-up', { hasAudio, hasVideo }, peerId);
          return;
        }
        state.count += 1;
        logWebRTCEvent('retry', 'resubscribe', { attempt: state.count, hasAudio, hasVideo }, peerId);
        // Ensure local tracks are attached and renegotiate.
        if (localStreamRef.current) {
          const senders = peer.pc.getSenders();
          localStreamRef.current.getTracks().forEach((track) => {
            if (!senders.some((s) => s.track === track)) {
              try {
                const localStream = localStreamRef.current;
                if (localStream) peer.pc.addTrack(track, localStream);
              } catch {
                /* ignore */
              }
            }
          });
        }
        void sendOfferToPeer(peerId);
        // Schedule next check.
        scheduleTrackRetry(peerId);
      }, 1500);
      retryStateRef.current.set(peerId, state);
    },
    [sendOfferToPeer],
  );

  useEffect(() => {
    scheduleTrackRetryRef.current = scheduleTrackRetry;
  }, [scheduleTrackRetry]);

  const schedulePeerRestart = useCallback((peerId: string, reason: string) => {
    const existing = peerRestartStateRef.current.get(peerId);
    if (existing?.timer) clearTimeout(existing.timer);

    const state = existing ?? { count: 0, timer: null };
    if (state.count >= PEER_RESTART_MAX_RETRIES) {
      logWebRTCEvent('retry', 'peer-restart-give-up', { reason, attempts: state.count }, peerId);
      return;
    }

    state.count += 1;
    const delay = backoffDelay(state.count, 800, 8000);
    logWebRTCEvent('retry', 'peer-restart-scheduled', { reason, attempt: state.count, delay }, peerId);

    state.timer = setTimeout(() => {
      const current = peersRef.current.get(peerId);
      logWebRTCEvent('retry', 'peer-restart-run', { reason, attempt: state.count }, peerId);

      if (current) {
        try {
          current.pc.getSenders().forEach((sender) => {
            try { current.pc.removeTrack(sender); } catch { /* sender may already be detached */ }
          });
          current.pc.close();
        } catch {
          /* ignore closed peer */
        }
      }

      peersRef.current.delete(peerId);
      retryStateRef.current.delete(peerId);
      makingOfferRef.current.delete(peerId);
      updateRemoteStreams();
      void sendOfferToPeer(peerId);
    }, delay);

    peerRestartStateRef.current.set(peerId, state);
  }, [sendOfferToPeer, updateRemoteStreams]);

  useEffect(() => {
    schedulePeerRestartRef.current = schedulePeerRestart;
  }, [schedulePeerRestart]);

  // Start screen sharing
  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        // Chromium hints — hide the meeting tab from the picker where supported.
        // Cast because these are not yet in the ambient DOM lib.
        ...({ selfBrowserSurface: 'exclude', surfaceSwitching: 'include' } as Record<string, string>),
      } as DisplayMediaStreamOptions);

      // --- Recursive-mirror (self-capture) detection ---
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings?.() as MediaTrackSettings & { displaySurface?: string };
      const handle = (videoTrack as MediaStreamTrack & {
        getCaptureHandle?: () => { handle?: string; origin?: string } | null;
      })?.getCaptureHandle?.();
      const selfByHandle = !!handle?.handle && handle.handle === captureHandleRef.current;
      const selfByOrigin =
        !!handle?.origin && typeof window !== 'undefined' && handle.origin === window.location.origin;
      // Best-effort: if displaySurface is 'browser' we still can't be certain it's
      // *this* tab, but combined with a matching handle it's conclusive.
      const selfCapture = selfByHandle || (settings?.displaySurface === 'browser' && selfByOrigin);

      setSelfCapture(selfCapture);
      if (selfCapture) {
        toast.warning(
          "You're sharing the meeting window. This may create a recursive screen effect. Consider sharing another window or your entire screen.",
          { duration: 8000 }
        );
      }

      // Mute local playback of screen share audio to prevent feedback loop
      stream.getAudioTracks().forEach((track) => {
        // The track is still sent to peers, but we prevent local echo
        const clonedTrack = track.clone();
        clonedTrack.enabled = true;
        // Replace the original audio track with a cloned one for peers
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);

      // Add screen tracks to all existing peer connections
      peersRef.current.forEach((peer) => {
        stream.getTracks().forEach((track) => {
          peer.pc.addTrack(track, stream);
        });
      });

      // Renegotiate with all peers
      peersRef.current.forEach((peer) => {
        sendOfferToPeer(peer.peerId);
      });

      // Listen for the user stopping via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
        const store = useMeetingStore.getState();
        if (store.isScreenSharing) {
          toggleScreenShare();
        }
      };
    } catch (err) {
      console.warn('Screen share cancelled or failed:', err);
      const store = useMeetingStore.getState();
      if (store.isScreenSharing) {
        toggleScreenShare();
      }
    }
  }, [sendOfferToPeer, toggleScreenShare]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());

      // Remove screen tracks from all peer connections
      peersRef.current.forEach((peer) => {
        const senders = peer.pc.getSenders();
        senders.forEach((sender) => {
          if (sender.track && screenStreamRef.current?.getTracks().includes(sender.track)) {
            peer.pc.removeTrack(sender);
          }
        });
      });

      screenStreamRef.current = null;
      setScreenStream(null);
      setSelfCapture(false);

      // Renegotiate
      peersRef.current.forEach((peer) => {
        sendOfferToPeer(peer.peerId);
      });
    }
  }, [sendOfferToPeer]);

  // Sync screen sharing toggle from store
  useEffect(() => {
    if (!isInMeeting) return;
    if (isScreenSharing && !screenStreamRef.current) {
      startScreenShare();
    } else if (!isScreenSharing && screenStreamRef.current) {
      stopScreenShare();
    }
  }, [isScreenSharing, isInMeeting, startScreenShare, stopScreenShare]);

  const applyProcessedLocalStream = useCallback((nextStream: MediaStream) => {
    const previousStream = localStreamRef.current;
    localStreamRef.current = nextStream;
    setLocalStream(nextStream);
    updateLocalMediaStatusFromStream(nextStream);

    peersRef.current.forEach((peer) => {
      const senders = peer.pc.getSenders();
      const transceivers = peer.pc.getTransceivers();
      const nextAudioTrack = nextStream.getAudioTracks()[0] ?? null;
      const nextVideoTrack = nextStream.getVideoTracks()[0] ?? null;
      let needsRenegotiation = false;

      senders.forEach((sender) => {
        const transceiver = transceivers.find((t) => t.sender === sender);
        const senderKind = sender.track?.kind ?? transceiver?.receiver.track.kind;
        if (senderKind === 'audio') {
          void sender.replaceTrack(nextAudioTrack).catch((err) => {
            logWebRTCEvent('error', 'replace-audio-track-failed', { reason: String(err) }, peer.peerId);
          });
        }
        if (senderKind === 'video') {
          void sender.replaceTrack(nextVideoTrack).catch((err) => {
            logWebRTCEvent('error', 'replace-video-track-failed', { reason: String(err) }, peer.peerId);
          });
        }
      });

      if (nextAudioTrack && !senders.some((sender) => sender.track?.kind === 'audio')) {
        const recvOnlyAudio = transceivers.find((transceiver) =>
          transceiver.receiver.track.kind === 'audio' && !transceiver.sender.track
        );
        if (recvOnlyAudio) {
          recvOnlyAudio.direction = 'sendrecv';
          void recvOnlyAudio.sender.replaceTrack(nextAudioTrack);
        } else {
          peer.pc.addTrack(nextAudioTrack, nextStream);
        }
        needsRenegotiation = true;
      }

      if (nextVideoTrack && !senders.some((sender) => sender.track?.kind === 'video')) {
        const recvOnlyVideo = transceivers.find((transceiver) =>
          transceiver.receiver.track.kind === 'video' && !transceiver.sender.track
        );
        if (recvOnlyVideo) {
          recvOnlyVideo.direction = 'sendrecv';
          void recvOnlyVideo.sender.replaceTrack(nextVideoTrack);
        } else {
          peer.pc.addTrack(nextVideoTrack, nextStream);
        }
        needsRenegotiation = true;
      }

      if (needsRenegotiation) {
        void sendOfferToPeer(peer.peerId);
      }
    });

    if (previousStream && previousStream !== nextStream && previousStream !== rawLocalStreamRef.current) {
      previousStream.getTracks().forEach((track) => track.stop());
    }
  }, [sendOfferToPeer, updateLocalMediaStatusFromStream]);

  const wireLocalTrackDiagnostics = useCallback((track: MediaStreamTrack) => {
    const kind = track.kind as MediaKind;
    const onEnded = () => {
      const code = reasonCode(`${kind}-track-ended`);
      logWebRTCEvent('media', 'local-track-ended', { kind, label: track.label, code });
      setLocalMediaStatus({
        [kind]: 'missing',
        [`${kind}Label`]: `${kind === 'audio' ? 'Microphone' : 'Camera'} stopped`,
        lastErrorCode: code,
      } as Partial<LocalMediaStatus>);
      acquireMissingLocalMediaRef.current(kind === 'audio', kind === 'video', undefined, code);
    };
    const onMute = () => {
      logWebRTCEvent('media', 'local-track-muted', { kind, label: track.label });
    };
    const onUnmute = () => {
      logWebRTCEvent('media', 'local-track-unmuted', { kind, label: track.label });
      updateLocalMediaStatusFromStream(rawLocalStreamRef.current);
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
  }, [setLocalMediaStatus, updateLocalMediaStatusFromStream]);

  const mergeRawLocalTracks = useCallback((incomingStream: MediaStream, replaceKinds: MediaKind[] = []) => {
    const current = rawLocalStreamRef.current;

    if (!current) {
      incomingStream.getTracks().forEach(wireLocalTrackDiagnostics);
      rawLocalStreamRef.current = incomingStream;
      applyProcessedLocalStream(incomingStream);
      return;
    }

    incomingStream.getTracks().forEach((track) => {
      if (replaceKinds.includes(track.kind as MediaKind)) {
        current.getTracks()
          .filter((existing) => existing.kind === track.kind)
          .forEach((existing) => {
            current.removeTrack(existing);
            existing.stop();
          });
      }
      const existingSameKind = current.getTracks().find((existing) => existing.kind === track.kind && existing.readyState === 'live');
      if (existingSameKind) {
        track.stop();
        return;
      }

      track.enabled = track.kind === 'audio' ? useMeetingStore.getState().isMicOn : useMeetingStore.getState().isCameraOn;
      wireLocalTrackDiagnostics(track);
      current.addTrack(track);
    });

    applyProcessedLocalStream(current);
  }, [applyProcessedLocalStream, wireLocalTrackDiagnostics]);

  const clearLocalRetryTimer = useCallback((kind: MediaKind) => {
    const timer = localMediaRetryTimersRef.current[kind];
    if (timer) clearTimeout(timer);
    localMediaRetryTimersRef.current[kind] = null;
    localMediaRetryAttemptsRef.current[kind] = 0;
  }, []);

  const scheduleLocalMediaRetry = useCallback((kind: MediaKind, reason: string, selection?: LocalDeviceSelection) => {
    if (!isInMeeting) return;
    const attempt = localMediaRetryAttemptsRef.current[kind] + 1;
    if (attempt > LOCAL_MEDIA_MAX_RETRIES) {
      const code = reasonCode(`${kind}-retry-give-up`, reason);
      logWebRTCEvent('media', 'local-retry-give-up', { kind, reason, attempts: attempt - 1, code });
      setLocalMediaStatus({
        [kind]: 'blocked',
        [`${kind}Label`]: `${kind === 'audio' ? 'Microphone' : 'Camera'} needs device selection`,
        lastErrorCode: code,
        retryAttempt: attempt - 1,
      } as Partial<LocalMediaStatus>);
      return;
    }

    const delay = backoffDelay(attempt);
    const existing = localMediaRetryTimersRef.current[kind];
    if (existing) clearTimeout(existing);
    localMediaRetryAttemptsRef.current[kind] = attempt;
    logWebRTCEvent('media', 'local-retry-scheduled', { kind, reason, attempt, delay });
    setLocalMediaStatus({
      [kind]: 'retrying',
      [`${kind}Label`]: `${kind === 'audio' ? 'Microphone' : 'Camera'} retrying…`,
      lastErrorCode: reasonCode(`${kind}-retry`, reason),
      retryAttempt: attempt,
    } as Partial<LocalMediaStatus>);

    localMediaRetryTimersRef.current[kind] = setTimeout(() => {
      acquireMissingLocalMediaRef.current(kind === 'audio', kind === 'video', selection, `retry-${reason}`);
    }, delay);
  }, [isInMeeting, setLocalMediaStatus]);

  const acquireMissingLocalMedia = useCallback(async (
    needsAudio: boolean,
    needsVideo: boolean,
    selection: LocalDeviceSelection = selectedDevicesRef.current,
    requestReason = 'missing-track',
  ) => {
    if (!isInMeeting || (!needsAudio && !needsVideo)) return;
    if (mediaAcquireInFlightRef.current) {
      logWebRTCEvent('media', 'local-acquire-skipped-inflight', { needsAudio, needsVideo, requestReason });
      return;
    }

    mediaAcquireInFlightRef.current = true;
    try {
      const audioDeviceId = selection.audioDeviceId ?? selectedDevicesRef.current.audioDeviceId;
      const videoDeviceId = selection.videoDeviceId ?? selectedDevicesRef.current.videoDeviceId;
      const facingMode = selection.facingMode ?? selectedDevicesRef.current.facingMode ?? 'user';
      selectedDevicesRef.current = { audioDeviceId, videoDeviceId, facingMode };

      if (selection.audioDeviceId) setSelectedAudioInput(selection.audioDeviceId);
      if (selection.videoDeviceId) setSelectedVideoInput(selection.videoDeviceId);

      logWebRTCEvent('media', 'local-acquire-start', { needsAudio, needsVideo, requestReason, audioDeviceId, videoDeviceId, facingMode });
      const result = await requestMeetingMedia({
        audio: needsAudio,
        video: needsVideo,
        preferCombined: needsAudio && needsVideo,
        audioDeviceId,
        videoDeviceId,
        facingMode,
      });
      if (result.stream) {
        const replaceKinds: MediaKind[] = [];
        if (needsAudio && (selection.audioDeviceId || requestReason === 'device-selected')) replaceKinds.push('audio');
        if (needsVideo && (selection.videoDeviceId || selection.facingMode || requestReason === 'device-selected')) replaceKinds.push('video');
        mergeRawLocalTracks(result.stream, replaceKinds);
      }

      if (needsAudio && result.mic === 'granted') {
        clearLocalRetryTimer('audio');
        setMicOn(true);
      }
      if (needsVideo && result.camera === 'granted') {
        clearLocalRetryTimer('video');
        setCameraOn(true);
      }

      const audioOk = !needsAudio || result.mic === 'granted';
      const videoOk = !needsVideo || result.camera === 'granted';
      const lastErrorCode = [
        needsAudio && result.mic !== 'granted' ? reasonCode('audio-acquire-failed', result.micReason) : null,
        needsVideo && result.camera !== 'granted' ? reasonCode('video-acquire-failed', result.cameraReason) : null,
      ].filter(Boolean).join('|') || null;

      setLocalMediaStatus({
        audio: needsAudio ? (result.mic === 'granted' ? 'ok' : 'retrying') : undefined,
        video: needsVideo ? (result.camera === 'granted' ? 'ok' : 'retrying') : undefined,
        audioLabel: needsAudio ? result.micLabel : undefined,
        videoLabel: needsVideo ? result.cameraLabel : undefined,
        lastErrorCode,
      });

      logWebRTCEvent('media', 'local-acquire-result', {
        mic: result.mic,
        camera: result.camera,
        micReason: result.micReason,
        cameraReason: result.cameraReason,
        lastErrorCode,
      });

      if (audioOk && videoOk) {
        toast.success('Camera/microphone connected');
      } else {
        if (needsAudio && result.mic !== 'granted') scheduleLocalMediaRetry('audio', result.micReason ?? 'unknown-error', { audioDeviceId, facingMode });
        if (needsVideo && result.camera !== 'granted') scheduleLocalMediaRetry('video', result.cameraReason ?? 'unknown-error', { videoDeviceId, facingMode });
        toast.error('Device connection failed — retrying automatically');
      }
    } finally {
      mediaAcquireInFlightRef.current = false;
    }
  }, [clearLocalRetryTimer, isInMeeting, mergeRawLocalTracks, scheduleLocalMediaRetry, setCameraOn, setLocalMediaStatus, setMicOn, setSelectedAudioInput, setSelectedVideoInput]);

  useEffect(() => {
    acquireMissingLocalMediaRef.current = (needsAudio, needsVideo, selection, reason) => {
      void acquireMissingLocalMedia(needsAudio, needsVideo, selection, reason);
    };
  }, [acquireMissingLocalMedia]);

  const selectLocalDevices = useCallback((selection: LocalDeviceSelection) => {
    selectedDevicesRef.current = { ...selectedDevicesRef.current, ...selection };
    void acquireMissingLocalMedia(!!selection.audioDeviceId, !!selection.videoDeviceId || !!selection.facingMode, selection, 'device-selected');
  }, [acquireMissingLocalMedia]);

  useEffect(() => {
    const rawStream = rawLocalStreamRef.current;
    if (!rawStream) return;

    noiseCancellationCleanupRef.current?.();
    noiseCancellationCleanupRef.current = null;

    if (!isNoiseCancellationOn) {
      applyProcessedLocalStream(rawStream);
      return;
    }

    const { stream, cleanup } = createNoiseCancelledStream(rawStream);
    noiseCancellationCleanupRef.current = cleanup;
    applyProcessedLocalStream(stream);

    return () => {
      cleanup();
      if (noiseCancellationCleanupRef.current === cleanup) {
        noiseCancellationCleanupRef.current = null;
      }
    };
  }, [applyProcessedLocalStream, isNoiseCancellationOn]);

  // Get local media
  useEffect(() => {
    if (!isInMeeting) return;

    let cancelled = false;

    async function startMedia() {
      // Reuse the stream already granted during the pre-join device check.
      const preflight = takePreflightStream();
      if (preflight) {
        if (cancelled) {
          preflight.getTracks().forEach((t) => t.stop());
          return;
        }
        mergeRawLocalTracks(preflight);
        updateLocalMediaStatusFromStream(preflight);
        if (preflight.getAudioTracks().some((track) => track.readyState === 'live')) setMicOn(true);
        if (preflight.getVideoTracks().some((track) => track.readyState === 'live')) setCameraOn(true);
        return;
      }

      const wantsAudio = useMeetingStore.getState().isMicOn;
      const wantsVideo = useMeetingStore.getState().isCameraOn;
      if (!wantsAudio && !wantsVideo) {
        updateLocalMediaStatusFromStream(null);
        return;
      }

      if (mediaAcquireInFlightRef.current) return;
      mediaAcquireInFlightRef.current = true;
      try {
        const selection = selectedDevicesRef.current;
        const result = await requestMeetingMedia({
          audio: wantsAudio,
          video: wantsVideo,
          preferCombined: true,
          audioDeviceId: selection.audioDeviceId,
          videoDeviceId: selection.videoDeviceId,
          facingMode: selection.facingMode,
        });
        const stream = result.stream;
        if (!stream) {
          const audioCode = reasonCode('audio-initial-failed', result.micReason);
          const videoCode = reasonCode('video-initial-failed', result.cameraReason);
          setLocalMediaStatus({
            audio: wantsAudio ? 'retrying' : 'off',
            video: wantsVideo ? 'retrying' : 'off',
            audioLabel: result.micLabel,
            videoLabel: result.cameraLabel,
            lastErrorCode: `${audioCode}|${videoCode}`,
            retryAttempt: 0,
          });
          if (wantsAudio) scheduleLocalMediaRetry('audio', result.micReason ?? 'initial-failed');
          if (wantsVideo) scheduleLocalMediaRetry('video', result.cameraReason ?? 'initial-failed');
          console.warn('No media devices granted for this meeting');
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mergeRawLocalTracks(stream);
        updateLocalMediaStatusFromStream(stream, {
          errorCode: [
            result.mic !== 'granted' ? reasonCode('audio-initial-failed', result.micReason) : null,
            result.camera !== 'granted' ? reasonCode('video-initial-failed', result.cameraReason) : null,
          ].filter(Boolean).join('|') || null,
        });
        if (result.mic === 'granted') setMicOn(true);
        else if (wantsAudio) scheduleLocalMediaRetry('audio', result.micReason ?? 'initial-failed');
        if (result.camera === 'granted') setCameraOn(true);
        else if (wantsVideo) scheduleLocalMediaRetry('video', result.cameraReason ?? 'initial-failed');
      } catch (err) {
        console.error('No media devices available:', err);
        logWebRTCEvent('error', 'initial-media-error', { reason: String(err) });
      } finally {
        mediaAcquireInFlightRef.current = false;
      }
    }

    startMedia();

    return () => {
      cancelled = true;
      noiseCancellationCleanupRef.current?.();
      noiseCancellationCleanupRef.current = null;
      rawLocalStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawLocalStreamRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      // Also stop screen share on cleanup
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      localMediaRetryTimersRef.current.audio && clearTimeout(localMediaRetryTimersRef.current.audio);
      localMediaRetryTimersRef.current.video && clearTimeout(localMediaRetryTimersRef.current.video);
    };
  }, [isInMeeting, mergeRawLocalTracks, scheduleLocalMediaRetry, setCameraOn, setLocalMediaStatus, setMicOn, updateLocalMediaStatusFromStream]);

  // Sync mic/camera toggle to local stream
  useEffect(() => {
    const syncAudioState = (stream: MediaStream | null) => {
      stream?.getAudioTracks().forEach((t) => {
        t.enabled = isMicOn;
      });
    };

    syncAudioState(localStreamRef.current);
    syncAudioState(rawLocalStreamRef.current);
    if (isMicOn) {
      const hasLiveAudio = rawLocalStreamRef.current?.getAudioTracks().some((t) => t.readyState === 'live') ?? false;
      if (!hasLiveAudio) void acquireMissingLocalMedia(true, false);
      else setLocalMediaStatus({ audio: 'ok', audioLabel: rawLocalStreamRef.current?.getAudioTracks()[0]?.label || 'Microphone' });
    } else {
      setLocalMediaStatus({ audio: 'off', audioLabel: 'Microphone off' });
    }
  }, [acquireMissingLocalMedia, isMicOn, setLocalMediaStatus]);

  useEffect(() => {
    const syncVideoState = (stream: MediaStream | null) => {
      stream?.getVideoTracks().forEach((t) => {
        t.enabled = isCameraOn;
      });
    };

    syncVideoState(localStreamRef.current);
    syncVideoState(rawLocalStreamRef.current);
    if (isCameraOn) {
      const hasLiveVideo = rawLocalStreamRef.current?.getVideoTracks().some((t) => t.readyState === 'live') ?? false;
      if (!hasLiveVideo) void acquireMissingLocalMedia(false, true);
      else setLocalMediaStatus({ video: 'ok', videoLabel: rawLocalStreamRef.current?.getVideoTracks()[0]?.label || 'Camera' });
    } else {
      setLocalMediaStatus({ video: 'off', videoLabel: 'Camera off' });
    }
  }, [acquireMissingLocalMedia, isCameraOn, setLocalMediaStatus]);

  // Setup signaling channel
  useEffect(() => {
    if (!isInMeeting || !meetingId || !meetingSessionId) return;

    let cancelled = false;
    let joinTimers: ReturnType<typeof setTimeout>[] = [];
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const sendJoinAnnouncement = () => {
      if (!channel || cancelled) return;
      channel.send({
        type: 'broadcast',
        event: 'join',
        payload: { peerId: myPeerIdRef.current },
      });
      logWebRTCEvent('signal', 'send-join');
    };

    const rerunRenegotiation = (reason: string) => {
      logWebRTCEvent('retry', 'renegotiation-circuit-run', { reason, peers: peersRef.current.size });
      sendJoinAnnouncement();
      peersRef.current.forEach((peer) => {
        schedulePeerRestartRef.current(peer.peerId, reason);
      });
    };

    const onOnline = () => rerunRenegotiation('browser-online');
    const onVisibility = () => {
      if (document.visibilityState === 'visible') rerunRenegotiation('tab-visible');
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    void (async () => {
      const ready = await ensurePresenceReady();
      if (!ready || cancelled) return;

      channel = supabase.channel(`webrtc-${meetingId}`, {
        config: { broadcast: { self: false } },
      });

      channelRef.current = channel;

      channel
        .on('broadcast', { event: 'join' }, ({ payload }) => {
          logWebRTCEvent('signal', 'recv-join', { from: payload.peerId });
          if (payload.peerId !== myPeerIdRef.current) {
            void sendOfferToPeer(payload.peerId);
          }
        })
        .on('broadcast', { event: 'offer' }, ({ payload }) => {
          if (payload.to === myPeerIdRef.current) {
            logWebRTCEvent('signal', 'recv-offer', undefined, payload.from);
            void handleOffer(payload.from, payload.offer);
          }
        })
        .on('broadcast', { event: 'answer' }, ({ payload }) => {
          if (payload.to === myPeerIdRef.current) {
            logWebRTCEvent('signal', 'recv-answer', undefined, payload.from);
            void handleAnswer(payload.from, payload.answer);
          }
        })
        .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
          if (payload.to === myPeerIdRef.current) {
            void handleIceCandidate(payload.from, payload.candidate);
          }
        })
        .on('broadcast', { event: 'leave' }, ({ payload }) => {
          logWebRTCEvent('signal', 'recv-leave', undefined, payload.peerId);
          const peer = peersRef.current.get(payload.peerId);
          if (peer) {
            peer.pc.close();
            peersRef.current.delete(payload.peerId);
            updateRemoteStreams();
            setRemoteScreenStream(null);
          }
        })
        .subscribe((status) => {
          logWebRTCEvent('signal', 'channel-status', { status });
          if (status === 'SUBSCRIBED') {
            sendJoinAnnouncement();
            joinTimers = [700, 1500, 3000].map((delay) => setTimeout(sendJoinAnnouncement, delay));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setTimeout(() => rerunRenegotiation(`channel-${status.toLowerCase()}`), 1000);
          }
        });
    })();

    return () => {
      cancelled = true;
      joinTimers.forEach((timer) => clearTimeout(timer));
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);

      channel?.send({
        type: 'broadcast',
        event: 'leave',
        payload: { peerId: myPeerIdRef.current },
      });

      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();
      makingOfferRef.current.clear();
      retryStateRef.current.forEach((retry) => retry.timer && clearTimeout(retry.timer));
      retryStateRef.current.clear();
      peerRestartStateRef.current.forEach((restart) => restart.timer && clearTimeout(restart.timer));
      peerRestartStateRef.current.clear();
      setRemoteStreams(new Map());
      setRemoteScreenStream(null);

      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [ensurePresenceReady, handleAnswer, handleIceCandidate, handleOffer, isInMeeting, meetingId, meetingSessionId, sendOfferToPeer, updateRemoteStreams]);

  return {
    localStream,
    remoteStreams,
    screenStream,
    remoteScreenStream,
    myPeerId: myPeerIdRef.current,
    getPeerStats,
    getPeerDiagnostics,
    selectLocalDevices,
  };
}
