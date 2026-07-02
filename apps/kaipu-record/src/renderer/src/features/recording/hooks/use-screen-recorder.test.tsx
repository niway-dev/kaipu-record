import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const listeners = new Set<() => void>();
let snapshot: { status: string; countdown: number | null } = { status: "idle", countdown: null };

vi.mock("@renderer/features/recording/recorder-store", () => ({
  subscribeRecorder: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  // useSyncExternalStore compares snapshots with Object.is — a fresh object
  // per call (mirroring the real store's update()) is required for a mutation
  // to be seen as a change and trigger a re-render.
  getRecorderSnapshot: () => snapshot,
  requestStartRecording: vi.fn(),
  stopOrCancelRecording: vi.fn(),
  pauseRecording: vi.fn(),
  resumeRecording: vi.fn(),
}));

import { useScreenRecorder } from "./use-screen-recorder";
import {
  requestStartRecording,
  stopOrCancelRecording,
  pauseRecording,
  resumeRecording,
} from "@renderer/features/recording/recorder-store";

describe("useScreenRecorder", () => {
  it("reflects the store's snapshot and re-renders when it changes", () => {
    const { result } = renderHook(() => useScreenRecorder());
    expect(result.current.status).toBe("idle");
    expect(result.current.countdown).toBeNull();

    act(() => {
      snapshot = { status: "counting", countdown: 3 };
      for (const listener of listeners) listener();
    });

    expect(result.current.status).toBe("counting");
    expect(result.current.countdown).toBe(3);
  });

  it("delegates its controls straight to the store", () => {
    const { result } = renderHook(() => useScreenRecorder());
    const resolveInput = vi.fn();

    result.current.requestStart(resolveInput);
    expect(requestStartRecording).toHaveBeenCalledWith(resolveInput);

    result.current.stopOrCancel();
    expect(stopOrCancelRecording).toHaveBeenCalledOnce();

    result.current.pause();
    expect(pauseRecording).toHaveBeenCalledOnce();

    result.current.resume();
    expect(resumeRecording).toHaveBeenCalledOnce();
  });
});
