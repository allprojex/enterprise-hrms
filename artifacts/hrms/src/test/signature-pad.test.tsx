/**
 * WS-26B — SignaturePad.
 *
 * Pins the drawn-signature capture: the pad starts blank, Confirm is disabled
 * until strokes exist, a pointer stroke enables it and emits PNG bytes, and
 * Clear empties the pad so a previous drawing is never silently reused.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SignaturePad } from "@/components/signature/signature-pad";

beforeAll(() => {
  // jsdom has no real canvas encoder; emit a deterministic PNG blob on toBlob.
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  };
  // getContext may be null in jsdom; a no-op 2D context keeps redraw() safe.
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
  })) as unknown as HTMLCanvasElement["getContext"];
});

function drawStroke(canvas: HTMLElement) {
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 40, clientY: 30, pointerId: 1 });
}

describe("SignaturePad", () => {
  it("starts blank with Confirm disabled", () => {
    render(<SignaturePad onConfirm={vi.fn()} />);
    expect(screen.getByTestId("signature-pad-confirm")).toBeDisabled();
    expect(screen.getByTestId("signature-pad-clear")).toBeDisabled();
  });

  it("a pointer stroke enables Confirm and emits PNG bytes", async () => {
    const onConfirm = vi.fn();
    render(<SignaturePad onConfirm={onConfirm} />);
    drawStroke(screen.getByTestId("signature-pad-canvas"));
    const confirm = screen.getByTestId("signature-pad-confirm");
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [blob, dims] = onConfirm.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(dims.widthPx).toBeGreaterThan(0);
    expect(dims.heightPx).toBeGreaterThan(0);
  });

  it("Clear empties the pad so a previous drawing is never reused", () => {
    const onConfirm = vi.fn();
    render(<SignaturePad onConfirm={onConfirm} />);
    const canvas = screen.getByTestId("signature-pad-canvas");
    drawStroke(canvas);
    expect(screen.getByTestId("signature-pad-confirm")).toBeEnabled();
    fireEvent.click(screen.getByTestId("signature-pad-clear"));
    // Back to blank: Confirm disabled, and confirming does nothing.
    expect(screen.getByTestId("signature-pad-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("signature-pad-confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not reuse a prior stroke set across a fresh mount", () => {
    const first = render(<SignaturePad onConfirm={vi.fn()} />);
    drawStroke(screen.getByTestId("signature-pad-canvas"));
    first.unmount();
    render(<SignaturePad onConfirm={vi.fn()} />);
    // A newly mounted pad is blank regardless of the earlier drawing.
    expect(screen.getByTestId("signature-pad-confirm")).toBeDisabled();
  });
});
