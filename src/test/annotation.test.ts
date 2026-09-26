import { describe, expect, it } from 'vitest';
import {
  AnnotationHistory,
  EMPTY_ANNOTATION_STATE,
  applyOp,
  applySnapshot,
  clientToNormalized,
  computeContentBox,
  hitTestShape,
  inverseOf,
  squareFromPoints,
  validateOp,
  type AnnotationOp,
  type AnnotationShape,
} from '@/lib/annotation';

let counter = 0;
const nextId = () => `id-${(counter += 1)}`;

const circle = (id: string, author = 'alice'): AnnotationShape => ({
  id,
  author,
  tool: 'circle',
  color: '#ef4444',
  strokeWidth: 0.003,
  points: [
    { x: 0.32, y: 0.21 },
    { x: 0.52, y: 0.36 },
  ],
  createdAt: Date.now(),
});

describe('annotation reducer', () => {
  it('adds, removes, clears and restores shapes', () => {
    let state = applyOp(EMPTY_ANNOTATION_STATE, { type: 'add', id: 'op1', author: 'alice', shape: circle('c1') });
    expect(state.shapes).toHaveLength(1);
    state = applyOp(state, { type: 'add', id: 'op2', author: 'bob', shape: circle('c2', 'bob') });
    expect(state.shapes.map((s) => s.id)).toEqual(['c1', 'c2']);
    state = applyOp(state, { type: 'remove', id: 'op3', author: 'alice', shapeIds: ['c1'] });
    expect(state.shapes.map((s) => s.id)).toEqual(['c2']);
    const before = state;
    state = applyOp(state, { type: 'clear', id: 'op4', author: 'host' });
    expect(state.shapes).toHaveLength(0);
    state = applyOp(state, { type: 'restore', id: 'op5', author: 'host', shapes: before.shapes });
    expect(state.shapes.map((s) => s.id)).toEqual(['c2']);
  });

  it('ignores an op id that was already applied (duplicate via both transports)', () => {
    const op: AnnotationOp = { type: 'add', id: 'dup', author: 'alice', shape: circle('c1') };
    let state = applyOp(EMPTY_ANNOTATION_STATE, op);
    const rev = state.revision;
    state = applyOp(state, op);
    expect(state.shapes).toHaveLength(1);
    expect(state.revision).toBe(rev);
  });

  it('merges a snapshot without duplicating shapes', () => {
    let state = applyOp(EMPTY_ANNOTATION_STATE, { type: 'add', id: 'op1', author: 'alice', shape: circle('c1') });
    state = applySnapshot(state, [circle('c1'), circle('c9', 'bob')], ['op1', 'op9']);
    expect(state.shapes.map((s) => s.id).sort()).toEqual(['c1', 'c9']);
    expect(state.applied).toContain('op9');
  });

  it('undo and redo broadcast inverse ops with fresh ids', () => {
    const history = new AnnotationHistory(nextId);
    let state = EMPTY_ANNOTATION_STATE;
    const add: AnnotationOp = { type: 'add', id: nextId(), author: 'alice', shape: circle('c1') };
    history.push(add, inverseOf(add, state, nextId));
    state = applyOp(state, add);
    const undoOp = history.undo();
    expect(undoOp?.type).toBe('remove');
    state = applyOp(state, undoOp!);
    expect(state.shapes).toHaveLength(0);
    const redoOp = history.redo();
    expect(redoOp?.type).toBe('add');
    expect(redoOp?.id).not.toBe(add.id);
    state = applyOp(state, redoOp!);
    expect(state.shapes.map((s) => s.id)).toEqual(['c1']);
    expect(history.canRedo).toBe(false);
  });

  it('undoing a clear restores every shape', () => {
    const history = new AnnotationHistory(nextId);
    let state = applyOp(EMPTY_ANNOTATION_STATE, { type: 'add', id: nextId(), author: 'alice', shape: circle('c1') });
    state = applyOp(state, { type: 'add', id: nextId(), author: 'bob', shape: circle('c2', 'bob') });
    const clear: AnnotationOp = { type: 'clear', id: nextId(), author: 'host' };
    history.push(clear, inverseOf(clear, state, nextId));
    state = applyOp(state, clear);
    expect(state.shapes).toHaveLength(0);
    state = applyOp(state, history.undo()!);
    expect(state.shapes.map((s) => s.id).sort()).toEqual(['c1', 'c2']);
  });

  it('rejects malformed ops', () => {
    expect(validateOp(null)).toBeNull();
    expect(validateOp({ type: 'add', id: 'x', author: 'a', shape: { ...circle('c'), color: 'red' } })).toBeNull();
    expect(validateOp({ type: 'add', id: 'x', author: 'a', shape: { ...circle('c'), points: [{ x: 2, y: 0 }] } })).toBeNull();
    expect(validateOp({ type: 'add', id: 'x', author: 'a', shape: { ...circle('c'), strokeWidth: 1 } })).toBeNull();
    expect(validateOp({ type: 'nuke', id: 'x', author: 'a' })).toBeNull();
    expect(validateOp({ type: 'remove', id: 'x', author: 'a', shapeIds: ['c'] })).not.toBeNull();
    expect(validateOp({ type: 'remove', id: 'x', author: 'a', shapeIds: [] })).toBeNull();
  });
});

describe('annotation geometry', () => {
  it('computes the content box for letterboxed and pillarboxed video', () => {
    // 16:9 video in a 4:3 element: bars top and bottom.
    const letter = computeContentBox(800, 600, 1920, 1080);
    expect(letter.width).toBe(800);
    expect(letter.height).toBeCloseTo(450);
    expect(letter.y).toBeCloseTo(75);
    // 4:3 video in a 16:9 element: bars left and right.
    const pillar = computeContentBox(1600, 900, 1024, 768);
    expect(pillar.height).toBe(900);
    expect(pillar.width).toBeCloseTo(1200);
    expect(pillar.x).toBeCloseTo(200);
  });

  it('maps client points through the content box so the same normalized point lands on the same pixel of the presentation', () => {
    const box = computeContentBox(800, 600, 1920, 1080); // y offset 75
    const rect = { left: 100, top: 50 };
    // Point at the very top-left of the content.
    expect(clientToNormalized(100, 125, rect, box)).toEqual({ x: 0, y: 0 });
    // Point inside the letterbox bar is outside the presentation.
    expect(clientToNormalized(100, 60, rect, box)).toBeNull();
    // Centre.
    const c = clientToNormalized(500, 350, rect, box)!;
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
    // A second viewer with a different element size resolves the centre identically.
    const box2 = computeContentBox(1280, 1024, 1920, 1080);
    const c2 = clientToNormalized(640, 512, { left: 0, top: 0 }, box2)!;
    expect(c2.x).toBeCloseTo(0.5);
    expect(c2.y).toBeCloseTo(0.5);
  });

  it('keeps squares square in pixel space', () => {
    const aspect = 16 / 9;
    const sq = squareFromPoints({ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.15 }, aspect);
    expect(sq.w).toBeCloseTo(0.2);
    expect(sq.h * aspect).toBeCloseTo(0.2);
  });

  it('hit-tests shapes for the object eraser', () => {
    const shape = circle('c1');
    // On the ellipse boundary (left-most point).
    expect(hitTestShape(shape, { x: 0.32, y: 0.285 }, 0.01, 16 / 9)).toBe(true);
    // Far away.
    expect(hitTestShape(shape, { x: 0.9, y: 0.9 }, 0.01, 16 / 9)).toBe(false);
    const line: AnnotationShape = { ...shape, id: 'l', tool: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(hitTestShape(line, { x: 0.5, y: 0.5 }, 0.005, 1)).toBe(true);
    expect(hitTestShape(line, { x: 0.5, y: 0.7 }, 0.005, 1)).toBe(false);
  });
});
