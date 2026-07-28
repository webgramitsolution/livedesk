import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore } from '@/store/meetingStore';
import { createNoiseCancelledStream } from '@/lib/audio/noiseCancellation';
import { toast } from 'sonner';
import { logWebRTCEvent } from '@/lib/webrtcLogger';
import { requestMeetingMedia, takePreflightStream } from '@/lib/mediaPreflight';

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

export function useWebRTC(meetingId: string, isInMeeting: boolean) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawLocalStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const noiseCancellationCleanupRef = useRef<(() => void) | null>(null);
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const retryStateRef = useRef<Map<string, { count: number; timer: ReturnType<typeof setTimeout> | null }>>(new Map());
  const myPeerIdRef = useRef<string>(crypto.randomUUID());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const { isMicOn, isCameraOn, isScreenSharing, toggleScreenShare, isNoiseCancellationOn, meetingSessionId, setSelfCapture } = useMeetingStore();

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
          const retry = retryStateRef.current.get(peerId);
          if (retry?.timer) clearTimeout(retry.timer);
          retryStateRef.current.delete(peerId);
          peersRef.current.delete(peerId);
          makingOfferRef.current.delete(peerId);
          updateRemoteStreams();
        } else if (pc.connectionState === 'connected') {
          // Verify tracks arrived; if not, kick a retry.
          scheduleTrackRetryRef.current(peerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        logWebRTCEvent('ice', 'state', { state: pc.iceConnectionState }, peerId);
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
    [createPeerConnection, isPolitePeer]
  );

  const handleAnswer = useCallback(
    async (from: string, answer: RTCSessionDescriptionInit) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    },
    []
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
    [createPeerConnection]
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

    peersRef.current.forEach((peer) => {
      const senders = peer.pc.getSenders();
      const nextAudioTrack = nextStream.getAudioTracks()[0] ?? null;
      const nextVideoTrack = nextStream.getVideoTracks()[0] ?? null;

      senders.forEach((sender) => {
        if (sender.track?.kind === 'audio') {
          void sender.replaceTrack(nextAudioTrack);
        }
        if (sender.track?.kind === 'video') {
          void sender.replaceTrack(nextVideoTrack);
        }
      });

      if (nextAudioTrack && !senders.some((sender) => sender.track?.kind === 'audio')) {
        peer.pc.addTrack(nextAudioTrack, nextStream);
      }

      if (nextVideoTrack && !senders.some((sender) => sender.track?.kind === 'video')) {
        peer.pc.addTrack(nextVideoTrack, nextStream);
      }
    });

    if (previousStream && previousStream !== nextStream && previousStream !== rawLocalStreamRef.current) {
      previousStream.getTracks().forEach((track) => track.stop());
    }
  }, []);

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
        rawLocalStreamRef.current = preflight;
        applyProcessedLocalStream(preflight);
        return;
      }
      try {
        const result = await requestMeetingMedia();
        const stream = result.stream;
        if (!stream) {
          console.warn('No media devices granted for this meeting');
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        rawLocalStreamRef.current = stream;
        applyProcessedLocalStream(stream);
      } catch (err) {
        console.error('No media devices available:', err);
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
    };
  }, [applyProcessedLocalStream, isInMeeting]);

  // Sync mic/camera toggle to local stream
  useEffect(() => {
    const syncAudioState = (stream: MediaStream | null) => {
      stream?.getAudioTracks().forEach((t) => {
        t.enabled = isMicOn;
      });
    };

    syncAudioState(localStreamRef.current);
    syncAudioState(rawLocalStreamRef.current);
  }, [isMicOn]);

  useEffect(() => {
    const syncVideoState = (stream: MediaStream | null) => {
      stream?.getVideoTracks().forEach((t) => {
        t.enabled = isCameraOn;
      });
    };

    syncVideoState(localStreamRef.current);
    syncVideoState(rawLocalStreamRef.current);
  }, [isCameraOn]);

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
          }
        });
    })();

    return () => {
      cancelled = true;
      joinTimers.forEach((timer) => clearTimeout(timer));

      channel?.send({
        type: 'broadcast',
        event: 'leave',
        payload: { peerId: myPeerIdRef.current },
      });

      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();
      makingOfferRef.current.clear();
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
  };
}
