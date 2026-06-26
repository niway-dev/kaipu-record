import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingActivity } from "@shared/types";
import { useRecordingActivity } from "./use-recording-activity";

describe("useRecordingActivity", () => {
  let listeners: Array<(state: RecordingActivity) => void>;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listeners = [];
    unsubscribe = vi.fn();
    window.electronAPI.getRecordingState = vi.fn(async () => ({
      active: false,
      status: "recording",
    }));
    window.electronAPI.onRecordingState = vi.fn((callback) => {
      listeners.push(callback);
      return unsubscribe;
    });
  });

  it("starts idle, then adopts the state queried on mount", async () => {
    window.electronAPI.getRecordingState = vi.fn(async () => ({ active: true, status: "paused" }));
    const { result } = renderHook(() => useRecordingActivity());
    expect(result.current).toEqual({ active: false, status: "recording" }); // before the query resolves
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(result.current.status).toBe("paused");
  });

  it("updates when the hub broadcasts a change", async () => {
    const { result } = renderHook(() => useRecordingActivity());
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0]({ active: true, status: "recording" }));
    expect(result.current).toEqual({ active: true, status: "recording" });
    act(() => listeners[0]({ active: false, status: "recording" }));
    expect(result.current.active).toBe(false);
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => useRecordingActivity());
    await waitFor(() => expect(listeners).toHaveLength(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
