import {
  EMPTY_ANNOTATION_STATE,
  MAX_POINTS_PER_SHAPE,
  MAX_SHAPES,
  type AnnotationOp,
  type AnnotationShape,
  type AnnotationState,
  type NormPoint,
} from './types';

const APPLIED_MAX = 5000;

const isNum01 = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -0.05 && v <= 1.05;
const isPoint = (v: unknown): v is NormPoint => !!v && typeof v === 'object' && isNum01((v as NormPoint).x) && isNum01((v as NormPoint).y);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const TOOLS = new Set(['pen', 'line', 'arrow', 'rect', 'square', 'circle']);

/** Strict validation of anything that claims to be a shape. */
export function validateShape(raw: unknown): AnnotationShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!isId(s.id) || !isId(s.author)) return null;
  if (typeof s.tool !== 'string' || !TOOLS.has(s.tool)) return null;
  if (typeof s.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.color)) return null;
  if (typeof s.strokeWidth !== 'number' || !Number.isFinite(s.strokeWidth) || s.strokeWidth <= 0 || s.strokeWidth > 0.05) return null;
  if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > MAX_POINTS_PER_SHAPE) return null;
  if (!s.points.every(isPoint)) return null;
  if (typeof s.createdAt !== 'number' || !Number.isFinite(s.createdAt)) return null;
  return {
    id: s.id,
    author: s.author,
    tool: s.tool as AnnotationShape['tool'],
    color: s.color,
    strokeWidth: s.strokeWidth,
    points: (s.points as NormPoint[]).map((p) => ({ x: p.x, y: p.y })),
    createdAt: s.createdAt,
  };
}

/** Strict validation of an inbound op. Returns null for anything malformed. */
export function validateOp(raw: unknown): AnnotationOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isId(o.id) || !isId(o.author)) return null;
  switch (o.type) {
    case 'add': {
      const shape = validateShape(o.shape);
      if (!shape) return null;
      return { type: 'add', id: o.id, author: o.author, shape };
    }
    case 'remove':
      if (!Array.isArray(o.shapeIds) || o.shapeIds.length === 0 || o.shapeIds.length > MAX_SHAPES || !o.shapeIds.every(isId)) return null;
      return { type: 'remove', id: o.id, author: o.author, shapeIds: o.shapeIds as string[] };
    case 'restore': {
      if (!Array.isArray(o.shapes) || o.shapes.length > MAX_SHAPES) return null;
      const shapes: AnnotationShape[] = [];
      for (const s of o.shapes) {
        const v = validateShape(s);
        if (!v) return null;
        shapes.push(v);
      }
      return { type: 'restore', id: o.id, author: o.author, shapes };
    }
    case 'clear':
      return { type: 'clear', id: o.id, author: o.author };
    default:
      return null;
  }
}

/**
 * Pure reducer. Applying the same op id twice is a no-op, so a message that
 * arrives via both the data channel and the fallback path cannot duplicate.
 */
export function applyOp(state: AnnotationState, op: AnnotationOp): AnnotationState {
  if (state.applied.includes(op.id)) return state;
  const applied = state.applied.length >= APPLIED_MAX ? [...state.applied.slice(-APPLIED_MAX / 2), op.id] : [...state.applied, op.id];
  switch (op.type) {
    case 'add': {
      if (state.shapes.some((s) => s.id === op.shape.id)) return { ...state, applied };
      const shapes = [...state.shapes, op.shape];
      if (shapes.length > MAX_SHAPES) shapes.splice(0, shapes.length - MAX_SHAPES);
      return { shapes, applied, revision: state.revision + 1 };
    }
    case 'remove': {
      const ids = new Set(op.shapeIds);
      const shapes = state.shapes.filter((s) => !ids.has(s.id));
      if (shapes.length === state.shapes.length) return { ...state, applied };
      return { shapes, applied, revision: state.revision + 1 };
    }
    case 'restore': {
      const existing = new Set(state.shapes.map((s) => s.id));
      const toAdd = op.shapes.filter((s) => !existing.has(s.id));
      if (toAdd.length === 0) return { ...state, applied };
      const shapes = [...state.shapes, ...toAdd].sort((a, b) => a.createdAt - b.createdAt);
      return { shapes, applied, revision: state.revision + 1 };
    }
    case 'clear':
      if (state.shapes.length === 0) return { ...state, applied };
      return { shapes: [], applied, revision: state.revision + 1 };
    default:
      return state;
  }
}

export function applyOps(state: AnnotationState, ops: AnnotationOp[]): AnnotationState {
  return ops.reduce(applyOp, state);
}

/** Merge a snapshot from a peer: shapes we do not have are added, ids recorded. */
export function applySnapshot(state: AnnotationState, shapes: AnnotationShape[], applied: string[]): AnnotationState {
  const existing = new Set(state.shapes.map((s) => s.id));
  const merged = [...state.shapes, ...shapes.filter((s) => !existing.has(s.id))].sort((a, b) => a.createdAt - b.createdAt);
  const appliedSet = new Set([...state.applied, ...applied]);
  return { shapes: merged, applied: Array.from(appliedSet).slice(-APPLIED_MAX), revision: state.revision + 1 };
}

export interface HistoryEntry {
  /** The op we sent. */
  op: AnnotationOp;
  /** The op that undoes it. */
  inverse: AnnotationOp;
}

/**
 * Per-author undo/redo history. Only the author's own actions are undoable;
 * every undo/redo is itself a normal op broadcast to everyone.
 */
export class AnnotationHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private limit = 200;

  constructor(private newId: () => string) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Record a sent op together with its inverse, clearing redo. */
  push(op: AnnotationOp, inverse: AnnotationOp) {
    this.undoStack.push({ op, inverse });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the op to broadcast (a fresh id every time) or null. */
  undo(): AnnotationOp | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { ...entry.inverse, id: this.newId() };
  }

  redo(): AnnotationOp | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { ...entry.op, id: this.newId() };
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/** Build the inverse of an op given the state it was applied to. */
export function inverseOf(op: AnnotationOp, before: AnnotationState, newId: () => string): AnnotationOp {
  switch (op.type) {
    case 'add':
      return { type: 'remove', id: newId(), author: op.author, shapeIds: [op.shape.id] };
    case 'remove': {
      const ids = new Set(op.shapeIds);
      const shapes = before.shapes.filter((s) => ids.has(s.id));
      return { type: 'restore', id: newId(), author: op.author, shapes };
    }
    case 'restore':
      return { type: 'remove', id: newId(), author: op.author, shapeIds: op.shapes.map((s) => s.id) };
    case 'clear':
      return { type: 'restore', id: newId(), author: op.author, shapes: before.shapes };
    default:
      return op;
  }
}

export { EMPTY_ANNOTATION_STATE };
