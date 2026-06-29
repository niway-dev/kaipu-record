import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUpdateStatus } from "./use-update-status";
import type { UpdateStatus } from "@shared/types";

describe("useUpdateStatus", () => {
  it("seeds from getUpdateStatus on mount", async () => {
    window.electronAPI.getUpdateStatus = async () => ({ state: "ready", version: "1.2.0" });
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "ready", version: "1.2.0" }));
  });

  it("updates when an onUpdateStatus event fires", async () => {
    let emit: ((s: UpdateStatus) => void) | null = null;
    window.electronAPI.getUpdateStatus = async () => ({ state: "idle" });
    window.electronAPI.onUpdateStatus = (cb) => {
      emit = cb;
      return () => {};
    };
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toEqual({ state: "idle" }));
    act(() => emit?.({ state: "ready", version: "2.0.0" }));
    expect(result.current).toEqual({ state: "ready", version: "2.0.0" });
  });
});
