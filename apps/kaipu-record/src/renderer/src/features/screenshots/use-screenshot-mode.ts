import { useCallback } from "react";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import {
  ENABLED_CAPTURE_MODES,
  toEnabledCaptureMode,
  type CaptureMode,
} from "@shared/types/screenshot-capture";

export interface ScreenshotModeStore {
  /** The one current screenshot mode (`AppSettings.screenshotMode`); Frame until loaded. */
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
export function useScreenshotMode(
  enabledModes: readonly CaptureMode[] = ENABLED_CAPTURE_MODES,
): ScreenshotModeStore {
  const { settings, update } = useAppSettings();
  // Main's merge already maps a legacy "area" to Frame; this is the renderer's own guard,
  // so no code path can ever hold a mode that no longer exists.
  const stored = settings?.screenshotMode;
  // A stored "window" reads as Frame while Window mode is off.
  const mode = toEnabledCaptureMode(stored, enabledModes);
  const setMode = useCallback(
    (next: CaptureMode) => {
      if (next === mode) return;
      update({ screenshotMode: next }).catch(() => {});
    },
    [mode, update],
  );
  return { mode, setMode };
}
