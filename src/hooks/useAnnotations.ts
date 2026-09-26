import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDataBus, newMessageId } from '@/lib/dataPlane';
import {
  AnnotationHistory,
  EMPTY_ANNOTATION_STATE,
  applyOp,
  applySnapshot,
  inverseOf,
  validateOp,
  validateShape,
  type AnnotationMessage,
  type AnnotationOp,
  type AnnotationShape,
  type AnnotationState,
} from '@/lib/annotation';
import { useMeetingStore } from '@/store/meetingStore';
import { logWebRTCEvent } from '@/lib/webrtcLogger';

interface UseAnnotationsOptions {
  /** Session id of the presenter whose screen the annotations belong to (null when nobody shares). */
  presenterId: string | null;
  enabled: boolean;
}

/**
 * Shared annotation state for the current presentation. Every local action is
 * turned into an op, applied locally and broadcast on the `annotation` topic.
 * Inbound ops are validated and permission-checked before they are applied.
 */
export function useAnnotations({ presenterId, enabled }: UseAnnotationsOptions) {
  const sessionId = useMeetingStore((s) => s.meetingSessionId);
  const [state, setState] = useState<AnnotationState>(EMPTY_ANNOTATION_STATE);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const history = useMemo(() => new AnnotationHistory(newMessageId), []);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [rejectedOps, setRejectedOps] = useState(0);
  const presenterRef = useRef(presenterId);

  // Annotations belong to one presentation: a new presenter (or the share
  // ending) clears everything for everyone.
  useEffect(() => {
    if (presenterRef.current !== presenterId) {
      presenterRef.current = presenterId;
      setState(EMPTY_ANNOTATION_STATE);
      history.clear();
      setHistoryVersion((v) => v + 1);
    }
  }, [presenterId, history]);

  const authorAllowed = useCallback((author: string) => {
    const store = useMeetingStore.getState();
    return store.permissionFor(author).canAnnotate;
  }, []);

  const applyLocal = useCallback((op: AnnotationOp) => {
    setState((prev) => applyOp(prev, op));
  }, []);

  // Inbound ops + snapshots.
  useEffect(() => {
    if (!enabled) return;
    const bus = getDataBus();
    const unsubscribe = bus.subscribe<AnnotationMessage>('annotation', (message, ctx) => {
      if (!message || typeof message !== 'object') return;
      if (message.kind === 'op') {
        const op = validateOp(message.op);
        if (!op || op.author !== ctx.from) {
          setRejectedOps((n) => n + 1);
          return;
        }
        if (!authorAllowed(op.author)) {
          setRejectedOps((n) => n + 1);
          logWebRTCEvent('signal', 'annotation-op-rejected', { from: ctx.from, reason: 'no-permission' });
          return;
        }
        applyLocal(op);
        return;
      }
      if (message.kind === 'snapshot-request') {
        const current = stateRef.current;
        if (current.shapes.length === 0) return;
        try {
          bus.publish('annotation', { kind: 'snapshot', shapes: current.shapes, applied: current.applied.slice(-500) } satisfies AnnotationMessage, { to: ctx.from });
        } catch {
          /* snapshot too large for a single frame is dropped; the peer keeps receiving live ops */
        }
        return;
      }
      if (message.kind === 'snapshot') {
        if (!Array.isArray(message.shapes)) return;
        const shapes: AnnotationShape[] = [];
        for (const raw of message.shapes) {
          const shape = validateShape(raw);
          if (shape && authorAllowed(shape.author)) shapes.push(shape);
        }
        const applied = Array.isArray(message.applied) ? message.applied.filter((id) => typeof id === 'string') : [];
        setState((prev) => applySnapshot(prev, shapes, applied));
      }
    });
    // Ask peers for what already exists (late join / reconnect).
    try {
      bus.publish('annotation', { kind: 'snapshot-request' } satisfies AnnotationMessage);
    } catch {
      /* ignore */
    }
    const unsubscribeChannel = bus.onPeerChannel((event) => {
      if (event.state === 'open') {
        try {
          bus.publish('annotation', { kind: 'snapshot-request' } satisfies AnnotationMessage, { to: event.peerId });
        } catch {
          /* ignore */
        }
      }
    });
    return () => {
      unsubscribe();
      unsubscribeChannel();
    };
  }, [enabled, applyLocal, authorAllowed]);

  const send = useCallback(
    (op: AnnotationOp, recordHistory = true) => {
      if (!sessionId) return;
      if (recordHistory) {
        history.push(op, inverseOf(op, stateRef.current, newMessageId));
        setHistoryVersion((v) => v + 1);
      }
      applyLocal(op);
      try {
        getDataBus().publish('annotation', { kind: 'op', op } satisfies AnnotationMessage, { id: op.id });
      } catch (err) {
        logWebRTCEvent('error', 'annotation-publish-failed', { reason: String(err) });
      }
    },
    [applyLocal, history, sessionId],
  );

  const addShape = useCallback(
    (shape: AnnotationShape) => {
      send({ type: 'add', id: newMessageId(), author: sessionId, shape });
    },
    [send, sessionId],
  );

  const removeShapes = useCallback(
    (shapeIds: string[]) => {
      if (shapeIds.length === 0) return;
      send({ type: 'remove', id: newMessageId(), author: sessionId, shapeIds });
    },
    [send, sessionId],
  );

  const clearAll = useCallback(() => {
    if (stateRef.current.shapes.length === 0) return;
    send({ type: 'clear', id: newMessageId(), author: sessionId });
  }, [send, sessionId]);

  const undo = useCallback(() => {
    const op = history.undo();
    setHistoryVersion((v) => v + 1);
    if (op) send({ ...op, author: sessionId }, false);
  }, [history, send, sessionId]);

  const redo = useCallback(() => {
    const op = history.redo();
    setHistoryVersion((v) => v + 1);
    if (op) send({ ...op, author: sessionId }, false);
  }, [history, send, sessionId]);

  return {
    shapes: state.shapes,
    revision: state.revision,
    addShape,
    removeShapes,
    clearAll,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    historyVersion,
    rejectedOps,
  };
}

export type UseAnnotationsReturn = ReturnType<typeof useAnnotations>;
