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
  wrapRC,
  type RCButton,
  type RCInputEvent,
  type RCMessage,
} from '@/lib/remoteControl/protocol';
import { validateRCMessage } from '@/lib/remoteControl/validation';
import { loadRCTuning, DEFAULT_RC_TUNING, type RCTuning } from '@/lib/remoteControl/settings';
import { loadRCState, saveRCState, clearRCState } from '@/lib/remoteControl/persistence';

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

export interface RCMetrics {
  requestsSent: number;
  grantsReceived: number;
  deniesReceived: number;
  lastGrantLatencyMs: number | null;
  avgGrantLatencyMs: number | null;
  throttledOutbound: number; // count of local events dropped by rate limit
  droppedInboundInvalid: number; // count of invalid/unauthorized inbound messages
  droppedInboundUnauthorized: number;
}

const CURSOR_STALE_MS = 4000;
const REQUEST_TIMEOUT_MS = 30_000;

interface UseRemoteControlOptions {
  meetingId: string;
  isInMeeting: boolean;
  isLocalPresenter: boolean; // true when we are sharing a screen
  onExecuteInput?: (event: RCInputEvent, fromName: string) => void;
  tuning?: RCTuning;
}

export function useRemoteControl(options: UseRemoteControlOptions) {
  const { meetingId, isInMeeting, isLocalPresenter, onExecuteInput } = options;
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
  const [metrics, setMetrics] = useState<RCMetrics>({
    requestsSent: 0,
    grantsReceived: 0,
    deniesReceived: 0,
    lastGrantLatencyMs: null,
    avgGrantLatencyMs: null,
    throttledOutbound: 0,
    droppedInboundInvalid: 0,
    droppedInboundUnauthorized: 0,
  });

  // Tuning: caller may pass an override; otherwise pull the persisted per-meeting values.
  const tuning: RCTuning = options.tuning ?? loadRCTuning(meetingId) ?? DEFAULT_RC_TUNING;
  const tuningRef = useRef<RCTuning>(tuning);
  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning.mousemoveMinMs, tuning.wheelMinMs, tuning.cursorSmoothingMs, tuning.cursorSendMinMs]);

  // Tracks every peer we have heard from on this channel — used to reject
  // control-state messages from unknown senders and to enforce that only the
  // active presenter can broadcast lock updates.
  const knownPeersRef = useRef<Set<string>>(new Set());
  const remotePresenterIdRef = useRef<string | null>(null);
  useEffect(() => {
    remotePresenterIdRef.current = remotePresenterId;
  }, [remotePresenterId]);
  const grantLatencySamples = useRef<number[]>([]);
  const requestQueueRef = useRef<IncomingRequest[]>([]);
  useEffect(() => {
    requestQueueRef.current = requestQueue;
  }, [requestQueue]);
  const controlLockRef = useRef<ControlLock | null>(null);
  useEffect(() => {
    controlLockRef.current = controlLock;
  }, [controlLock]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const optionsMeetingIdRef = useRef(meetingId);
  useEffect(() => {
    optionsMeetingIdRef.current = meetingId;
  }, [meetingId]);
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
  const lastInputRef = useRef<{ move: number; wheel: number; cursor: number }>({ move: 0, wheel: 0, cursor: 0 });

  const bumpDropped = useCallback((key: 'invalid' | 'unauthorized') => {
    setMetrics((m) => ({
      ...m,
      droppedInboundInvalid: key === 'invalid' ? m.droppedInboundInvalid + 1 : m.droppedInboundInvalid,
      droppedInboundUnauthorized: key === 'unauthorized' ? m.droppedInboundUnauthorized + 1 : m.droppedInboundUnauthorized,
    }));
  }, []);

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
    const signed = wrapRC(msg, optionsMeetingIdRef.current);
    channelRef.current.send({ type: 'broadcast', event: RC_EVENT, payload: signed });
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
    (raw: unknown) => {
      const msg = validateRCMessage(raw, { meetingId });
      if (!msg) {
        bumpDropped('invalid');
        return;
      }
      if (msg.from === sessionId) return; // ignore self-echo
      // Track the sender as a known peer. Presenter announcements and cursor
      // broadcasts serve as our lightweight participant discovery — control
      // messages from a completely unseen id are rejected below.
      knownPeersRef.current.add(msg.from);

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
          // Only the current presenter (as tracked by us) is authorized to
          // publish a lock. Anything else is dropped.
          if (msg.from !== remotePresenterIdRef.current) {
            bumpDropped('unauthorized');
            return;
          }
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
          if (st.state !== 'requesting' || st.presenterId !== msg.from) {
            bumpDropped('unauthorized');
            return;
          }
          const latency = Date.now() - st.since;
          grantLatencySamples.current.push(latency);
          if (grantLatencySamples.current.length > 20) grantLatencySamples.current.shift();
          const avg =
            grantLatencySamples.current.reduce((a, b) => a + b, 0) /
            grantLatencySamples.current.length;
          setMetrics((m) => ({
            ...m,
            grantsReceived: m.grantsReceived + 1,
            lastGrantLatencyMs: latency,
            avgGrantLatencyMs: Math.round(avg),
          }));
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
          const st = statusRef.current;
          if (st.state === 'requesting' && st.presenterId !== msg.from) {
            bumpDropped('unauthorized');
            return;
          }
          setMetrics((m) => ({ ...m, deniesReceived: m.deniesReceived + 1 }));
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
          const st = statusRef.current;
          if (st.state === 'controlling' && st.presenterId !== msg.from) {
            bumpDropped('unauthorized');
            return;
          }
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
          if (!active || active.id !== msg.from || active.nonce !== msg.nonce) {
            bumpDropped('unauthorized');
            return;
          }
          if (!active.allowKeyboard && (msg.event.type === 'keydown' || msg.event.type === 'keyup')) {
            bumpDropped('unauthorized');
            return;
          }
          onExecuteInputRef.current?.(msg.event, active.name);
          break;
        }
      }
    },
    [sessionId, meetingId, bumpDropped],
  );

  // Subscribe to signaling channel.
  useEffect(() => {
    if (!isInMeeting || !meetingId || !sessionId) return;
    // Rehydrate from a recent local snapshot on (re)mount so a brief
    // disconnect doesn't lose the queue, lock, or pending request.
    const persisted = loadRCState(meetingId, sessionId);
    if (persisted) {
      setRequestQueue(persisted.requestQueue ?? []);
      setActiveController(persisted.activeController ?? null);
      setControlLock(persisted.controlLock ?? null);
      setStatus(persisted.status ?? { state: 'idle' });
    }
    const channel = supabase.channel(`webrtc-${meetingId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;
    channel
      .on('broadcast', { event: RC_EVENT }, ({ payload }) => handleMessage(payload))
      .subscribe((s) => {
        readyRef.current = s === 'SUBSCRIBED';
        if (s === 'SUBSCRIBED' && persisted?.status?.state === 'requesting') {
          // We had a pending request — re-issue the request so the presenter
          // can (re)notify us without a duplicate row on their side (the
          // presenter's queue is deduped by sender id).
          const p = persisted.status as { state: 'requesting'; presenterId: string };
          channel.send({
            type: 'broadcast',
            event: RC_EVENT,
            payload: { kind: 'request', from: sessionId, name: userNameRef.current, to: p.presenterId },
          });
        }
      });
    return () => {
      readyRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [handleMessage, isInMeeting, meetingId, sessionId]);

  // Persist queue / lock / status snapshots so a reconnect resumes cleanly.
  useEffect(() => {
    if (!isInMeeting || !meetingId || !sessionId) return;
    saveRCState(meetingId, sessionId, {
      requestQueue,
      activeController,
      controlLock,
      status,
    });
  }, [isInMeeting, meetingId, sessionId, requestQueue, activeController, controlLock, status]);

  useEffect(() => {
    return () => {
      // Read the LATEST state via refs — the effect only depends on
      // meetingId/sessionId, so the destroy closure would otherwise capture
      // the empty state that existed at mount and wipe a live queue.
      const st = statusRef.current;
      const ac = activeControllerRef.current;
      const q = requestQueueRef.current;
      const lock = controlLockRef.current;
      if (meetingId && sessionId && st.state === 'idle' && !ac && !lock && q.length === 0) {
        clearRCState(meetingId, sessionId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, sessionId]);

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
    setMetrics((m) => ({ ...m, requestsSent: m.requestsSent + 1 }));
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
      // Rate-limit high-frequency motion / wheel events using per-meeting tuning.
      const now = performance.now();
      const t = tuningRef.current;
      if (event.type === 'mousemove') {
        if (now - lastInputRef.current.move < t.mousemoveMinMs) {
          setMetrics((m) => ({ ...m, throttledOutbound: m.throttledOutbound + 1 }));
          return;
        }
        lastInputRef.current.move = now;
      } else if (event.type === 'wheel') {
        if (now - lastInputRef.current.wheel < t.wheelMinMs) {
          setMetrics((m) => ({ ...m, throttledOutbound: m.throttledOutbound + 1 }));
          return;
        }
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
    metrics,
    tuning,
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
    /** Exposed for automated tests to inject validated messages. */
    __handleMessage: handleMessage,
  };
}

export type UseRemoteControlReturn = ReturnType<typeof useRemoteControl>;