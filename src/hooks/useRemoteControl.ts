import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore } from '@/store/meetingStore';
import { logWebRTCEvent } from '@/lib/webrtcLogger';
import { toast } from 'sonner';
import {
  RC_EVENT,
  colorForId,
  newNonce,
  type RCButton,
  type RCInputEvent,
  type RCMessage,
} from '@/lib/remoteControl/protocol';

export interface RemoteCursor {
  id: string;
  name: string;
  color: string;
  x: number; // 0..1
  y: number; // 0..1
  visible: boolean;
  updatedAt: number;
}

export interface RemoteRipple {
  id: string; // synthetic key
  from: string;
  name: string;
  color: string;
  x: number;
  y: number;
  createdAt: number;
}

export interface IncomingRequest {
  from: string;
  name: string;
  requestedAt: number;
}

export type ControlStatus =
  | { state: 'idle' }
  | { state: 'requesting'; presenterId: string; since: number }
  | { state: 'controlling'; presenterId: string; nonce: string; allowKeyboard: boolean; since: number }
  | { state: 'denied'; presenterId: string; reason?: string; since: number };

const CURSOR_STALE_MS = 4000;
const REQUEST_TIMEOUT_MS = 30_000;

interface UseRemoteControlOptions {
  meetingId: string;
  isInMeeting: boolean;
  isLocalPresenter: boolean; // true when we are sharing a screen
  onExecuteInput?: (event: RCInputEvent, fromName: string) => void;
}

export function useRemoteControl({
  meetingId,
  isInMeeting,
  isLocalPresenter,
  onExecuteInput,
}: UseRemoteControlOptions) {
  const sessionId = useMeetingStore((s) => s.meetingSessionId);
  const userName = useMeetingStore((s) => s.userName) || 'You';

  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [ripples, setRipples] = useState<RemoteRipple[]>([]);
  const [remotePresenterId, setRemotePresenterId] = useState<string | null>(null);
  const [remotePresenterName, setRemotePresenterName] = useState<string>('Presenter');
  const [incomingRequest, setIncomingRequest] = useState<IncomingRequest | null>(null);
  const [activeController, setActiveController] = useState<
    { id: string; name: string; nonce: string; allowKeyboard: boolean; since: number } | null
  >(null);
  const [status, setStatus] = useState<ControlStatus>({ state: 'idle' });

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const readyRef = useRef(false);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const activeControllerRef = useRef(activeController);
  useEffect(() => {
    activeControllerRef.current = activeController;
  }, [activeController]);
  const isLocalPresenterRef = useRef(isLocalPresenter);
  useEffect(() => {
    isLocalPresenterRef.current = isLocalPresenter;
  }, [isLocalPresenter]);
  const onExecuteInputRef = useRef(onExecuteInput);
  useEffect(() => {
    onExecuteInputRef.current = onExecuteInput;
  }, [onExecuteInput]);

  // Prune stale cursors.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next = new Map(prev);
        prev.forEach((c, key) => {
          if (now - c.updatedAt > CURSOR_STALE_MS && c.visible) {
            next.set(key, { ...c, visible: false });
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const send = useCallback((msg: RCMessage) => {
    if (!channelRef.current || !readyRef.current) return;
    channelRef.current.send({ type: 'broadcast', event: RC_EVENT, payload: msg });
  }, []);

  // --- Message router ---
  const handleMessage = useCallback(
    (msg: RCMessage) => {
      if (msg.from === sessionId) return; // ignore self-echo

      switch (msg.kind) {
        case 'presenter': {
          if (msg.sharing) {
            setRemotePresenterId(msg.from);
            setRemotePresenterName(msg.name);
          } else {
            setRemotePresenterId((cur) => (cur === msg.from ? null : cur));
            // If we were being controlled by the presenter's disappearance, reset.
            const st = statusRef.current;
            if (st.state !== 'idle' && st.presenterId === msg.from) {
              setStatus({ state: 'idle' });
            }
          }
          break;
        }
        case 'cursor': {
          setRemoteCursors((prev) => {
            const next = new Map(prev);
            next.set(msg.from, {
              id: msg.from,
              name: msg.name,
              color: msg.color,
              x: msg.x,
              y: msg.y,
              visible: msg.visible,
              updatedAt: Date.now(),
            });
            return next;
          });
          break;
        }
        case 'ripple': {
          const ripple: RemoteRipple = {
            id: `${msg.from}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            from: msg.from,
            name: msg.name,
            color: msg.color,
            x: msg.x,
            y: msg.y,
            createdAt: Date.now(),
          };
          setRipples((prev) => [...prev, ripple]);
          setTimeout(() => {
            setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
          }, 900);
          break;
        }
        case 'request': {
          if (msg.to !== sessionId) return;
          if (!isLocalPresenterRef.current) return;
          setIncomingRequest({ from: msg.from, name: msg.name, requestedAt: Date.now() });
          toast(`${msg.name} wants to control your screen`, {
            description: 'Open the presenter panel to accept or deny.',
            duration: 8000,
          });
          logWebRTCEvent('signal', 'rc-request', { from: msg.from });
          break;
        }
        case 'cancel': {
          if (msg.to !== sessionId) return;
          setIncomingRequest((cur) => (cur?.from === msg.from ? null : cur));
          break;
        }
        case 'grant': {
          if (msg.to !== sessionId) return;
          const st = statusRef.current;
          if (st.state !== 'requesting' || st.presenterId !== msg.from) return;
          setStatus({
            state: 'controlling',
            presenterId: msg.from,
            nonce: msg.nonce,
            allowKeyboard: msg.allowKeyboard,
            since: Date.now(),
          });
          toast.success('Control granted — move your mouse over the shared screen.');
          logWebRTCEvent('signal', 'rc-grant', { presenter: msg.from });
          break;
        }
        case 'deny': {
          if (msg.to !== sessionId) return;
          setStatus({ state: 'denied', presenterId: msg.from, reason: msg.reason, since: Date.now() });
          toast.error(`Control request denied${msg.reason ? `: ${msg.reason}` : ''}`);
          logWebRTCEvent('signal', 'rc-deny', { presenter: msg.from });
          setTimeout(() => {
            setStatus((cur) => (cur.state === 'denied' ? { state: 'idle' } : cur));
          }, 3000);
          break;
        }
        case 'revoke': {
          if (msg.to !== sessionId) return;
          // Presenter revoked our control.
          setStatus({ state: 'idle' });
          if (activeControllerRef.current?.id === msg.from) {
            setActiveController(null);
          }
          toast.info('Remote control ended.');
          logWebRTCEvent('signal', 'rc-revoke', { from: msg.from });
          break;
        }
        case 'input': {
          if (msg.to !== sessionId) return;
          if (!isLocalPresenterRef.current) return;
          const active = activeControllerRef.current;
          if (!active || active.id !== msg.from || active.nonce !== msg.nonce) return;
          if (!active.allowKeyboard && (msg.event.type === 'keydown' || msg.event.type === 'keyup')) return;
          onExecuteInputRef.current?.(msg.event, active.name);
          break;
        }
      }
    },
    [sessionId],
  );

  // Subscribe to signaling channel.
  useEffect(() => {
    if (!isInMeeting || !meetingId || !sessionId) return;
    const channel = supabase.channel(`webrtc-${meetingId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;
    channel
      .on('broadcast', { event: RC_EVENT }, ({ payload }) => handleMessage(payload as RCMessage))
      .subscribe((s) => {
        readyRef.current = s === 'SUBSCRIBED';
      });
    return () => {
      readyRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [handleMessage, isInMeeting, meetingId, sessionId]);

  // Announce presenter status.
  useEffect(() => {
    if (!isInMeeting || !sessionId) return;
    // Announce on change; also announce every 4s while sharing so late joiners learn about us.
    send({ kind: 'presenter', from: sessionId, name: userName, sharing: isLocalPresenter });
    if (!isLocalPresenter) return;
    const id = setInterval(() => {
      send({ kind: 'presenter', from: sessionId, name: userName, sharing: true });
    }, 4000);
    return () => clearInterval(id);
  }, [isInMeeting, isLocalPresenter, sessionId, userName, send]);

  // Auto-revoke: if presenter stops sharing while granting to someone, revoke.
  useEffect(() => {
    if (isLocalPresenter) return;
    if (activeController) setActiveController(null);
  }, [isLocalPresenter, activeController]);

  useEffect(() => {
    if (!isLocalPresenter && activeControllerRef.current) {
      // Presenter just stopped sharing — tell controller.
      send({ kind: 'revoke', from: sessionId, to: activeControllerRef.current.id, reason: 'Presenter stopped sharing' });
    }
  }, [isLocalPresenter, sessionId, send]);

  // --- Public actions ---
  const localColor = useMemo(() => colorForId(sessionId || 'local'), [sessionId]);

  const sendCursor = useCallback(
    (x: number, y: number, visible = true) => {
      if (!sessionId) return;
      send({ kind: 'cursor', from: sessionId, name: userName, color: localColor, x, y, visible });
    },
    [sessionId, userName, localColor, send],
  );

  const sendRipple = useCallback(
    (x: number, y: number, button: RCButton) => {
      if (!sessionId) return;
      send({ kind: 'ripple', from: sessionId, name: userName, color: localColor, x, y, button });
    },
    [sessionId, userName, localColor, send],
  );

  const requestControl = useCallback(() => {
    if (!remotePresenterId || !sessionId) return;
    setStatus({ state: 'requesting', presenterId: remotePresenterId, since: Date.now() });
    send({ kind: 'request', from: sessionId, name: userName, to: remotePresenterId });
    toast('Waiting for presenter to accept…');
    setTimeout(() => {
      setStatus((cur) => (cur.state === 'requesting' ? { state: 'idle' } : cur));
    }, REQUEST_TIMEOUT_MS);
  }, [remotePresenterId, sessionId, userName, send]);

  const cancelRequest = useCallback(() => {
    const st = statusRef.current;
    if (st.state !== 'requesting') return;
    send({ kind: 'cancel', from: sessionId, to: st.presenterId });
    setStatus({ state: 'idle' });
  }, [sessionId, send]);

  const releaseControl = useCallback(() => {
    const st = statusRef.current;
    if (st.state !== 'controlling') return;
    send({ kind: 'revoke', from: sessionId, to: st.presenterId });
    setStatus({ state: 'idle' });
  }, [sessionId, send]);

  const grantIncoming = useCallback(
    (allowKeyboard: boolean) => {
      if (!incomingRequest) return;
      const nonce = newNonce();
      setActiveController({
        id: incomingRequest.from,
        name: incomingRequest.name,
        nonce,
        allowKeyboard,
        since: Date.now(),
      });
      send({ kind: 'grant', from: sessionId, to: incomingRequest.from, nonce, allowKeyboard });
      setIncomingRequest(null);
      toast.success(`${incomingRequest.name} now has control. Press Esc to reclaim.`);
    },
    [incomingRequest, sessionId, send],
  );

  const denyIncoming = useCallback(
    (reason?: string) => {
      if (!incomingRequest) return;
      send({ kind: 'deny', from: sessionId, to: incomingRequest.from, reason });
      setIncomingRequest(null);
    },
    [incomingRequest, sessionId, send],
  );

  const reclaimControl = useCallback(() => {
    if (!activeController) return;
    send({ kind: 'revoke', from: sessionId, to: activeController.id, reason: 'Presenter reclaimed control' });
    setActiveController(null);
    toast.info('You reclaimed control.');
  }, [activeController, sessionId, send]);

  const sendInput = useCallback(
    (event: RCInputEvent) => {
      const st = statusRef.current;
      if (st.state !== 'controlling') return;
      send({ kind: 'input', from: sessionId, to: st.presenterId, nonce: st.nonce, event });
    },
    [sessionId, send],
  );

  // Presenter shortcut: Esc reclaims control while someone is controlling us.
  useEffect(() => {
    if (!activeController) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        reclaimControl();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeController, reclaimControl]);

  return {
    // presence + peers
    remotePresenterId,
    remotePresenterName,
    isLocalPresenter,
    // cursors + click ripples
    remoteCursors,
    ripples,
    sendCursor,
    sendRipple,
    // control lifecycle
    status,
    incomingRequest,
    activeController,
    requestControl,
    cancelRequest,
    releaseControl,
    grantIncoming,
    denyIncoming,
    reclaimControl,
    sendInput,
  };
}

export type UseRemoteControlReturn = ReturnType<typeof useRemoteControl>;