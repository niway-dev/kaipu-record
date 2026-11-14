import { useCallback } from "react";
import { useTranslations } from "@kaipu/i18n";
import { useRecordingMode } from "@renderer/features/recording/hooks/use-recording-mode";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import { useScreenshotMode } from "@renderer/features/screenshots/use-screenshot-mode";
import type { CaptureMode } from "@shared/types/screenshot-capture";

const MODE_LABEL = {
  frame: "modeFrame",
  window: "modeWindow",
  screen: "modeScreen",
} as const satisfies Record<CaptureMode, string>;

export interface CaptureEntryActions {
  /** The last used screenshot mode as a label ("Frame"). */
  screenshotLastUsed: string;
  /** The last used recording mode ("Screen"), with the Frame aspect ("Frame · 16:9") when set. */
  recordingLastUsed: string;
  /** Open the selector with the capture intent, in the last used screenshot mode. */
  openScreenshot(): void;
  /** Open the selector with the record intent, in the last used recording mode. */
  openRecording(): void;
}

/**
 * What the two capture entries (the page's cards, the tray's rows) show and do, built from
 * the settings main remembers. Neither action captures or records by itself: main opens the
 * selector, and the take starts only from there.
 */
export function useCaptureEntryActions(): CaptureEntryActions {
  const tModes = useTranslations("screenshots");
  const t = useTranslations("record");
  const { mode: screenshotMode } = useScreenshotMode();
  const { area: current } = useRecordingSettings();
  const recording = useRecordingMode(current);

  const modeName = (mode: CaptureMode): string => tModes(MODE_LABEL[mode]);
  const ratio =
    recording.area?.ratio && recording.area.ratio !== "free"
      ? recording.area.ratio
      : t("ratioFree");
  const recordingLastUsed =
    recording.mode === "frame" && recording.area
      ? `${modeName(recording.mode)} · ${ratio}`
      : modeName(recording.mode);

  const openScreenshot = useCallback(
    () => window.electronAPI.requestCaptureScreenshot(screenshotMode),
    [screenshotMode],
  );
  // No mode: main opens the selector in the last used recording mode.
  const openRecording = useCallback(() => window.electronAPI.requestRecordSelector(), []);

  return {
    screenshotLastUsed: modeName(screenshotMode),
    recordingLastUsed,
    openScreenshot,
    openRecording,
  };
}
