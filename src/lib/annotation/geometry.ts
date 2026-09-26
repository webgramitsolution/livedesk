import type { AnnotationShape, NormPoint } from './types';

export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the video content is actually painted inside its element for
 * `object-fit: contain`. Accounts for letterboxing (bars top/bottom) and
 * pillarboxing (bars left/right). All values in CSS pixels relative to the
 * element's own box.
 */
export function computeContentBox(
  elementWidth: number,
  elementHeight: number,
  intrinsicWidth: number,
  intrinsicHeight: number,
): ContentBox {
  if (elementWidth <= 0 || elementHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    return { x: 0, y: 0, width: elementWidth, height: elementHeight };
  }
  const elementRatio = elementWidth / elementHeight;
  const intrinsicRatio = intrinsicWidth / intrinsicHeight;
  if (intrinsicRatio > elementRatio) {
    // Wider than the element: full width, bars top and bottom.
    const height = elementWidth / intrinsicRatio;
    return { x: 0, y: (elementHeight - height) / 2, width: elementWidth, height };
  }
  // Taller than the element: full height, bars left and right.
  const width = elementHeight * intrinsicRatio;
  return { x: (elementWidth - width) / 2, y: 0, width, height: elementHeight };
}

/** Convert a client-space point into normalized presentation coordinates, or null when outside the content. */
export function clientToNormalized(
  clientX: number,
  clientY: number,
  elementRect: { left: number; top: number },
  box: ContentBox,
  clamp = false,
): NormPoint | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const px = clientX - elementRect.left - box.x;
  const py = clientY - elementRect.top - box.y;
  let x = px / box.width;
  let y = py / box.height;
  if (clamp) {
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
  } else if (x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
}

/** Normalized point to CSS pixels inside the content box. */
export function normalizedToBox(point: NormPoint, box: ContentBox): { x: number; y: number } {
  return { x: box.x + point.x * box.width, y: box.y + point.y * box.height };
}

/** Rectangle from two normalized corners (handles dragging in any direction). */
export function rectFromPoints(a: NormPoint, b: NormPoint) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/**
 * Square: equal side lengths in *pixel* space (so it looks square on screen),
 * which means the normalized height is scaled by the presentation aspect ratio.
 */
export function squareFromPoints(a: NormPoint, b: NormPoint, aspect: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Side in normalized-x units; convert dy to x units using the aspect ratio.
  const side = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  const end = { x: a.x + sx * side, y: a.y + (sy * side) / aspect };
  return rectFromPoints(a, end);
}

function distancePointToSegment(p: NormPoint, a: NormPoint, b: NormPoint, aspect: number): number {
  // Work in an aspect-corrected space so distances are visually uniform.
  const ax = a.x * aspect;
  const bx = b.x * aspect;
  const px = p.x * aspect;
  const dx = bx - ax;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, p.y - cy);
}

/**
 * Hit-test a normalized point against a shape. `tolerance` is in normalized-x
 * units (aspect-corrected). Used by the object eraser.
 */
export function hitTestShape(shape: AnnotationShape, p: NormPoint, tolerance: number, aspect: number): boolean {
  const tol = tolerance + shape.strokeWidth / 2;
  const pts = shape.points;
  if (pts.length === 0) return false;
  switch (shape.tool) {
    case 'pen': {
      if (pts.length === 1) return Math.hypot((pts[0].x - p.x) * aspect, pts[0].y - p.y) <= tol;
      for (let i = 1; i < pts.length; i += 1) {
        if (distancePointToSegment(p, pts[i - 1], pts[i], aspect) <= tol) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return pts.length >= 2 && distancePointToSegment(p, pts[0], pts[1], aspect) <= tol;
    case 'rect':
    case 'square': {
      if (pts.length < 2) return false;
      const r = shape.tool === 'square' ? squareFromPoints(pts[0], pts[1], aspect) : rectFromPoints(pts[0], pts[1]);
      const corners = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
      ];
      for (let i = 0; i < 4; i += 1) {
        if (distancePointToSegment(p, corners[i], corners[(i + 1) % 4], aspect) <= tol) return true;
      }
      return false;
    }
    case 'circle': {
      if (pts.length < 2) return false;
      const r = rectFromPoints(pts[0], pts[1]);
      const cx = (r.x + r.w / 2) * aspect;
      const cy = r.y + r.h / 2;
      const rx = Math.max((r.w / 2) * aspect, 1e-6);
      const ry = Math.max(r.h / 2, 1e-6);
      // Distance to ellipse boundary approximated radially.
      const dx = p.x * aspect - cx;
      const dy = p.y - cy;
      const angle = Math.atan2(dy / ry, dx / rx);
      const ex = cx + rx * Math.cos(angle);
      const ey = cy + ry * Math.sin(angle);
      return Math.hypot(p.x * aspect - ex, p.y - ey) <= tol;
    }
    default:
      return false;
  }
}
