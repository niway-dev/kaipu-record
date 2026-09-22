import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildCameraPath } from "../zoom/camera-path";
import type { ZoomSegment } from "../zoom/zoom-model";
import { boxCenterAt, CameraBox } from "./camera-box";
import { HoldOriginalButton } from "./hold-original-button";

const FIXED: ZoomSegment = {
  id: "z",
  start: 1,
  end: 4,
  scale: 2,
  mode: "fixed",
  anchor: { x: 0.9, y: 0.5 },
  smoothing: 70,
  origin: "manual",
  trigger: null,
};

function videoAt(t: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", { value: t, writable: true });
  return video;
}

describe("boxCenterAt", () => {
  it("uses the clamped anchor for fixed segments", () => {
    expect(boxCenterAt(FIXED, buildCameraPath([], null, 5), 2)).toEqual({ x: 0.75, y: 0.5 });
  });
  it("follows the simulated camera for follow segments", () => {
    const seg = { ...FIXED, mode: "follow" as const, anchor: null };
    expect(boxCenterAt(seg, buildCameraPath([], null, 5), 2)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("CameraBox", () => {
  it("is sized 1/scale and placed at the anchor", () => {
    render(
      <div>
        <CameraBox
          videoRef={{ current: videoAt(2) }}
          path={buildCameraPath([], null, 5)}
          segment={FIXED}
          onBegin={vi.fn()}
          onMove={vi.fn()}
          onEnd={vi.fn()}
        />
      </div>,
    );
    const box = screen.getByTestId("camera-box");
    expect(box.style.width).toBe("50%");
    expect(box.style.left).toBe("50%");
    expect(screen.getByText("2.0× · LOCKED")).toBeInTheDocument();
  });

  it("drags as begin → move (clamped center) → end", () => {
    const onBegin = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <CameraBox
          videoRef={{ current: videoAt(2) }}
          path={buildCameraPath([], null, 5)}
          segment={FIXED}
          onBegin={onBegin}
          onMove={onMove}
          onEnd={onEnd}
        />
      </div>,
    );
    const stage = container.firstElementChild as HTMLElement;
    stage.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const box = screen.getByTestId("camera-box");
    // The drag starts on an edge strip — the interior is pointer-transparent — and
    // bubbles to the box, which owns the handlers and the pointer capture.
    const edge = box.querySelector('[data-camera-edge="top"]') as HTMLElement;
    fireEvent.pointerDown(edge, { pointerId: 1, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerUp(box, { pointerId: 1 });
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.55, y: 0.75 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends the drag when the pointer capture is lost, and only once", () => {
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <CameraBox
          videoRef={{ current: videoAt(2) }}
          path={buildCameraPath([], null, 5)}
          segment={FIXED}
          onBegin={vi.fn()}
          onMove={vi.fn()}
          onEnd={onEnd}
        />
      </div>,
    );
    const stage = container.firstElementChild as HTMLElement;
    stage.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const box = screen.getByTestId("camera-box");
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 500, clientY: 250 });
    // No pointerup: the gesture is taken away. Without the abort handlers the scene
    // controller would stay `interacting` and every later commit would no-op.
    fireEvent.lostPointerCapture(box, { pointerId: 1 });
    fireEvent.pointerCancel(box, { pointerId: 1 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("HoldOriginalButton", () => {
  it("holds while pressed and shows the chip", () => {
    const onHoldChange = vi.fn();
    const { rerender } = render(<HoldOriginalButton holding={false} onHoldChange={onHoldChange} />);
    const button = screen.getByRole("button", { name: /Hold to see original/ });
    fireEvent.pointerDown(button, { pointerId: 1 });
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    rerender(<HoldOriginalButton holding onHoldChange={onHoldChange} />);
    expect(screen.getByText("ORIGINAL · UNEDITED")).toBeInTheDocument();
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores pointerleave when it is not holding", () => {
    const onHoldChange = vi.fn();
    render(<HoldOriginalButton holding={false} onHoldChange={onHoldChange} />);
    fireEvent.pointerLeave(screen.getByRole("button"), { pointerId: 1 });
    expect(onHoldChange).not.toHaveBeenCalled();
  });

  it("Space holds without reaching window listeners", () => {
    const onHoldChange = vi.fn();
    const windowKey = vi.fn();
    window.addEventListener("keydown", windowKey);
    render(<HoldOriginalButton holding={false} onHoldChange={onHoldChange} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    expect(windowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowKey);
  });
});
