import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { cameraAt } from "./camera-path";
import { useCameraPath } from "./use-camera-path";
import type { ZoomSegment } from "./zoom-model";

const seg = (scale: number): ZoomSegment => ({
  id: "z",
  start: 0,
  end: 4,
  scale,
  mode: "fixed",
  anchor: { x: 0.5, y: 0.5 },
  smoothing: 0,
  origin: "manual",
  trigger: null,
});

/** requestAnimationFrame under our control, so "one rebuild per frame" is observable. */
function manualFrames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    pending: () => queue.length,
    flush: () => {
      for (const cb of queue.splice(0)) cb(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useCameraPath", () => {
  it("builds synchronously on mount", () => {
    manualFrames();
    const { result } = renderHook(() => useCameraPath([seg(2)], null, 4));
    expect(cameraAt(result.current, 3).scale).toBeGreaterThan(1);
  });

  it("coalesces a burst of live updates into one rebuild of the last inputs", () => {
    const frames = manualFrames();
    const { result, rerender } = renderHook(({ segments }) => useCameraPath(segments, null, 4), {
      initialProps: { segments: [] as ZoomSegment[] },
    });
    const first = result.current;

    // Three pointermove ticks inside one frame — the hook must schedule exactly once.
    rerender({ segments: [seg(1.5)] });
    rerender({ segments: [seg(2)] });
    rerender({ segments: [seg(3)] });
    expect(frames.pending()).toBe(1);
    expect(result.current).toBe(first); // still the previous path, not yet rebuilt

    act(() => frames.flush());
    expect(result.current).not.toBe(first);
    // The LAST inputs won; the intermediate scales were skipped, not queued.
    expect(cameraAt(result.current, 3).scale).toBeCloseTo(3, 5);
    expect(frames.pending()).toBe(0);
  });
});
