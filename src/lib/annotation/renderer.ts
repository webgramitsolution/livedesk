import { normalizedToBox, rectFromPoints, squareFromPoints, type ContentBox } from './geometry';
import type { AnnotationShape } from './types';

/**
 * Paint shapes into a canvas whose CSS size equals the video element. The
 * canvas backing store is scaled by devicePixelRatio for crisp lines.
 */
export function renderShapes(
  canvas: HTMLCanvasElement,
  shapes: AnnotationShape[],
  box: ContentBox,
  dpr: number,
  inProgress?: AnnotationShape | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (box.width <= 0 || box.height <= 0) return;
  for (const shape of shapes) drawShape(ctx, shape, box);
  if (inProgress) drawShape(ctx, inProgress, box);
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: AnnotationShape, box: ContentBox) {
  const pts = shape.points;
  if (pts.length === 0) return;
  const aspect = box.width / Math.max(box.height, 1);
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = Math.max(1, shape.strokeWidth * box.width);
  const p = (n: { x: number; y: number }) => normalizedToBox(n, box);

  switch (shape.tool) {
    case 'pen': {
      ctx.beginPath();
      const first = p(pts[0]);
      ctx.moveTo(first.x, first.y);
      if (pts.length === 1) {
        ctx.lineTo(first.x + 0.01, first.y);
      } else {
        for (let i = 1; i < pts.length; i += 1) {
          const c = p(pts[i]);
          ctx.lineTo(c.x, c.y);
        }
      }
      ctx.stroke();
      break;
    }
    case 'line': {
      if (pts.length < 2) return;
      const a = p(pts[0]);
      const b = p(pts[1]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      if (pts.length < 2) return;
      const a = p(pts[0]);
      const b = p(pts[1]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(10, ctx.lineWidth * 4);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rect':
    case 'square': {
      if (pts.length < 2) return;
      const r = shape.tool === 'square' ? squareFromPoints(pts[0], pts[1], aspect) : rectFromPoints(pts[0], pts[1]);
      const tl = p({ x: r.x, y: r.y });
      ctx.strokeRect(tl.x, tl.y, r.w * box.width, r.h * box.height);
      break;
    }
    case 'circle': {
      if (pts.length < 2) return;
      const r = rectFromPoints(pts[0], pts[1]);
      const c = p({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, Math.max(1, (r.w / 2) * box.width), Math.max(1, (r.h / 2) * box.height), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}
