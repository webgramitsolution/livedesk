import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMeetingStore } from '@/store/meetingStore';
import { logWebRTCEvent } from '@/lib/webrtcLogger';
import { logRCAudit } from '@/lib/remoteControl/auditLog';
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

export interface ControlLock {
  presenterId: string;
  presenterName: string;
  controllerId: string;
  controllerName: string;
  mode: 'mouse' | 'mouse+keyboard';
}

export type ControlStatus =
  | { state: 'idle' }
  | { state: 'requesting'; presenterId: string; since: number }
  | { state: 'controlling'; presenterId: string; nonce: string; allowKeyboard: boolean; since: number }
  | { state: 'denied'; presenterId: string; reason?: string; since: number };

const CURSOR_STALE_MS = 4000;
const REQUEST_TIMEOUT_MS = 30_000;
// Input rate limiting: cap high-frequency events server-side (per-sender).
const MOUSEMOVE_MIN_INTERVAL_MS = 16; // ~60Hz
const WHEEL_MIN_INTERVAL_MS = 16;

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
  const [requestQueue, setRequestQueue] = useState<IncomingRequest[]>([]);
  const [activeController, setActiveController] = useState<
    { id: string; name: string; nonce: string; allowKeyboard: boolean; since: number } | null
  >(null);
  const [status, setStatus] = useState<ControlStatus>({ state: 'idle' });
  const [controlLock, setControlLock] = useState<ControlLock | null>(null);

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
  const userNameRef = useRef(userName);
  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);
  // Rate-limit outbound input events per type.
  const lastInputRef = useRef<{ move: number; wheel: number }>({ move: 0, wheel: 0 });

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

  // Presenter-only: broadcast the current control lock to everyone.
  const broadcastLock = useCallback(
    (controller: { id: string; name: string; allowKeyboard: boolean } | null) => {
      if (!sessionId) return;
      send({
        kind: 'lock',
        from: sessionId,
        presenterName: userNameRef.current,
        controllerId: controller?.id ?? null,
        controllerName: controller?.name ?? null,
        mode: controller ? (controller.allowKeyboard ? 'mouse+keyboard' : 'mouse') : null,
      });
    },
    [sessionId, send],
  );

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
            setControlLock((cur) => (cur?.presenterId === msg.from ? null : cur));
          }
          break;
        }
        case 'lock': {
          if (msg.controllerId && msg.controllerName && msg.mode) {
            setControlLock({
              presenterId: msg.from,
              presenterName: msg.presenterName,
              controllerId: msg.controllerId,
              controllerName: msg.controllerName,
              mode: msg.mode,
            });
          } else {
            setControlLock((cur) => (cur?.presenterId === msg.from ? null : cur));
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
          setRequestQueue((prev) => {
            if (prev.some((r) => r.from === msg.from)) return prev;
            return [...prev, { from: msg.from, name: msg.name, requestedAt: Date.now() }];
          });
          logRCAudit({
            action: 'queue-added',
            actorId: msg.from,
            actorName: msg.name,
            targetId: sessionId,
            meetingId,
          });
          toast(`${msg.name} wants to control your screen`, {
            description: 'Open the presenter panel to accept or deny.',
            duration: 8000,
          });
          logWebRTCEvent('signal', 'rc-request', { from: msg.from });
          break;
        }
        case 'cancel': {
          if (msg.to !== sessionId) return;
          setRequestQueue((prev) => prev.filter((r) => r.from !== msg.from));
          logRCAudit({ action: 'cancel', actorId: msg.from, meetingId });
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
          logRCAudit({
            action: 'grant',
            actorId: msg.from,
            targetId: sessionId,
            targetName: userNameRef.current,
            mode: msg.allowKeyboard ? 'mouse+keyboard' : 'mouse',
            meetingId,
          });
          logWebRTCEvent('signal', 'rc-grant', { presenter: msg.from });
          break;
        }
        case 'deny': {
          if (msg.to !== sessionId) return;
          setStatus({ state: 'denied', presenterId: msg.from, reason: msg.reason, since: Date.now() });
          toast.error(`Control request denied${msg.reason ? `: ${msg.reason}` : ''}`);
          logRCAudit({
            action: 'deny',
            actorId: msg.from,
            targetId: sessionId,
            reason: msg.reason,
            meetingId,
          });
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
          logRCAudit({
            action: 'revoke',
            actorId: msg.from,
            targetId: sessionId,
            reason: msg.reason,
            meetingId,
          });
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
    if (isLocalPresenter) {
      // Also re-announce current lock so late-joiners see it.
      broadcastLock(
        activeControllerRef.current
          ? {
              id: activeControllerRef.current.id,
              name: activeControllerRef.current.name,
              allowKeyboard: activeControllerRef.current.allowKeyboard,
            }
          : null,
      );
    }
    if (!isLocalPresenter) return;
    const id = setInterval(() => {
      send({ kind: 'presenter', from: sessionId, name: userName, sharing: true });
      broadcastLock(
        activeControllerRef.current
          ? {
              id: activeControllerRef.current.id,
              name: activeControllerRef.current.name,
              allowKeyboard: activeControllerRef.current.allowKeyboard,
            }
          : null,
      );
    }, 4000);
    return () => clearInterval(id);
  }, [isInMeeting, isLocalPresenter, sessionId, userName, send, broadcastLock]);

  // Auto-revoke: if presenter stops sharing while granting to someone, revoke.
  useEffect(() => {
    if (isLocalPresenter) return;
    if (activeController) setActiveController(null);
  }, [isLocalPresenter, activeController]);

  useEffect(() => {
    if (!isLocalPresenter && activeControllerRef.current) {
      // Presenter just stopped sharing — tell controller.
      send({ kind: 'revoke', from: sessionId, to: activeControllerRef.current.id, reason: 'Presenter stopped sharing' });
      logRCAudit({
        action: 'auto-revoke',
        actorId: sessionId,
        targetId: activeControllerRef.current.id,
        targetName: activeControllerRef.current.name,
        reason: 'Presenter stopped sharing',
        meetingId,
      });
      broadcastLock(null);
    }
  }, [isLocalPresenter, sessionId, send, broadcastLock, meetingId]);

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
    logRCAudit({
      action: 'request',
      actorId: sessionId,
      actorName: userName,
      targetId: remotePresenterId,
      meetingId,
    });
    toast('Waiting for presenter to accept…');
    setTimeout(() => {
      setStatus((cur) => (cur.state === 'requesting' ? { state: 'idle' } : cur));
    }, REQUEST_TIMEOUT_MS);
  }, [remotePresenterId, sessionId, userName, send, meetingId]);

  const cancelRequest = useCallback(() => {
    const st = statusRef.current;
    if (st.state !== 'requesting') return;
    send({ kind: 'cancel', from: sessionId, to: st.presenterId });
    setStatus({ state: 'idle' });
    logRCAudit({ action: 'cancel', actorId: sessionId, targetId: st.presenterId, meetingId });
  }, [sessionId, send, meetingId]);

  const releaseControl = useCallback(() => {
    const st = statusRef.current;
    if (st.state !== 'controlling') return;
    send({ kind: 'revoke', from: sessionId, to: st.presenterId });
    setStatus({ state: 'idle' });
    logRCAudit({ action: 'revoke', actorId: sessionId, targetId: st.presenterId, meetingId });
  }, [sessionId, send, meetingId]);

  const grantRequest = useCallback(
    (fromId: string, allowKeyboard: boolean) => {
      const target = requestQueue.find((r) => r.from === fromId);
      if (!target) return;
      const nonce = newNonce();
      const controller = {
        id: target.from,
        name: target.name,
        nonce,
        allowKeyboard,
        since: Date.now(),
      };
      setActiveController(controller);
      send({ kind: 'grant', from: sessionId, to: target.from, nonce, allowKeyboard });
      // Deny everyone else in the queue so we don't have ambiguous pending state.
      requestQueue.forEach((r) => {
        if (r.from !== target.from) {
          send({ kind: 'deny', from: sessionId, to: r.from, reason: 'Another viewer was granted control' });
        }
      });
      setRequestQueue([]);
      broadcastLock({ id: controller.id, name: controller.name, allowKeyboard });
      logRCAudit({
        action: 'grant',
        actorId: sessionId,
        actorName: userNameRef.current,
        targetId: controller.id,
        targetName: controller.name,
        mode: allowKeyboard ? 'mouse+keyboard' : 'mouse',
        meetingId,
      });
      toast.success(`${controller.name} now has control. Press Esc to reclaim.`);
    },
    [requestQueue, sessionId, send, broadcastLock, meetingId],
  );

  const denyRequest = useCallback(
    (fromId: string, reason?: string) => {
      send({ kind: 'deny', from: sessionId, to: fromId, reason });
      setRequestQueue((prev) => prev.filter((r) => r.from !== fromId));
      logRCAudit({ action: 'deny', actorId: sessionId, targetId: fromId, reason, meetingId });
    },
    [sessionId, send, meetingId],
  );

  const reclaimControl = useCallback(() => {
    if (!activeController) return;
    send({ kind: 'revoke', from: sessionId, to: activeController.id, reason: 'Presenter reclaimed control' });
    logRCAudit({
      action: 'reclaim',
      actorId: sessionId,
      targetId: activeController.id,
      targetName: activeController.name,
      meetingId,
    });
    setActiveController(null);
    broadcastLock(null);
    toast.info('You reclaimed control.');
  }, [activeController, sessionId, send, broadcastLock, meetingId]);

  const sendInput = useCallback(
    (event: RCInputEvent) => {
      const st = statusRef.current;
      if (st.state !== 'controlling') return;
      // Rate-limit high-frequency motion / wheel events.
      const now = performance.now();
      if (event.type === 'mousemove') {
        if (now - lastInputRef.current.move < MOUSEMOVE_MIN_INTERVAL_MS) return;
        lastInputRef.current.move = now;
      } else if (event.type === 'wheel') {
        if (now - lastInputRef.current.wheel < WHEEL_MIN_INTERVAL_MS) return;
        lastInputRef.current.wheel = now;
      }
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
    incomingRequest: requestQueue[0] ?? null,
    requestQueue,
    activeController,
    controlLock,
    requestControl,
    cancelRequest,
    releaseControl,
    grantIncoming: (allowKeyboard: boolean) => {
      const first = requestQueue[0];
      if (first) grantRequest(first.from, allowKeyboard);
    },
    denyIncoming: (reason?: string) => {
      const first = requestQueue[0];
      if (first) denyRequest(first.from, reason);
    },
    grantRequest,
    denyRequest,
    reclaimControl,
    sendInput,
  };
}

export type UseRemoteControlReturn = ReturnType<typeof useRemoteControl>;