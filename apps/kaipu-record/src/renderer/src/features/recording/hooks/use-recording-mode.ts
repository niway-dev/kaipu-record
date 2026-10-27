import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import type { RecordingArea } from "@shared/types/ipc";
import type { CaptureMode, RememberedArea } from "@shared/types/screenshot-capture";

export interface RecordingModeView {
  /** The mode "Start recording" opens the selector in (`AppSettings.recordingMode`). */
  mode: CaptureMode;
  /** The remembered Frame area to describe ("16:9 · 1280 × 720"), when there is one. */
  area: RememberedArea | null;
}

/**
 * The remembered area to show beside the Frame chip: the one on the display the current
 * target is on, else the first one remembered. Sizes are DIP, as the settings store them.
 */
export function rememberedAreaFor(
  areas: Record<string, RememberedArea> | undefined,
  current: RecordingArea | null,
): RememberedArea | null {
  if (!areas) return null;
  if (current && areas[String(current.displayId)]) return areas[String(current.displayId)]!;
  return Object.values(areas)[0] ?? null;
}

/**
 * The last used recording mode, shared by the Record page and the tray panel. Main writes
 * it (a mode chip, or a take started from the overlay); every window follows through the
 * settings broadcast. "screen" until the settings load.
 */
export function useRecordingMode(current: RecordingArea | null): RecordingModeView {
  const { settings } = useAppSettings();
  return {
    mode: settings?.recordingMode ?? "screen",
    area: rememberedAreaFor(settings?.recordingArea, current),
  };
}
