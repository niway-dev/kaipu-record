import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppSettings, DEFAULT_SHORTCUTS } from "@shared/types";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { useAppSettings } from "./use-app-settings";

const SETTINGS: AppSettings = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  screenshotSave: "auto",
  showBrandBadge: false,
  shortcuts: DEFAULT_SHORTCUTS,
  deviceId: "",
  uploadMode: "local-only",
};

describe("useAppSettings", () => {
  beforeEach(() => {
    window.electronAPI.getSettings = vi.fn(async () => SETTINGS);
    window.electronAPI.updateSettings = vi.fn(
      async (patch: Partial<AppSettings>): Promise<AppSettings> => ({ ...SETTINGS, ...patch }),
    );
  });

  it("loads the persisted settings on mount", async () => {
    const { result } = renderHook(() => useAppSettings());
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
  });

  it("sends an update and adopts the returned settings", async () => {
    const { result } = renderHook(() => useAppSettings());
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.update({ showInDock: false });
    });

    expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({ showInDock: false });
    expect(result.current.settings?.showInDock).toBe(false);
  });

  it("adopts a settings-changed broadcast from another window", async () => {
    let subscriber: ((settings: AppSettings) => void) | null = null;
    window.electronAPI.onSettingsChanged = ((callback: (settings: AppSettings) => void) => {
      subscriber = callback;
      return () => {};
    }) as unknown as typeof window.electronAPI.onSettingsChanged;

    const { result } = renderHook(() => useAppSettings());
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));

    act(() => subscriber?.({ ...SETTINGS, theme: "light" }));
    expect(result.current.settings?.theme).toBe("light");
  });
});
