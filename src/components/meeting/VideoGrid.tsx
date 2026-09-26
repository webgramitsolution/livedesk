import { useMeetingStore } from '@/store/meetingStore';
import { VideoTile } from './VideoTile';
import { AnnotationOverlay } from './AnnotationOverlay';
import { motion } from 'framer-motion';
import { Monitor, X, PenTool } from 'lucide-react';
import { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { RemoteControlOverlay } from './RemoteControlOverlay';
import { useRemoteControl, type RCTransport } from '@/hooks/useRemoteControl';
import { useAnnotations } from '@/hooks/useAnnotations';
import { useRemoteControlSessionWatch } from '@/hooks/useRemoteControlSessionWatch';
import { executeInput } from '@/lib/remoteControl/inputExecutor';
import { getElectronDesktop } from '@/lib/remoteControl/electronBridge';
import { getDataBus } from '@/lib/dataPlane';
import { grantRemoteControl, revokeRemoteControl } from '@/lib/permissions/api';
import { logWebRTCEvent } from '@/lib/webrtcLogger';

interface VideoGridProps {
  localStream?: MediaStream | null;
  remoteStreams?: Map<string, MediaStream>;
  screenStream?: MediaStream | null;
  remoteScreenStream?: MediaStream | null;
  remoteScreenPeerId?: string | null;
  getDiagnosticsSnapshot?: () => Promise<unknown>;
}

const ScreenShareVideo = forwardRef<HTMLVideoElement, { stream: MediaStream; isLocal?: boolean }>(function ScreenShareVideo(
  { stream, isLocal },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      // Mute local screen share to prevent audio feedback loop
      videoRef.current.muted = !!isLocal;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [stream, isLocal]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={!!isLocal}
      data-testid="screen-share-video"
      className="w-full h-full object-contain"
    />
  );
});

export function VideoGrid({ localStream, remoteStreams, screenStream, remoteScreenStream, remoteScreenPeerId, getDiagnosticsSnapshot }: VideoGridProps) {
  const { participants, transcript, isTranslationEnabled, isScreenSharing, isSelfCapture, toggleScreenShare, selectedLanguage, meetingId } =
    useMeetingStore();
  const meetingSessionId = useMeetingStore((s) => s.meetingSessionId);
  const isAnnotating = useMeetingStore((s) => s.isAnnotating);
  const setAnnotating = useMeetingStore((s) => s.setAnnotating);
  const permissionRows = useMeetingStore((s) => s.session.permissionRows);
  const meetingControls = useMeetingStore((s) => s.session.meetingControls);
  const hostUserId = useMeetingStore((s) => s.session.hostUserId);
  const myUserId = useMeetingStore((s) => s.session.myUserId);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Effective permissions (recomputed when rows / controls / host change).
  const myPermission = useMeetingStore.getState().myPermission();
  const isHost = !!myUserId && myUserId === hostUserId;
  const annotationsEnabled = meetingControls.annotationEnabled || isHost;
  const canAnnotate = myPermission.canAnnotate && annotationsEnabled;
  const annotationDisabledReason = !meetingControls.annotationEnabled && !isHost
    ? 'The host disabled annotation for everyone'
    : !myPermission.canAnnotate
      ? 'Ask the host to allow annotation'
      : undefined;
  void permissionRows; // subscription only: keeps this component in sync with permission changes

  // Presentation identity for annotations: the presenter's session id.
  const presenterId = isScreenSharing ? meetingSessionId : remoteScreenPeerId ?? null;
  const annotations = useAnnotations({ presenterId, enabled: !!presenterId });

  // Leave drawing mode when the share ends or permission is withdrawn.
  useEffect(() => {
    if (isAnnotating && (!presenterId || !canAnnotate)) setAnnotating(false);
  }, [isAnnotating, presenterId, canAnnotate, setAnnotating]);

  // Remote-control: overlay is active whenever there is a shared screen
  // (local or remote). The overlay both broadcasts our cursor and, when
  // control has been granted, executes real input on the presenter side.
  // Control messages travel on the data plane (peer-to-peer) with automatic
  // fallback; link loss is fed back so grants die with the connection.
  const rcTransport = useMemo<RCTransport>(() => {
    const bus = getDataBus();
    return {
      send: (payload) => {
        try {
          bus.publish('rc', payload, { to: 'to' in payload ? payload.to : undefined });
        } catch (err) {
          logWebRTCEvent('error', 'rc-publish-failed', { reason: String(err) });
        }
      },
      subscribe: (handler) => bus.subscribe('rc', (payload) => handler(payload)),
      onPeerLink: (handler) => bus.onPeerChannel((e) => handler(e.peerId, e.state)),
    };
  }, []);

  // Server-issued control tokens when a backend session exists; local test
  // mode (no user) falls back to the hook's local nonce.
  const hasBackendSession = !!myUserId;
  const authorizeGrant = useCallback(
    async (controllerId: string, mode: 'mouse' | 'mouse+keyboard') => {
      try {
        const row = await grantRemoteControl(meetingId, meetingSessionId, controllerId, mode);
        return { token: row.token };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Grant rejected';
        return { error: message.replace(/^.*?:\s*/, '') };
      }
    },
    [meetingId, meetingSessionId],
  );
  const notifyRevoke = useCallback(
    async (controllerId: string, reason: string) => {
      try {
        await revokeRemoteControl(meetingId, controllerId, reason);
      } catch (err) {
        logWebRTCEvent('error', 'rc-revoke-record-failed', { reason: String(err) });
      }
    },
    [meetingId],
  );
  const setSession = useMeetingStore((s) => s.setSession);
  const onControlSession = useCallback(
    (session: { token: string; controllerId: string; controllerName: string; allowKeyboard: boolean } | null) => {
      setSession({
        remoteControlSession: session
          ? { token: session.token, presenterId: meetingSessionId, controllerId: session.controllerId, controllerName: session.controllerName, mode: session.allowKeyboard ? 'mouse+keyboard' : 'mouse', since: Date.now() }
          : null,
      });
      // Desktop app: arm/disarm OS-level input for exactly this token.
      const desktop = getElectronDesktop();
      if (!desktop) return;
      if (session) {
        void desktop.remoteControl.startSession({ token: session.token, controllerId: session.controllerId, allowKeyboard: session.allowKeyboard, displayId: null });
      } else {
        const current = useMeetingStore.getState().session.remoteControlSession;
        void desktop.remoteControl.endSession(current?.token ?? '');
      }
    },
    [meetingSessionId, setSession],
  );

  const rc = useRemoteControl({
    meetingId,
    isInMeeting: true,
    isLocalPresenter: isScreenSharing,
    presenterHintId: remoteScreenPeerId,
    transport: rcTransport,
    authorizeGrant: hasBackendSession ? authorizeGrant : undefined,
    notifyRevoke: hasBackendSession ? notifyRevoke : undefined,
    onControlSession,
    onExecuteInput: (event, _fromName, token) => {
      // Presenter side: input is only executed for the active session token.
      executeInput(event, token);
    },
  });
  useRemoteControlSessionWatch({ meetingId, enabled: hasBackendSession, rc });

  // Suppress the local live preview when the presenter is capturing this very tab,
  // otherwise we render a "hall of mirrors" recursion. Remote peers still receive
  // the outgoing track — only local rendering is replaced with a static thumbnail.
  const suppressLocalPreview = !!(isSelfCapture && isScreenSharing);
  const activeScreenStream = suppressLocalPreview ? remoteScreenStream : (screenStream || remoteScreenStream);

  // Remote Desktop is only offered when an incoming screen-share video track is
  // actually live (not ended/muted) — i.e. we really are watching the presenter.
  const remoteScreenTrackLive = !!remoteScreenStream
    ?.getVideoTracks()
    .some((t) => t.readyState === 'live' && !t.muted);

  // Static thumbnail: capture ONE frame from the camera stream when we start
  // suppressing the preview, so the "You are presenting" card shows a real
  // presenter thumbnail (Zoom/Meet-style) instead of a spinning video.
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!suppressLocalPreview) { setThumbDataUrl(null); return; }
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    const el = document.createElement('video');
    el.srcObject = localStream;
    el.muted = true;
    el.playsInline = true;
    let cancelled = false;
    el.play().then(() => {
      if (cancelled) return;
      const canvas = thumbCanvasRef.current ?? document.createElement('canvas');
      thumbCanvasRef.current = canvas;
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(el, 0, 0, canvas.width, canvas.height);
      try { setThumbDataUrl(canvas.toDataURL('image/jpeg', 0.7)); } catch { /* tainted */ }
      el.pause();
      el.srcObject = null;
    }).catch(() => undefined);
    return () => { cancelled = true; el.pause(); el.srcObject = null; };
  }, [suppressLocalPreview, localStream]);

  const TRANSLATED_SUBTITLES: Record<string, Record<string, string>> = {
    'Sarah Chen': { hi: 'मुझे Q4 से नवीनतम मेट्रिक्स साझा करने दें...', es: 'Permítanme compartir las últimas métricas del Q4...', fr: 'Permettez-moi de partager les dernières métriques du Q4...' },
  };

  const getSubtitle = (participantName: string) => {
    if (!isTranslationEnabled) return undefined;
    const entry = transcript.find((t) => t.speaker === participantName && t.isActive);
    if (!entry) return undefined;
    if (selectedLanguage !== 'en' && TRANSLATED_SUBTITLES[participantName]?.[selectedLanguage]) {
      return TRANSLATED_SUBTITLES[participantName][selectedLanguage];
    }
    return entry.text;
  };

  const getStreamForParticipant = (p: typeof participants[0]) => {
    if (p.id === '1') return localStream || null;
    return remoteStreams?.get(p.id) || null;
  };

  if (isScreenSharing || remoteScreenStream) {
    return (
      <div className="flex-1 flex flex-col gap-2 p-3 overflow-hidden">
        {/* Main screen share area */}
        <div className="flex-1 relative rounded-xl overflow-hidden bg-background min-h-0">
          {activeScreenStream && !suppressLocalPreview ? (
            <ScreenShareVideo ref={screenVideoRef} stream={activeScreenStream} isLocal={!!screenStream} />
          ) : (
            <div
              className="w-full h-full bg-gradient-to-br from-muted to-muted/60 flex flex-col items-center justify-center gap-3"
              data-testid={suppressLocalPreview ? 'self-capture-placeholder' : 'screen-share-placeholder'}
              role="status"
              aria-live="polite"
              aria-label={suppressLocalPreview ? 'You are presenting. Local preview suspended to prevent recursive capture.' : 'You are sharing your screen'}
            >
              {suppressLocalPreview && thumbDataUrl ? (
                <img
                  src={thumbDataUrl}
                  alt="Static presenter thumbnail"
                  data-testid="self-capture-thumbnail"
                  className="w-40 h-24 rounded-lg object-cover border border-border shadow-sm"
                />
              ) : (
                <Monitor className="w-16 h-16 text-primary/40" aria-hidden="true" />
              )}
              <span className="text-foreground text-base font-display font-bold">
                {suppressLocalPreview ? 'You are presenting' : 'You are sharing your screen'}
              </span>
              {suppressLocalPreview && (
                <span className="text-muted-foreground text-xs max-w-sm text-center px-4" data-testid="self-capture-warning">
                  Live preview is hidden here to prevent a recursive screen effect. Remote participants see your shared window normally.
                </span>
              )}
            </div>
          )}
          {/* Remote-control cursor + input overlay (suspended while drawing) */}
          <RemoteControlOverlay
            rc={rc}
            meetingId={meetingId}
            screenTrackLive={remoteScreenTrackLive}
            presenterPeerId={remoteScreenPeerId}
            getDiagnosticsSnapshot={getDiagnosticsSnapshot}
            videoRef={screenVideoRef}
            suspended={isAnnotating}
          />
          {/* Collaborative annotation layer (vector, normalized coordinates) */}
          {presenterId && activeScreenStream && !suppressLocalPreview && (
            <AnnotationOverlay
              videoRef={screenVideoRef}
              annotations={annotations}
              sessionId={meetingSessionId}
              active={isAnnotating}
              onSetActive={setAnnotating}
              canAnnotate={canAnnotate}
              canClearAll={isHost || isScreenSharing}
              disabledReason={annotationDisabledReason}
            />
          )}
          {isScreenSharing && (
            <div className="pointer-events-none absolute bottom-4 inset-x-0 mx-auto z-20 flex w-[min(calc(100%-1rem),28rem)] justify-center">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 px-2.5 py-2 backdrop-blur-md control-bar-elevated">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setAnnotating(!isAnnotating)}
                disabled={!canAnnotate}
                title={annotationDisabledReason}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  isAnnotating
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-secondary text-foreground hover:bg-secondary/80'
                }`}
              >
                <PenTool className="w-4 h-4" />
                {isAnnotating ? 'Stop annotating' : 'Annotate'}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={toggleScreenShare}
                className="flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                <X className="w-4 h-4" />
                Stop Sharing
              </motion.button>
              </div>
            </div>
          )}
        </div>

        {/* Thumbnail strip */}
        <div className="flex gap-2 h-24 sm:h-28 md:h-32 shrink-0 overflow-x-auto pb-1">
          {participants.map((p) => (
            <div key={p.id} className="h-full aspect-video shrink-0">
              <VideoTile participant={p} subtitle={getSubtitle(p.name)} compact mediaStream={getStreamForParticipant(p)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 p-2 sm:p-4 auto-rows-fr">
      {participants.map((p) => (
        <VideoTile key={p.id} participant={p} subtitle={getSubtitle(p.name)} mediaStream={getStreamForParticipant(p)} />
      ))}
    </div>
  );
}