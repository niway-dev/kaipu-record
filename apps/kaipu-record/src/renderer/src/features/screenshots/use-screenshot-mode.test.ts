import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { useScreenshotMode } from "./use-screenshot-mode";

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

function withStoredMode(mode: AppSettings["screenshotMode"]) {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, screenshotMode: mode };
  const updateSettings = vi.fn(async (patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  window.electronAPI = { ...realApi, getSettings: async () => settings, updateSettings };
  return updateSettings;
}

describe("useScreenshotMode", () => {
  it("reads the stored current mode", async () => {
    withStoredMode("frame");
    const { result } = renderHook(() => useScreenshotMode());
    expect(result.current.mode).toBe("area"); // until the settings arrive
    await waitFor(() => expect(result.current.mode).toBe("frame"));
  });

  it("persists a new mode and skips a write for the current one", async () => {
    const updateSettings = withStoredMode("area");
    const { result } = renderHook(() => useScreenshotMode());
    await waitFor(() => expect(result.current.mode).toBe("area"));

    act(() => result.current.setMode("area"));
    expect(updateSettings).not.toHaveBeenCalled();

    act(() => result.current.setMode("screen"));
    expect(updateSettings).toHaveBeenCalledWith({ screenshotMode: "screen" });
    await waitFor(() => expect(result.current.mode).toBe("screen"));
  });
});
