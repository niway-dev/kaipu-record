import { useCallback } from "react";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { DEFAULT_SETTINGS } from "@shared/types";
import type { CaptureMode } from "@shared/types/screenshot-capture";

export interface ScreenshotModeStore {
  /** The one current screenshot mode (`AppSettings.screenshotMode`); Area until loaded. */
  mode: CaptureMode;
  /** Make `mode` current: persisted by main and broadcast to every window. */
  setMode(mode: CaptureMode): void;
}

/**
 * The app-wide current screenshot mode, shared by the Screenshots page, the tray panel and
 * the generic capture shortcut. Every window follows a change made in another one through
 * the settings broadcast. A failed write keeps the old mode: picking a mode is a
 * convenience, and the capture it came with still runs.
 */
export function useScreenshotMode(): ScreenshotModeStore {
  const { settings, update } = useAppSettings();
  const mode = settings?.screenshotMode ?? DEFAULT_SETTINGS.screenshotMode;
  const setMode = useCallback(
    (next: CaptureMode) => {
      if (next === mode) return;
      update({ screenshotMode: next }).catch(() => {});
    },
    [mode, update],
  );
  return { mode, setMode };
}
