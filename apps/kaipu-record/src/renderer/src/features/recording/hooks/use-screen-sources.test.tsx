import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScreenSources } from "./use-screen-sources";
import type { ScreenSource } from "@shared/types";

const sources: ScreenSource[] = [
  { id: "screen:0", name: "Display 1", thumbnail: "data:,", type: "screen" },
  { id: "window:1", name: "Safari", thumbnail: "data:,", type: "window" },
];

describe("useScreenSources", () => {
  it("starts empty and loads sources on refresh", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => sources);

    const { result } = renderHook(() => useScreenSources());
    expect(result.current.sources).toEqual([]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sources).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("captures the error and clears sources when the IPC fails", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => {
      throw new Error("denied");
    });

    const { result } = renderHook(() => useScreenSources());
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.sources).toEqual([]);
    expect(result.current.error).toBe("denied");
  });
});
