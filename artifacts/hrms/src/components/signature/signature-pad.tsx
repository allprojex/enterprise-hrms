/**
 * WS-26B — SignaturePad.
 *
 * A responsive <canvas> drawn with Pointer Events, so a mouse, a finger on a
 * touchscreen, or a pen/stylus all sign the same way. The controls (Clear,
 * Undo, Confirm) are real, keyboard-operable buttons. The pad ALWAYS starts
 * blank and never silently reuses an earlier drawing: Confirm is disabled until
 * strokes exist, Clear empties it, and unmounting discards everything.
 *
 * On Confirm it emits PNG bytes and the pixel dimensions; it never uploads or
 * applies anything itself — the caller decides what to do with the capture.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Point = { x: number; y: number };
type Stroke = Point[];

const BACKING_WIDTH = 640;
const BACKING_HEIGHT = 220;

export interface SignaturePadProps {
  onConfirm: (png: Blob, dims: { widthPx: number; heightPx: number }) => void;
  onCancel?: () => void;
  disabled?: boolean;
  confirmLabel?: string;
  "data-testid"?: string;
}

export function SignaturePad({ onConfirm, onCancel, disabled, confirmLabel = "Confirm signature", ...rest }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);

  const redraw = useCallback((all: Stroke[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    for (const stroke of all) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      if (stroke.length === 1) ctx.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
      ctx.stroke();
    }
  }, []);

  // Start blank on mount; redraw whenever the stroke set changes (undo/clear).
  useEffect(() => {
    redraw(strokes);
  }, [strokes, redraw]);

  const toBacking = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * BACKING_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * BACKING_HEIGHT;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    drawing.current = [toBacking(e)];
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawing.current) return;
    drawing.current.push(toBacking(e));
    // Live-draw the in-progress stroke without committing to state yet.
    redraw([...strokes, drawing.current]);
  };
  const endStroke = () => {
    if (!drawing.current) return;
    const done = drawing.current;
    drawing.current = null;
    if (done.length > 0) setStrokes((s) => [...s, done]);
  };

  const clear = () => {
    drawing.current = null;
    setStrokes([]);
  };
  const undo = () => {
    drawing.current = null;
    setStrokes((s) => s.slice(0, -1));
  };
  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return;
    redraw(strokes);
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob, { widthPx: BACKING_WIDTH, heightPx: BACKING_HEIGHT });
    }, "image/png");
  };

  const isEmpty = strokes.length === 0;

  return (
    <div className="space-y-3" data-testid={rest["data-testid"] ?? "signature-pad"}>
      <canvas
        ref={canvasRef}
        width={BACKING_WIDTH}
        height={BACKING_HEIGHT}
        role="img"
        aria-label="Signature drawing area"
        data-testid="signature-pad-canvas"
        className="h-40 w-full touch-none rounded-md border border-border-strong bg-surface"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      />
      <p className="text-helper text-foreground-muted">
        Draw your signature above with a mouse, finger or pen. Use Clear to start over — a previous drawing is never reused.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={disabled || isEmpty} data-testid="signature-pad-clear">
          Clear
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={undo} disabled={disabled || isEmpty} data-testid="signature-pad-undo">
          Undo
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={disabled} data-testid="signature-pad-cancel">
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={confirm} disabled={disabled || isEmpty} data-testid="signature-pad-confirm">
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
