import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScreenSources } from "./use-screen-sources";
import type { ScreenSource } from "@shared/types";

// A non-blank thumbnail (>64 chars) so the retry-on-blank path doesn't engage.
const THUMB = `data:image/png;base64,${"A".repeat(80)}`;

const sources: ScreenSource[] = [
  { id: "screen:0", name: "Display 1", thumbnail: THUMB, type: "screen" },
  { id: "window:1", name: "Safari", thumbnail: THUMB, type: "window" },
];

afterEach(() => {
  vi.useRealTimers();
});

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

  it("retries while screen thumbnails are blank, then settles on the populated ones", async () => {
    vi.useFakeTimers();
    const blank: ScreenSource[] = [
      { id: "screen:0", name: "Display 1", thumbnail: "data:,", type: "screen" },
    ];
    const full: ScreenSource[] = [
      { id: "screen:0", name: "Display 1", thumbnail: THUMB, type: "screen" },
    ];
    // Blank on the first capture (window still coming forward), populated after.
    const getScreenSources = vi.fn().mockResolvedValueOnce(blank).mockResolvedValue(full);
    window.electronAPI.getScreenSources = getScreenSources;

    const { result } = renderHook(() => useScreenSources());
    await act(async () => {
      const pending = result.current.refresh();
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(getScreenSources).toHaveBeenCalledTimes(2); // blank, then retried → full
    expect(result.current.sources[0].thumbnail).toBe(THUMB);
  });

  it("gives up after a few retries if thumbnails stay blank (never hangs)", async () => {
    vi.useFakeTimers();
    const blank: ScreenSource[] = [
      { id: "screen:0", name: "Display 1", thumbnail: "data:,", type: "screen" },
    ];
    const getScreenSources = vi.fn().mockResolvedValue(blank);
    window.electronAPI.getScreenSources = getScreenSources;

    const { result } = renderHook(() => useScreenSources());
    await act(async () => {
      const pending = result.current.refresh();
      await vi.runAllTimersAsync();
      await pending;
    });

    // Bounded: initial call + BLANK_RETRIES (4) = 5, then it settles (loader clears).
    expect(getScreenSources).toHaveBeenCalledTimes(5);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.sources).toHaveLength(1);
  });

  it("asks for screens only and never retries when thumbnails are not wanted", async () => {
    vi.useFakeTimers();
    // Without thumbnails every one is blank by design — that must not read as
    // "not captured yet" and bring back the 4 × 250 ms loop the call exists to skip.
    const screensOnly: ScreenSource[] = [
      { id: "screen:0", name: "Display 1", thumbnail: "", type: "screen" },
    ];
    const getScreenSources = vi.fn().mockResolvedValue(screensOnly);
    window.electronAPI.getScreenSources = getScreenSources;

    const { result } = renderHook(() => useScreenSources());
    await act(async () => {
      const pending = result.current.refresh({ withThumbnails: false });
      await vi.runAllTimersAsync();
      await pending;
    });

    expect(getScreenSources).toHaveBeenCalledTimes(1);
    expect(getScreenSources).toHaveBeenCalledWith({ withThumbnails: false });
    expect(result.current.sources).toEqual(screensOnly);
  });

  it("keeps the latest list when an earlier, slower call resolves after it", async () => {
    // The screens-only call (on mount) and the picker's full call can overlap. If
    // the quick one landed last it would wipe the picker's windows and thumbnails.
    let resolveFirst: (value: ScreenSource[]) => void = () => {};
    const first = new Promise<ScreenSource[]>((resolve) => {
      resolveFirst = resolve;
    });
    const getScreenSources = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(sources);
    window.electronAPI.getScreenSources = getScreenSources;

    const { result } = renderHook(() => useScreenSources());
    await act(async () => {
      const stale = result.current.refresh({ withThumbnails: false });
      await result.current.refresh();
      resolveFirst([{ id: "screen:0", name: "Display 1", thumbnail: "", type: "screen" }]);
      await stale;
    });

    expect(result.current.sources).toEqual(sources);
    expect(result.current.isLoading).toBe(false);
  });
});
