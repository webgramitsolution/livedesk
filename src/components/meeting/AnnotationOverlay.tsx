import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Minus,
  Pencil,
  Redo2,
  Square,
  RectangleHorizontal,
  Trash2,
  Undo2,
  X,
  Palette,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { newMessageId } from '@/lib/dataPlane';
import {
  ANNOTATION_COLORS,
  ANNOTATION_STROKES,
  clientToNormalized,
  hitTestShape,
  renderShapes,
  type AnnotationShape,
  type AnnotationTool,
  type NormPoint,
} from '@/lib/annotation';
import type { UseAnnotationsReturn } from '@/hooks/useAnnotations';
import { useVideoContentBox } from '@/hooks/useVideoContentBox';

interface AnnotationOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  annotations: UseAnnotationsReturn;
  /** Local session id (author of new shapes). */
  sessionId: string;
  /** Drawing mode on/off (from the bottom toolbar). */
  active: boolean;
  onSetActive: (active: boolean) => void;
  /** Whether the local participant may draw. */
  canAnnotate: boolean;
  /** Whether the local participant may clear everyone's drawings (host or presenter). */
  canClearAll: boolean;
  /** Human-readable reason shown when drawing is not allowed. */
  disabledReason?: string;
}

const TOOLS: Array<{ tool: AnnotationTool; label: string; Icon: typeof Pencil }> = [
  { tool: 'pen', label: 'Pen', Icon: Pencil },
  { tool: 'line', label: 'Line', Icon: Minus },
  { tool: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
  { tool: 'rect', label: 'Rectangle', Icon: RectangleHorizontal },
  { tool: 'square', label: 'Square', Icon: Square },
  { tool: 'circle', label: 'Circle', Icon: Circle },
  { tool: 'eraser', label: 'Eraser', Icon: Eraser },
];

const PEN_MIN_DISTANCE = 0.0025;
const ERASER_TOLERANCE = 0.008;

/**
 * Transparent vector overlay drawn over the presentation video. It never
 * touches the presenter's desktop; it is a local canvas synchronized by ops.
 * The toolbar stays hidden until the pointer hovers the presentation or
 * drawing mode is active, and it is intentionally compact.
 */
export function AnnotationOverlay({
  videoRef,
  annotations,
  sessionId,
  active,
  onSetActive,
  canAnnotate,
  canClearAll,
  disabledReason,
}: AnnotationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { box, elementSize, dpr } = useVideoContentBox(videoRef);
  const [tool, setTool] = useState<AnnotationTool>('pen');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [stroke, setStroke] = useState<number>(ANNOTATION_STROKES[1]);
  const [showStyle, setShowStyle] = useState(false);
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState<AnnotationShape | null>(null);
  const draftRef = useRef<AnnotationShape | null>(null);
  const pendingEraseRef = useRef<Set<string>>(new Set());
  const [pendingEraseVersion, setPendingEraseVersion] = useState(0);
  const pointerIdRef = useRef<number | null>(null);

  const drawing = active && canAnnotate;
  const aspect = box.width / Math.max(box.height, 1);

  const visibleShapes = useMemo(() => {
    if (pendingEraseRef.current.size === 0) return annotations.shapes;
    return annotations.shapes.filter((s) => !pendingEraseRef.current.has(s.id));
    // pendingEraseVersion bumps when the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations.shapes, pendingEraseVersion]);

  // Render whenever shapes, draft or geometry change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.round(elementSize.width * dpr));
    const h = Math.max(1, Math.round(elementSize.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    renderShapes(canvas, visibleShapes, box, dpr, draft);
  }, [visibleShapes, draft, box, elementSize, dpr]);

  const toNorm = useCallback(
    (clientX: number, clientY: number, clamp: boolean): NormPoint | null => {
      const video = videoRef.current;
      if (!video) return null;
      const rect = video.getBoundingClientRect();
      return clientToNormalized(clientX, clientY, { left: rect.left, top: rect.top }, box, clamp);
    },
    [box, videoRef],
  );

  const eraseAt = useCallback(
    (p: NormPoint) => {
      let changed = false;
      for (const shape of annotations.shapes) {
        if (pendingEraseRef.current.has(shape.id)) continue;
        if (hitTestShape(shape, p, ERASER_TOLERANCE, aspect)) {
          pendingEraseRef.current.add(shape.id);
          changed = true;
        }
      }
      if (changed) setPendingEraseVersion((v) => v + 1);
    },
    [annotations.shapes, aspect],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing || e.button !== 0) return;
      const p = toNorm(e.clientX, e.clientY, false);
      if (!p) return;
      e.preventDefault();
      pointerIdRef.current = e.pointerId;
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      if (tool === 'eraser') {
        pendingEraseRef.current = new Set();
        eraseAt(p);
        return;
      }
      const shape: AnnotationShape = {
        id: newMessageId(),
        author: sessionId,
        tool,
        color,
        strokeWidth: stroke,
        points: tool === 'pen' ? [p] : [p, p],
        createdAt: Date.now(),
      };
      draftRef.current = shape;
      setDraft(shape);
    },
    [color, drawing, eraseAt, sessionId, stroke, toNorm, tool],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const p = toNorm(e.clientX, e.clientY, true);
      if (!p) return;
      if (tool === 'eraser') {
        eraseAt(p);
        return;
      }
      const current = draftRef.current;
      if (!current) return;
      let next: AnnotationShape;
      if (current.tool === 'pen') {
        const last = current.points[current.points.length - 1];
        if (Math.hypot((p.x - last.x) * aspect, p.y - last.y) < PEN_MIN_DISTANCE) return;
        next = { ...current, points: [...current.points, p] };
      } else {
        next = { ...current, points: [current.points[0], p] };
      }
      draftRef.current = next;
      setDraft(next);
    },
    [aspect, eraseAt, toNorm, tool],
  );

  const finish = useCallback(() => {
    pointerIdRef.current = null;
    if (tool === 'eraser') {
      const ids = Array.from(pendingEraseRef.current);
      pendingEraseRef.current = new Set();
      setPendingEraseVersion((v) => v + 1);
      annotations.removeShapes(ids);
      return;
    }
    const shape = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!shape) return;
    if (shape.tool !== 'pen') {
      const [a, b] = shape.points;
      if (Math.hypot((a.x - b.x) * aspect, a.y - b.y) < 0.004) return; // accidental click
    }
    annotations.addShape(shape);
  }, [annotations, aspect, tool]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      finish();
    },
    [finish],
  );

  // Escape leaves drawing mode; Ctrl/Cmd+Z / Shift+Z undo/redo while drawing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSetActive(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) annotations.redo();
        else annotations.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, annotations, onSetActive]);

  const showToolbar = active || hover;

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: 'none' }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      data-testid="annotation-overlay"
      data-annotation-active={drawing ? 'true' : 'false'}
    >
      <canvas
        ref={canvasRef}
        data-testid="annotation-canvas"
        className={cn('absolute inset-0 h-full w-full', drawing ? 'touch-none' : '')}
        style={{
          width: elementSize.width || '100%',
          height: elementSize.height || '100%',
          pointerEvents: drawing ? 'auto' : 'none',
          cursor: drawing ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Hover-sensing strip so the toolbar can appear without the canvas capturing input. */}
      <div className="absolute inset-x-0 top-0 h-16" style={{ pointerEvents: 'auto' }} aria-hidden="true" />

      <AnimatePresence>
        {showToolbar && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-2 z-20 -translate-x-1/2"
            style={{ pointerEvents: 'auto' }}
            data-testid="annotation-toolbar"
            role="toolbar"
            aria-label="Annotation tools"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-background/95 px-1.5 py-1 shadow-lg backdrop-blur">
              {!active ? (
                <button
                  type="button"
                  onClick={() => onSetActive(true)}
                  disabled={!canAnnotate}
                  title={canAnnotate ? 'Annotate the presentation' : disabledReason ?? 'Annotation is not allowed'}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  data-testid="annotation-enter"
                >
                  <Pencil className="h-3.5 w-3.5" /> Annotate
                </button>
              ) : (
                <>
                  {TOOLS.map(({ tool: t, label, Icon }) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTool(t)}
                      title={label}
                      aria-label={label}
                      aria-pressed={tool === t}
                      data-testid={`annotation-tool-${t}`}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                        tool === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                  <span className="mx-0.5 h-4 w-px bg-border" />
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowStyle((v) => !v)}
                      title="Colour and stroke"
                      aria-label="Colour and stroke"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <Palette className="h-3.5 w-3.5" style={{ color }} />
                    </button>
                    {showStyle && (
                      <div className="absolute left-1/2 top-9 z-30 flex -translate-x-1/2 flex-col gap-2 rounded-xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur">
                        <div className="flex items-center gap-1">
                          {ANNOTATION_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setColor(c)}
                              title={c}
                              aria-label={`Colour ${c}`}
                              className={cn('h-5 w-5 rounded-full border-2', color === c ? 'border-foreground scale-110' : 'border-transparent')}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          {ANNOTATION_STROKES.map((s, i) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStroke(s)}
                              title={['Thin', 'Normal', 'Bold'][i]}
                              aria-label={`Stroke ${['thin', 'normal', 'bold'][i]}`}
                              className={cn('flex h-6 w-8 items-center justify-center rounded-md', stroke === s ? 'bg-muted' : 'hover:bg-muted/60')}
                            >
                              <span className="rounded-full bg-foreground" style={{ width: 16, height: 2 + i * 2 }} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="mx-0.5 h-4 w-px bg-border" />
                  <button
                    type="button"
                    onClick={annotations.undo}
                    disabled={!annotations.canUndo}
                    title="Undo (Ctrl+Z)"
                    aria-label="Undo"
                    data-testid="annotation-undo"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={annotations.redo}
                    disabled={!annotations.canRedo}
                    title="Redo (Ctrl+Shift+Z)"
                    aria-label="Redo"
                    data-testid="annotation-redo"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                  </button>
                  {canClearAll && (
                    <button
                      type="button"
                      onClick={annotations.clearAll}
                      title="Clear all annotations"
                      aria-label="Clear all annotations"
                      data-testid="annotation-clear"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSetActive(false)}
                    title="Exit annotation (Esc)"
                    aria-label="Exit annotation"
                    data-testid="annotation-exit"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
