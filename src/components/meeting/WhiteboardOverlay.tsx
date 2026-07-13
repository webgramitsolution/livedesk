import { useRef, useState, useCallback, useEffect } from 'react';
import { Pencil, Eraser, Trash2, Circle, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';

type Tool = 'pen' | 'eraser';

const COLORS = [
  'hsl(4 80% 49%)',    // destructive-ish red
  'hsl(217 89% 50%)',  // primary blue
  'hsl(140 54% 24%)',  // success green
  'hsl(45 93% 58%)',   // yellow
  'hsl(0 0% 100%)',    // white
];

const SIZES = [2, 4, 8];

export function WhiteboardOverlay({ onClose, portalWindow }: { onClose: () => void; portalWindow?: Window | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[1]);
  const [size, setSize] = useState(SIZES[1]);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const tempData = canvas.toDataURL();
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
    };
    img.src = tempData;
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !lastPos.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === 'eraser' ? 'rgba(0,0,0,1)' : color;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.lineWidth = tool === 'eraser' ? size * 4 : size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => {
    setIsDrawing(false);
    lastPos.current = null;
  };

  const clearCanvas = (e?: React.MouseEvent | React.TouchEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleClose = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearCanvas();
    onClose();
  };

  const shouldPortalToolbar = Boolean(portalWindow?.document?.body);

  const renderToolbar = () => (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className="absolute inset-x-0 top-3 z-30 mx-auto flex w-fit max-w-[calc(100%-1rem)] items-center justify-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-[28px] border border-border bg-background/90 px-3 py-2 backdrop-blur-md control-bar-elevated touch-auto"
    >
      <button
        type="button"
        onClick={() => setTool('pen')}
        className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          tool === 'pen' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
        }`}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setTool('eraser')}
        className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          tool === 'eraser' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
        }`}
      >
        <Eraser className="w-3.5 h-3.5" />
      </button>

      <div className="h-5 w-px shrink-0 bg-border" />

      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => { setColor(c); setTool('pen'); }}
          className={`h-6 w-6 shrink-0 rounded-full border-2 transition-transform ${
            color === c && tool === 'pen' ? 'border-foreground scale-110' : 'border-transparent'
          }`}
          style={{ backgroundColor: c }}
        />
      ))}

      <div className="h-5 w-px shrink-0 bg-border" />

      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSize(s)}
          className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${
            size === s ? 'bg-muted' : 'hover:bg-muted/50'
          }`}
        >
          <Circle className="text-foreground" style={{ width: s + 6, height: s + 6 }} />
        </button>
      ))}

      <div className="h-5 w-px shrink-0 bg-border" />

      <button
        type="button"
        onClick={clearCanvas}
        onTouchEnd={clearCanvas}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20"
        title="Clear annotations"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={handleClose}
        onTouchEnd={handleClose}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
        title="Close annotation"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );

  return (
    <div className="absolute inset-0 z-10">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair touch-none"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
      />

      {!shouldPortalToolbar ? renderToolbar() : null}
      {portalWindow?.document?.body
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 top-3 z-[9999] flex justify-center">
              <div className="pointer-events-auto">{renderToolbar()}</div>
            </div>,
            portalWindow.document.body,
          )
        : null}
    </div>
  );
}
