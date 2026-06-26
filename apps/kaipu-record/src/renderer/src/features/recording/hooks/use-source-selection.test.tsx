import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ScreenSource } from "@shared/types";

// useRecordingSetup pulls in device enumeration; stub it so the harness never
// touches navigator.mediaDevices (absent in jsdom).
vi.mock("@renderer/features/recording/hooks/use-microphones", () => ({
  useMicrophones: () => [],
}));

import { useRecordingSetup } from "./use-recording-setup";
import { useSourceSelection } from "./use-source-selection";

// Drive the shared default-selection logic against the real recording setup,
// exactly as the Record page and Capture Panel do.
function useHarness(): {
  setup: ReturnType<typeof useRecordingSetup>;
  sources: ReturnType<typeof useSourceSelection>;
} {
  const setup = useRecordingSetup();
  const sources = useSourceSelection(setup);
  return { setup, sources };
}

const screen1: ScreenSource = {
  id: "screen:0",
  name: "Screen 1",
  thumbnail: "data:,",
  type: "screen",
};
const screen2: ScreenSource = {
  id: "screen:1",
  name: "Screen 2",
  thumbnail: "data:,",
  type: "screen",
};
const safari: ScreenSource = {
  id: "window:9",
  name: "Safari",
  thumbnail: "data:,",
  type: "window",
};

afterEach(() => vi.restoreAllMocks());

describe("useSourceSelection", () => {
  it("loads sources on mount and defaults to the first screen", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => [screen1, screen2, safari]);

    const { result } = renderHook(() => useHarness());
    expect(result.current.setup.selectedSource).toBeNull();

    await waitFor(() => {
      expect(result.current.setup.selectedSource).toEqual({
        id: "screen:0",
        name: "Screen 1",
        type: "screen",
      });
    });
    expect(result.current.sources.sources).toHaveLength(3);
    expect(result.current.setup.canStartRecording).toBe(true);
  });

  it("prefers a screen over a window even when a window is listed first", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => [safari, screen2]);

    const { result } = renderHook(() => useHarness());

    await waitFor(() => {
      expect(result.current.setup.selectedSource?.id).toBe("screen:1");
    });
  });

  it("falls back to the first source when none is a screen", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => [safari]);

    const { result } = renderHook(() => useHarness());

    await waitFor(() => {
      expect(result.current.setup.selectedSource?.id).toBe("window:9");
    });
  });

  it("does not override a source the user already picked", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => [screen1]);

    const { result } = renderHook(() => useHarness());
    // Pick a window before the (async) source list resolves.
    act(() =>
      result.current.setup.selectSource({ id: "window:9", name: "Safari", type: "window" }),
    );

    await waitFor(() => expect(result.current.sources.sources).toHaveLength(1));
    expect(result.current.setup.selectedSource?.id).toBe("window:9");
  });

  it("stays unselected and surfaces the error when enumeration fails", async () => {
    window.electronAPI.getScreenSources = vi.fn(async () => {
      throw new Error("denied");
    });

    const { result } = renderHook(() => useHarness());

    await waitFor(() => expect(result.current.sources.error).toBe("denied"));
    expect(result.current.setup.selectedSource).toBeNull();
    expect(result.current.setup.canStartRecording).toBe(false);
  });
});
