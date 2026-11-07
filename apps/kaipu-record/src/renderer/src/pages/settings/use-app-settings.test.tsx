import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import type { AppSettings } from "@shared/types";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { useAppSettings } from "./use-app-settings";

const SETTINGS: AppSettings = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  recordingCountdownSeconds: 3,
  showBrandBadge: false,
  screenshotCopy: "auto",
  screenshotAfterCapture: "preview",
  shortcuts: defaultShortcutsFor("darwin"),
  deviceId: "",
  uploadMode: "local-only",
  exportQuality: "balanced",
  showRecordingSavedCard: true,
  screenshotFrame: {},
  recordingArea: {},
  recordingMode: "screen",
  screenshotMode: "frame",
  trayHintShown: false,
  diagnosticsEnabled: true,
  cameraBubble: {
    shape: "circle",
    cornerRadius: 0.18,
    size: 240,
    deviceId: null,
    mirrored: true,
    framing: { enabled: false, zoom: 1, x: 0, y: 0 },
  },
  audio: {
    micLevel: 100,
    noiseSuppression: true,
    systemAudioVolume: 100,
    duckSystemAudioWhileTalking: false,
  },
  microphone: null,
  editor: { hiddenTracks: [] },
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

  describe("the snapshot is the active workspace's effective settings (ADR 0034)", () => {
    it("a switch broadcast replaces the snapshot with the new workspace's values", async () => {
      let subscriber: ((settings: AppSettings) => void) | null = null;
      window.electronAPI.onSettingsChanged = ((callback: (settings: AppSettings) => void) => {
        subscriber = callback;
        return () => {};
      }) as unknown as typeof window.electronAPI.onSettingsChanged;
      // Work overrides screenshot copy to manual, Personal does not.
      window.electronAPI.getSettings = vi.fn(async () => ({
        ...SETTINGS,
        screenshotCopy: "manual" as const,
      }));

      const { result } = renderHook(() => useAppSettings());
      await waitFor(() => expect(result.current.settings?.screenshotCopy).toBe("manual"));

      act(() => subscriber?.({ ...SETTINGS, screenshotCopy: "auto" }));
      expect(result.current.settings?.screenshotCopy).toBe("auto");
    });

    it("an update's response keeps the workspace's override instead of flipping the cache to the All value", async () => {
      // Main answers with the effective settings: Work's "manual", not the All level's "auto".
      window.electronAPI.updateSettings = vi.fn(
        async (patch: Partial<AppSettings>): Promise<AppSettings> => ({
          ...SETTINGS,
          ...patch,
          screenshotCopy: "manual",
        }),
      );
      const { result } = renderHook(() => useAppSettings());
      await waitFor(() => expect(result.current.settings).not.toBeNull());

      await act(async () => {
        await result.current.update({ theme: "light" });
      });
      expect(result.current.settings?.theme).toBe("light");
      expect(result.current.settings?.screenshotCopy).toBe("manual");
    });
  });
});
