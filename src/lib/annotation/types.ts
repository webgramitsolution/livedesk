// Collaborative annotation model. Every coordinate is normalized to the shared
// presentation (0..1 on both axes) so drawings line up on any resolution or
// aspect ratio. Stroke width is normalized to the presentation width.

export type AnnotationTool = 'pen' | 'line' | 'arrow' | 'rect' | 'square' | 'circle' | 'eraser';

export interface NormPoint {
  x: number;
  y: number;
}

export interface AnnotationShape {
  id: string;
  /** Session id of the author. */
  author: string;
  tool: Exclude<AnnotationTool, 'eraser'>;
  color: string;
  /** Stroke width as a fraction of the presentation width (e.g. 0.003). */
  strokeWidth: number;
  /** Pen: polyline points. Other tools: [start, end]. */
  points: NormPoint[];
  createdAt: number;
}

export type AnnotationOp =
  | { type: 'add'; id: string; author: string; shape: AnnotationShape }
  | { type: 'remove'; id: string; author: string; shapeIds: string[] }
  | { type: 'restore'; id: string; author: string; shapes: AnnotationShape[] }
  | { type: 'clear'; id: string; author: string };

export interface AnnotationState {
  /** Insertion-ordered shapes. */
  shapes: AnnotationShape[];
  /** Op ids already applied (for de-duplication across paths and snapshots). */
  applied: string[];
  /** Monotonic revision for change detection. */
  revision: number;
}

/** Wire messages on the `annotation` data-plane topic. */
export type AnnotationMessage =
  | { kind: 'op'; op: AnnotationOp }
  | { kind: 'snapshot-request' }
  | { kind: 'snapshot'; shapes: AnnotationShape[]; applied: string[] };

export const EMPTY_ANNOTATION_STATE: AnnotationState = { shapes: [], applied: [], revision: 0 };

export const ANNOTATION_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // violet
  '#ffffff', // white
  '#111827', // near black
] as const;

/** Stroke widths as fractions of the presentation width (thin, normal, bold). */
export const ANNOTATION_STROKES = [0.0015, 0.003, 0.006] as const;

export const MAX_SHAPES = 2000;
export const MAX_POINTS_PER_SHAPE = 4000;
